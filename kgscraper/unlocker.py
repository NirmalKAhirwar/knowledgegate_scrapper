"""Derive the answer key by answering questions on the live account.

Why this module exists
----------------------
KnowledgeGate does not ship the answer key to free accounts.  ``GET
.../question/{id}`` returns ``answer: null`` and ``canViewSolution: false``.
The only way to learn the key is to *attempt* the question::

    POST /course-content/student/course/{slug}/{kind}/subtopic/{scopeId}
         /question/{questionId}/attempt   {"answer": <option id>}

The response tells us whether the submitted option was correct and returns a
worked explanation for the option we picked (usually it explains why the
option is wrong - and often names the right one).

Free tier budget (measured 2026-10-22, plan ``free``)::

    pyq      5 attempts / day
    practice 15 attempts / day

so this is a slow, opt-in drip - not something to run unattended.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .api import KgApi
from .auth import AuthSession
from .client import DailyLimitReached, KgClient
from .config import Config
from .richtext import extract_text
from .store import Store

#: Free tier daily attempt budget per collection.
FREE_DAILY_BUDGET = {"pyq": 5, "practice": 15}


@dataclass
class UnlockResult:
    """Outcome of an unlock run."""

    candidates: int = 0
    attempted: int = 0
    verified: int = 0
    inferred: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    stopped: str | None = None
    resets_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "candidates": self.candidates,
            "attempted": self.attempted,
            "verified": self.verified,
            "inferred": self.inferred,
            "skipped": self.skipped,
            "errors": self.errors,
            "stopped": self.stopped,
            "resets_at": self.resets_at,
        }


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _option_mentioned(feedback: str, option_text: str) -> bool:
    """True when the explanation explicitly mentions this option's text."""
    if not feedback or not option_text:
        return False
    haystack = _normalise(feedback)
    needle = _normalise(option_text)
    if not needle:
        return False
    return needle in haystack


def _infer_from_feedback(
    feedback: str, options: list[dict[str, Any]], tried: set[int]
) -> int | None:
    """Guess which option the explanation is pointing at.

    The free-tier explanations frequently name the right option verbatim
    ("There is a valid analogous pair provided: 'Forensic : Court' ..."), so a
    plain substring match over the option texts recovers the key for free.
    """
    hits = [
        int(option["ord"])
        for option in options
        if int(option["ord"]) not in tried
        and _option_mentioned(feedback, option.get("text") or "")
    ]
    if len(hits) == 1:
        return hits[0]
    return None


async def unlock_questions(
    cfg: Config,
    *,
    limit: int = 50,
    kinds: tuple[str, ...] = ("pyq", "practice"),
    subject_slug: str | None = None,
    chapter_slug: str | None = None,
    verify_inferred: bool = False,
    dry_run: bool = False,
) -> int:
    """Unlock as many answers as the daily budget allows.

    Returns a process exit code (0 = fine, 1 = auth/API failure).
    """
    from rich.console import Console

    console = Console()
    store = Store(cfg.db_path)
    result = UnlockResult()

    candidates = store.unlock_candidates(
        kinds=kinds,
        limit=limit,
        subject_slug=subject_slug,
        chapter_slug=chapter_slug,
    )
    result.candidates = len(candidates)
    if not candidates:
        console.print(
            "[yellow]Nothing to unlock - every stored question already has an answer.[/yellow]"
        )
        store.close()
        return 0

    if dry_run:
        console.print(f"[cyan]{len(candidates)}[/cyan] question(s) would be unlocked:")
        for row in candidates[:20]:
            console.print(f"  {row['kind']:8s} {row['id']}  {str(row['question_text'])[:70]}")
        if len(candidates) > 20:
            console.print(f"  … and {len(candidates) - 20} more")
        store.close()
        return 0

    try:
        session = AuthSession.load(cfg.resolve_cookies_path())
    except Exception as exc:  # noqa: BLE001
        console.print(f"[red]✗[/red] {exc}")
        store.close()
        return 1

    slug = _course_slug(store)
    if not slug:
        console.print("[red]✗[/red] no course stored - run 'kgscrape scrape' first")
        store.close()
        return 1

    async with KgClient(
        session,
        concurrency=cfg.concurrency,
        timeout=cfg.timeout,
        max_retries=cfg.max_retries,
    ) as client:
        api = KgApi(client)

        for row in candidates:
            question_id = row["id"]
            kind = row["kind"]
            scope_id = row["scope_id"]
            options = [
                {"ord": int(o["ord"]), "text": o["text"] or ""}
                for o in store.options(question_id)
            ]
            if not options:
                result.skipped += 1
                continue

            feedback_texts: list[str] = []
            tried: set[int] = set()
            answer: int | None = None
            verified = False

            for option in options:
                option_id = int(option["ord"])
                try:
                    payload = await api.submit_attempt(
                        slug, kind, "subtopic", scope_id, question_id, option_id
                    )
                except DailyLimitReached as exc:
                    result.stopped = f"daily limit reached ({exc.bucket})"
                    result.resets_at = exc.resets_at
                    console.print(
                        f"[yellow]⏸[/yellow] Daily {exc.bucket} attempt limit reached "
                        f"({exc.used}/{exc.limit}) - resets at {exc.resets_at}"
                    )
                    break
                except Exception as exc:  # noqa: BLE001
                    result.errors.append(f"{question_id}: {exc}")
                    break

                result.attempted += 1
                tried.add(option_id)

                is_correct = bool(payload.get("isCorrect"))
                option_feedback = _option_feedback(payload, option_id)
                if option_feedback:
                    feedback_texts.append(option_feedback)
                    store.set_option_feedback(question_id, option_id, option_feedback)

                if is_correct:
                    answer = option_id
                    verified = True
                    break

                guessed = _infer_from_feedback(option_feedback, options, tried)
                if guessed is not None and not verify_inferred:
                    answer = guessed
                    break

            if result.stopped:
                break

            if answer is None:
                result.skipped += 1
                continue

            solution = "\n\n".join(feedback_texts).strip() or None
            store.set_answer(
                question_id,
                option_ids=[answer],
                source="verified" if verified else "inferred",
                solution_text=solution,
            )
            if verified:
                result.verified += 1
            else:
                result.inferred += 1
            if result.attempted % 5 == 0:
                store.commit()

    store.commit()
    console.print()
    console.print(
        f"attempted={result.attempted} verified={result.verified} "
        f"inferred={result.inferred} skipped={result.skipped}"
    )
    if result.resets_at:
        console.print(f"[yellow]daily budget exhausted, resets at {result.resets_at}[/yellow]")
    for message in result.errors[:5]:
        console.print(f"[red]![/red] {message}")
    store.close()
    return 0


def _option_feedback(payload: dict[str, Any], option_id: int) -> str:
    for entry in payload.get("optionFeedback") or []:
        if int(entry.get("id", -1)) != option_id:
            continue
        raw = entry.get("feedback")
        if isinstance(raw, str):
            return raw
        if raw:
            return extract_text(raw, "en") or ""
    return ""


def _course_slug(store: Store) -> str | None:
    rows = store.courses()
    if not rows:
        return None
    return rows[0]["slug"]


def budget_report(store: Store) -> dict[str, dict[str, Any]]:
    """How many questions still need unlocking, per collection."""
    out: dict[str, dict[str, Any]] = {}
    for kind in ("pyq", "practice"):
        total = store.conn.execute(
            "SELECT COUNT(*) c FROM question WHERE kind=?", (kind,)
        ).fetchone()["c"]
        done = store.conn.execute(
            "SELECT COUNT(*) c FROM question WHERE kind=? AND answer_available=1", (kind,)
        ).fetchone()["c"]
        out[kind] = {
            "total": total,
            "answered": done,
            "remaining": total - done,
            "daily_budget": FREE_DAILY_BUDGET.get(kind, 0),
        }
    return out


def estimated_days(store: Store) -> float:
    """Rough estimate of how long a full unlock takes on the free tier."""
    report = budget_report(store)
    remaining = sum(v["remaining"] for v in report.values())
    daily = sum(v["daily_budget"] for v in report.values())
    if daily <= 0:
        return float("inf")
    return remaining / daily
