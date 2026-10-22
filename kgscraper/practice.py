"""Offline practice sessions and performance tracking.

Everything runs against the local SQLite file - no network access, no attempt
records on the KnowledgeGate account.
"""

from __future__ import annotations

import random
import time
import uuid
from dataclasses import dataclass
from typing import Any, Sequence

from .store import Store

LETTERS = "ABCDEFGHIJ"


def _scope_filters(
    scope: str, scope_slug: str | None
) -> dict[str, Any]:
    filters: dict[str, Any] = {}
    if scope == "subject":
        filters["subject_slug"] = scope_slug
    elif scope == "chapter":
        filters["chapter_slug"] = scope_slug
    elif scope == "topic":
        filters["topic_slug"] = scope_slug
    return filters


def pick_questions(
    store: Store,
    *,
    scope: str = "topic",
    scope_slug: str | None = None,
    kinds: Sequence[str] = ("pyq", "practice"),
    count: int = 20,
    shuffle: bool = True,
    unanswered_only: bool = False,
) -> list[Any]:
    filters = _scope_filters(scope, scope_slug)
    rows = store.questions(kinds=kinds, limit=None, **filters)
    if unanswered_only:
        rows = [r for r in rows if not r["answer_available"]]
    if shuffle:
        random.shuffle(rows)
    return rows[:count]


@dataclass
class SessionSummary:
    session_id: str
    total: int
    correct: int
    incorrect: int
    skipped: int
    elapsed: float

    @property
    def accuracy(self) -> float:
        answered = self.correct + self.incorrect
        return (self.correct / answered * 100) if answered else 0.0


def run_terminal_session(
    store: Store,
    *,
    scope: str = "topic",
    scope_slug: str | None = None,
    kinds: Sequence[str] = ("pyq", "practice"),
    count: int = 20,
    shuffle: bool = True,
    timed: bool = True,
) -> SessionSummary:
    """Ask questions in the terminal and record every attempt."""
    from rich.console import Console
    from rich.panel import Panel

    console = Console()
    rows = pick_questions(
        store,
        scope=scope,
        scope_slug=scope_slug,
        kinds=kinds,
        count=count,
        shuffle=shuffle,
    )
    if not rows:
        console.print("[yellow]No questions found for that scope.[/yellow]")
        return SessionSummary("", 0, 0, 0, 0, 0.0)

    session_id = uuid.uuid4().hex[:16]
    store.start_session(
        session_id,
        {"scope": scope, "slug": scope_slug, "kinds": list(kinds)},
        kind=",".join(kinds),
        total=len(rows),
    )
    store.commit()

    correct = incorrect = skipped = 0
    started = time.time()
    started_at = time.time()

    for index, row in enumerate(rows, start=1):
        options = store.options(row["id"])
        question_text = row["question_text"] or "(no question text)"
        body = [f"[bold]{question_text}[/bold]"]
        if row["instructions"]:
            body.append(f"[dim]{row['instructions']}[/dim]")
        body.append("")
        for option in options:
            marker = "✓" if option["is_correct"] else " "
            body.append(f"  {marker} {option['label'] or LETTERS[option['ord']]}. {option['text']}")

        console.print()
        console.print(Panel("\n".join(body), title=f"{index}/{len(rows)}", expand=False))

        if not options:
            skipped += 1
            continue

        raw = console.input("[bold]answer[/bold] (letter, number, or 's' to skip): ").strip()
        if not raw or raw.lower() in {"s", "skip", "q", "quit"}:
            skipped += 1
            if raw.lower() == "q":
                break
            continue

        chosen = _resolve_choice(raw, options)
        if chosen is None:
            console.print("[red]not a valid option[/red]")
            skipped += 1
            continue

        elapsed = time.time() - started_at if timed else None
        started_at = time.time()

        is_correct = bool(chosen["is_correct"])
        if is_correct:
            correct += 1
            console.print("[green]correct[/green]")
        else:
            incorrect += 1
            correct_option = next((o for o in options if o["is_correct"]), None)
            if correct_option is not None:
                console.print(
                    f"[red]wrong[/red] - the answer is "
                    f"{correct_option['label'] or LETTERS[correct_option['ord']]}. "
                    f"{correct_option['text']}"
                )
            else:
                console.print("[yellow]no answer key stored for this question[/yellow]")

        feedback = chosen["feedback"]
        if feedback:
            console.print(f"[dim]{feedback}[/dim]")

        store.record_attempt(
            session_id,
            row["id"],
            topic_id=row["topic_id"],
            subject_id=row["subject_id"],
            kind=row["kind"],
            selected_option=str(chosen["label"] or LETTERS[chosen["ord"]]),
            is_correct=is_correct,
            elapsed_seconds=elapsed,
        )

    store.finish_session(session_id, correct, incorrect, skipped)
    store.commit()

    summary = SessionSummary(session_id, len(rows), correct, incorrect, skipped, time.time() - started)
    console.print()
    console.print(
        f"[bold]session {session_id}[/bold] - {correct} correct, {incorrect} wrong, "
        f"{skipped} skipped, {summary.accuracy:.0f}% accuracy, {summary.elapsed:.0f}s"
    )
    return summary


def _resolve_choice(raw: str, options: Sequence[Any]):
    raw = raw.strip().lower()
    if raw.isdigit():
        index = int(raw)
        if 0 <= index < len(options):
            return options[index]
        return None
    if len(raw) == 1 and raw.isalpha():
        letter = raw.upper()
        for option in options:
            if (option["label"] or LETTERS[option["ord"]]).upper() == letter:
                return option
    for option in options:
        if (option["label"] or "").lower() == raw:
            return option
    return None


def print_stats(store: Store, *, group_by: str = "topic") -> None:
    """Print accuracy per subject/chapter/topic/exam/year/collection."""
    from rich.console import Console
    from rich.table import Table

    console = Console()

    joins = {
        "subject": ("s.title", "LEFT JOIN subject s ON s.id = a.subject_id"),
        "chapter": (
            "c.title",
            "LEFT JOIN topic t ON t.id = a.topic_id LEFT JOIN chapter c ON c.id = t.chapter_id",
        ),
        "topic": ("t.title", "LEFT JOIN topic t ON t.id = a.topic_id"),
        "exam": ("q.exam_name", "LEFT JOIN question q ON q.id = a.question_id"),
        "year": ("CAST(q.year AS TEXT)", "LEFT JOIN question q ON q.id = a.question_id"),
        "kind": ("a.kind", ""),
    }
    if group_by not in joins:
        console.print(f"[red]✗[/red] unknown group-by: {group_by}")
        return

    group_expr, group_join = joins[group_by]
    sql = f"""
        SELECT {group_expr} AS label,
               COUNT(*) AS attempts,
               SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct
        FROM attempt a
        {group_join}
        GROUP BY label
        HAVING attempts > 0
        ORDER BY attempts DESC, label
    """

    rows = store.conn.execute(sql).fetchall()
    if not rows:
        console.print("[yellow]No attempts recorded yet - run 'kgscrape practice' first.[/yellow]")
        return

    table = Table(title=f"Performance by {group_by}", header_style="bold cyan")
    table.add_column(group_by.title())
    table.add_column("attempts", justify="right")
    table.add_column("correct", justify="right")
    table.add_column("accuracy", justify="right")
    for row in rows:
        attempts = row["attempts"] or 0
        correct = row["correct"] or 0
        accuracy = (correct / attempts * 100) if attempts else 0.0
        table.add_row(
            str(row["label"] or "-"),
            str(attempts),
            str(correct),
            f"{accuracy:.0f}%",
        )
    console.print(table)


def session_history(store: Store, limit: int = 20) -> list[dict[str, Any]]:
    rows = store.conn.execute(
        "SELECT * FROM session ORDER BY started_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(row) for row in rows]
