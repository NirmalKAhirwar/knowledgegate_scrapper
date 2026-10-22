"""Notes (PDF handouts) attached to topics.

The course tree lists every note as a ``pdf`` lesson.  We can always build the
in-app link for it.  Downloading the underlying PDF bundle requires a Plus/Pro
admission - on the free plan the endpoint answers HTTP 403, so the download
step is optional and reports the limitation instead of failing hard.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .api import KgApi
from .auth import AuthSession
from .client import ApiError, KgClient
from .config import Config
from .store import Store
from .web import note_web_link


@dataclass
class NotesResult:
    indexed: int = 0
    linked: int = 0
    downloaded: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)


def list_notes(store: Store, *, topic_id: str | None = None) -> list[dict[str, Any]]:
    """Every note with its topic context and in-app link."""
    rows = store.conn.execute(
        """
        SELECT n.*, t.slug AS topic_slug, t.title AS topic_title,
               c.slug AS chapter_slug, c.title AS chapter_title,
               s.slug AS subject_slug, s.title AS subject_title,
               co.slug AS course_slug
        FROM note n
        LEFT JOIN topic t ON t.id = n.topic_id
        LEFT JOIN chapter c ON c.id = t.chapter_id
        LEFT JOIN subject s ON s.id = t.subject_id
        LEFT JOIN course co ON co.id = s.course_id
        WHERE n.kind != 'video'
        ORDER BY s.ord, c.ord, t.ord, n.title
        """
    ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        link = note_web_link(
            row["course_slug"] or "",
            row["subject_slug"],
            row["chapter_slug"],
            row["topic_slug"],
            None,
        )
        out.append(
            {
                "id": row["id"],
                "title": row["title"],
                "pages": row["page_count"],
                "size": row["file_size"],
                "subject": row["subject_title"],
                "chapter": row["chapter_title"],
                "topic": row["topic_title"],
                "link": link,
                "asset_url": row["asset_url"],
                "downloaded": bool(row["downloaded"]),
            }
        )
    return out


async def download_notes(cfg: Config, out_dir: Path | None = None) -> int:
    """Try to download the notes bundle.  Needs a Plus/Pro admission."""
    from rich.console import Console

    console = Console()
    store = Store(cfg.db_path)
    rows = store.courses()
    if not rows:
        console.print("[red]✗[/red] no course stored - run 'kgscrape scrape' first")
        store.close()
        return 1

    course = rows[0]
    listing_id = course["listing_id"]
    if not listing_id:
        console.print("[red]✗[/red] the course listing id is missing from the database")
        store.close()
        return 1

    session = AuthSession.load(cfg.resolve_cookies_path())
    target = Path(out_dir or Path("data/notes"))
    target.mkdir(parents=True, exist_ok=True)

    async def run() -> int:
        async with KgClient(
            session, concurrency=2, timeout=cfg.timeout, max_retries=cfg.max_retries
        ) as client:
            api = KgApi(client)
            try:
                status = await api.course_notes_status(listing_id)
                console.print(f"[dim]notes status: {status}[/dim]")
            except ApiError as exc:
                console.print(f"[yellow]status check failed: {exc}[/yellow]")

            try:
                payload = await api.course_notes_file(listing_id)
            except ApiError as exc:
                if exc.status == 403:
                    console.print(
                        "[yellow]Note downloads need an active Plus/Pro admission "
                        "(HTTP 403).[/yellow]\n"
                        "The in-app links still work - open them in a signed-in browser."
                    )
                else:
                    console.print(f"[red]✗[/red] {exc}")
                store.close()
                return 1

            path = target / f"{course['slug']}-notes.pdf"
            path.write_bytes(payload)
            console.print(f"[green]✓[/green] wrote {path} ({len(payload) / 1e6:.1f} MB)")
            store.close()
            return 0

    return asyncio.run(run())


def notes_markdown(store: Store) -> str:
    """A markdown index of every note."""
    lines = ["| Subject | Chapter | Topic | Notes | Pages | Link |", "|---|---|---|---|---|---|"]
    for note in list_notes(store):
        lines.append(
            f"| {note['subject'] or ''} | {note['chapter'] or ''} | {note['topic'] or ''} | "
            f"{note['title'] or ''} | {note['pages'] or ''} | [open]({note['link']}) |"
        )
    return "\n".join(lines)
