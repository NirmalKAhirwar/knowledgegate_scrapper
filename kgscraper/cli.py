"""``kgscrape`` command line interface."""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

import typer
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeRemainingColumn,
)
from rich.table import Table

from . import API_BASE, __version__
from .api import KgApi, slug_from_course_url
from .auth import AuthError, AuthSession
from .client import KgClient
from .config import Config
from .store import Store

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Scrape KnowledgeGate courses for offline practice and PDF export.",
)
console = Console()
err_console = Console(stderr=True)

DEFAULT_COURSE_URL = (
    "https://www.knowledgegate.ai/learn/"
    "SSC-JE-IMD-SCIENTIFIC-ASSISTANT-COMPUTER-SCIENCE?tab=content"
)


# --------------------------------------------------------------------- helpers
def _config(
    db: Path,
    cookies: Path,
    concurrency: int,
    timeout: float,
    retries: int,
    lang: str,
) -> Config:
    cfg = Config(
        db_path=db,
        cookies_path=cookies,
        concurrency=concurrency,
        timeout=timeout,
        max_retries=retries,
        lang=lang,
    )
    cfg.ensure_dirs()
    return cfg


def _session(cfg: Config) -> AuthSession:
    return AuthSession.load(cfg.resolve_cookies_path())


def _open_store(cfg: Config) -> Store:
    return Store(cfg.db_path)


def _print_table(title: str, rows: list[list[Any]], headers: list[str]) -> None:
    table = Table(title=title, header_style="bold cyan")
    for header in headers:
        table.add_column(header)
    for row in rows:
        table.add_row(*["" if cell is None else str(cell) for cell in row])
    console.print(table)


# ----------------------------------------------------------------------- doctor
@app.command()
def doctor(
    db: Path = typer.Option(Path("data/kg.db"), "--db", help="SQLite database path."),
    cookies: Path = typer.Option(Path("data/cookies.json"), "--cookies", help="Cookie export path."),
    concurrency: int = typer.Option(8, "--concurrency", min=1, max=16),
) -> None:
    """Check the environment, the session and API reachability."""
    console.print(f"[bold]kgscraper[/bold] {__version__}")
    console.print(f"python      : {sys.version.split()[0]}")
    console.print(f"api base    : {API_BASE}")
    console.print(f"database    : {db}")

    cfg = _config(db, cookies, concurrency, 30.0, 5, "en")
    try:
        session = _session(cfg)
    except AuthError as exc:
        err_console.print(f"[red]✗ cookies[/red] {exc}")
        raise typer.Exit(code=1) from exc

    has_access = bool(session.access_token)
    has_refresh = bool(session.refresh_token)
    console.print(f"cookies     : {len(session.cookies)} entries "
                  f"(accessToken={'yes' if has_access else 'no'}, "
                  f"refreshToken={'yes' if has_refresh else 'no'})")
    if not has_refresh:
        err_console.print("[red]✗[/red] no refreshToken cookie - sign in to KnowledgeGate again")
        raise typer.Exit(code=1)

    async def probe() -> int:
        async with KgClient(
            session, concurrency=concurrency, timeout=cfg.timeout, max_retries=cfg.max_retries
        ) as client:
            api = KgApi(client)
            try:
                me = await api.me()
                console.print(
                    f"[green]✓[/green] session      : {me.get('defaultUsername') or me.get('_id')} "
                    f"({me.get('userType')})"
                )
            except Exception as exc:  # noqa: BLE001
                err_console.print(f"[red]✗ session[/red] {exc}")
                return 1
            try:
                summary = await api.course_summary(slug_from_course_url(DEFAULT_COURSE_URL))
                info = summary.get("courseInfo", {})
                console.print(
                    f"[green]✓[/green] api          : {info.get('courseName') or 'course reachable'}\n"
                    f"              pyq={summary.get('pyqCount')} "
                    f"practice={summary.get('practiceCount')} "
                    f"topics={summary.get('totalSubtopics')}"
                )
            except Exception as exc:  # noqa: BLE001
                err_console.print(f"[red]✗ api[/red] {exc}")
                return 1
            return 0

    raise typer.Exit(code=asyncio.run(probe()))


# ----------------------------------------------------------------------- scrape
@app.command()
def scrape(
    url: str = typer.Option(DEFAULT_COURSE_URL, "--url", help="KnowledgeGate course URL."),
    db: Path = typer.Option(Path("data/kg.db"), "--db", help="SQLite database path."),
    cookies: Path = typer.Option(Path("data/cookies.json"), "--cookies", help="Cookie export path."),
    kinds: str = typer.Option("pyq,practice", "--kinds", help="Comma separated: pyq,practice."),
    concurrency: int = typer.Option(16, "--concurrency", min=1, max=16),
    timeout: float = typer.Option(30.0, "--timeout"),
    retries: int = typer.Option(5, "--retries"),
    lang: str = typer.Option("en", "--lang", help="Language to store (en / hi)."),
    no_resume: bool = typer.Option(False, "--no-resume", help="Re-download every question."),
    no_notes: bool = typer.Option(False, "--no-notes", help="Skip the notes index."),
    limit: int = typer.Option(None, "--limit", help="Only fetch this many questions (smoke test)."),
) -> None:
    """Download an entire course (questions only, videos are ignored)."""
    from .scraper import CourseScraper

    try:
        slug = slug_from_course_url(url)
    except ValueError as exc:
        err_console.print(f"[red]✗[/red] {exc}")
        raise typer.Exit(code=2) from exc

    kind_list = tuple(k.strip() for k in kinds.split(",") if k.strip())
    cfg = _config(db, cookies, concurrency, timeout, retries, lang)

    console.print(f"[bold]Course[/bold] {slug}")
    console.print(f"[dim]db={cfg.db_path}  kinds={','.join(kind_list)}  lang={lang}[/dim]")

    async def run() -> int:
        try:
            session = _session(cfg)
        except AuthError as exc:
            err_console.print(f"[red]✗ cookies[/red] {exc}")
            return 1

        store = _open_store(cfg)
        with Progress(
            SpinnerColumn(),
            TextColumn("[bold blue]{task.description}"),
            BarColumn(bar_width=40),
            TextColumn("{task.completed}/{task.total}"),
            TimeRemainingColumn(),
            console=console,
            transient=False,
        ) as progress:
            task = progress.add_task("starting…", total=None)

            class _Reporter:
                def message(self, text: str) -> None:
                    progress.update(task, description=text)

                def advance(self, done: int, total: int) -> None:
                    progress.update(task, completed=done, total=total)

            async with KgClient(
                session, concurrency=concurrency, timeout=timeout, max_retries=retries
            ) as client:
                api = KgApi(client)
                scraper = CourseScraper(
                    api,
                    store,
                    slug=slug,
                    kinds=kind_list,
                    concurrency=concurrency,
                    lang=lang,
                    resume=not no_resume,
                    include_notes=not no_notes,
                    question_limit=limit,
                )
                stats = await scraper.run(progress=_Reporter())

        counts = store.counts()
        console.print()
        _print_table(
            "Scrape complete",
            [
                ["subjects", counts["subjects"]],
                ["chapters", counts["chapters"]],
                ["topics", counts["topics"]],
                ["PYQ questions", counts.get("pyq", 0)],
                ["practice questions", counts.get("practice", 0)],
                ["total questions", counts["questions"]],
                ["notes indexed", counts["notes"]],
                ["answers available", counts["answers_available"]],
                ["elapsed", f"{stats.elapsed:.1f}s"],
                ["errors", len(stats.errors)],
            ],
            ["metric", "value"],
        )
        if stats.errors:
            err_console.print(f"[yellow]{len(stats.errors)} errors, first 3:[/yellow]")
            for message in stats.errors[:3]:
                err_console.print(f"  {message}")
        store.close()
        return 0

    raise typer.Exit(code=asyncio.run(run()))


# ----------------------------------------------------------------------- unlock
@app.command()
def unlock(
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    cookies: Path = typer.Option(Path("data/cookies.json"), "--cookies"),
    limit: int = typer.Option(50, "--limit", min=1, help="How many questions to unlock this run."),
    kinds: str = typer.Option("pyq,practice", "--kinds"),
    subject: str = typer.Option(None, "--subject", help="Restrict to one subject slug."),
    chapter: str = typer.Option(None, "--chapter", help="Restrict to one chapter slug."),
    concurrency: int = typer.Option(4, "--concurrency", min=1, max=8),
    verify: bool = typer.Option(
        False, "--verify", help="Confirm inferred answers with an extra attempt."
    ),
    dry_run: bool = typer.Option(False, "--dry-run", help="Only list what would be unlocked."),
    yes: bool = typer.Option(
        False, "--yes", help="Skip the confirmation prompt (writes attempts to your account)."
    ),
) -> None:
    """Record attempts so the API starts returning the answer key.

    This writes real attempt records to your live KnowledgeGate account, which
    affects your leaderboard/analytics.  The free tier allows 5 PYQ and 15
    practice attempts per day, so this is a deliberate daily drip.
    """
    from .unlocker import budget_report, estimated_days, unlock_questions

    cfg = _config(db, cookies, concurrency, 30.0, 5, "en")
    kind_list = tuple(k.strip() for k in kinds.split(",") if k.strip())

    probe = _open_store(cfg)
    report = budget_report(probe)
    remaining = sum(v["remaining"] for v in report.values())
    days = estimated_days(probe)
    probe.close()
    console.print(
        f"[dim]questions without an answer: {remaining} "
        f"(pyq {report['pyq']['remaining']}, practice {report['practice']['remaining']}) - "
        f"~{days:.0f} days at the free-tier budget[/dim]"
    )

    if not dry_run and not yes:
        console.print(
            "[bold yellow]This writes real attempt records to your live KnowledgeGate "
            "account.[/bold yellow]\n"
            "It is the only way to obtain the answer key without a Plus/Pro plan, and the "
            "free tier caps how many you can do per day."
        )
        if not typer.confirm("Continue?"):
            raise typer.Exit(code=0)

    raise typer.Exit(
        code=asyncio.run(
            unlock_questions(
                cfg,
                limit=limit,
                kinds=kind_list,
                subject_slug=subject,
                chapter_slug=chapter,
                verify_inferred=verify,
                dry_run=dry_run,
            )
        )
    )


# ----------------------------------------------------------------------- notes
@app.command()
def notes(
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    cookies: Path = typer.Option(Path("data/cookies.json"), "--cookies"),
    out_dir: Path = typer.Option(Path("data/notes"), "--out-dir"),
    download: bool = typer.Option(False, "--download", help="Fetch the notes bundle (Plus/Pro)."),
    as_markdown: bool = typer.Option(False, "--markdown", help="Print a markdown index."),
) -> None:
    """List the PDF notes of the course (and optionally download them)."""
    from .notes import download_notes, list_notes, notes_markdown

    cfg = _config(db, cookies, 4, 30.0, 5, "en")
    store = _open_store(cfg)
    try:
        if as_markdown:
            console.print(notes_markdown(store))
            return
        rows = list_notes(store)
        if not rows:
            console.print("[yellow]No notes indexed yet - run 'kgscrape scrape' first.[/yellow]")
            return
        _print_table(
            "Notes",
            [
                [r["subject"], r["chapter"], r["topic"], r["title"], r["pages"], r["link"]]
                for r in rows[:200]
            ],
            ["subject", "chapter", "topic", "note", "pages", "link"],
        )
        console.print(f"[dim]{len(rows)} note(s) indexed[/dim]")
    finally:
        store.close()

    if download:
        raise typer.Exit(code=asyncio.run(download_notes(cfg, out_dir)))


# ----------------------------------------------------------------------- export
export_app = typer.Typer(help="Export the scraped course.", no_args_is_help=True)
app.add_typer(export_app, name="export")


@export_app.command("pdf")
def export_pdf(
    scope: str = typer.Option("course", "--scope", help="course|subject|chapter|topic"),
    slug: str = typer.Option(None, "--slug", help="Slug of the subject/chapter/topic."),
    kinds: str = typer.Option("pyq,practice", "--kinds"),
    group_by: str = typer.Option(
        "chapter", "--group-by", help="subject|chapter|topic|exam|year|none"
    ),
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    out: Path = typer.Option(Path("out/course.pdf"), "--out", "-o"),
    with_solutions: bool = typer.Option(False, "--with-solutions"),
    answer_key_only: bool = typer.Option(False, "--answer-key-only"),
    questions_only: bool = typer.Option(False, "--questions-only"),
    limit: int = typer.Option(None, "--limit", help="Cap the number of questions."),
    title: str = typer.Option(None, "--title"),
) -> None:
    """Render a PDF with a table of contents (and solutions when available)."""
    from .export.pdf import PdfExportOptions, export_pdf as run_export

    if answer_key_only and questions_only:
        err_console.print("[red]✗[/red] --answer-key-only and --questions-only are mutually exclusive")
        raise typer.Exit(code=2)

    kind_list = tuple(k.strip() for k in kinds.split(",") if k.strip())
    options = PdfExportOptions(
        scope=scope,
        scope_slug=slug,
        kinds=kind_list,
        group_by=group_by,
        with_solutions=with_solutions,
        answer_key_only=answer_key_only,
        questions_only=questions_only,
        limit=limit,
        title=title,
    )
    cfg = _config(db, Path("data/cookies.json"), 8, 30.0, 5, "en")
    store = _open_store(cfg)
    try:
        path = run_export(store, options, out)
    finally:
        store.close()
    console.print(f"[green]✓[/green] wrote {path}")


@export_app.command("json")
def export_json(
    scope: str = typer.Option("course", "--scope"),
    slug: str = typer.Option(None, "--slug"),
    kinds: str = typer.Option("pyq,practice", "--kinds"),
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    out: Path = typer.Option(Path("out/course.json"), "--out", "-o"),
    limit: int = typer.Option(None, "--limit"),
) -> None:
    """Export every question as JSON (optionally with the answer key)."""
    from .export.json_export import export_json as run_export

    kind_list = tuple(k.strip() for k in kinds.split(",") if k.strip())
    cfg = _config(db, Path("data/cookies.json"), 8, 30.0, 5, "en")
    store = _open_store(cfg)
    try:
        path = run_export(store, scope=scope, scope_slug=slug, kinds=kind_list, out=out, limit=limit)
    finally:
        store.close()
    console.print(f"[green]✓[/green] wrote {path}")


# --------------------------------------------------------------------- practice
@app.command()
def practice(
    scope: str = typer.Option("topic", "--scope", help="topic|chapter|subject|course"),
    slug: str = typer.Option(None, "--slug"),
    kinds: str = typer.Option("pyq,practice", "--kinds"),
    count: int = typer.Option(20, "--count"),
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    shuffle: bool = typer.Option(True, "--shuffle/--no-shuffle"),
    timed: bool = typer.Option(True, "--timed/--no-timed"),
) -> None:
    """Run a practice session in the terminal and record your performance."""
    from .practice import run_terminal_session

    kind_list = tuple(k.strip() for k in kinds.split(",") if k.strip())
    cfg = _config(db, Path("data/cookies.json"), 8, 30.0, 5, "en")
    store = _open_store(cfg)
    try:
        run_terminal_session(store, scope=scope, scope_slug=slug, kinds=kind_list, count=count,
                             shuffle=shuffle, timed=timed)
    finally:
        store.close()


@app.command()
def stats(
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    group_by: str = typer.Option("topic", "--group-by", help="subject|chapter|topic|exam|year|kind"),
) -> None:
    """Show performance statistics collected from your practice sessions."""
    from .practice import print_stats

    cfg = _config(db, Path("data/cookies.json"), 8, 30.0, 5, "en")
    store = _open_store(cfg)
    try:
        print_stats(store, group_by=group_by)
    finally:
        store.close()


@app.command("verify")
def verify(
    db: Path = typer.Option(Path("data/kg.db"), "--db"),
    url: str = typer.Option(DEFAULT_COURSE_URL, "--url"),
) -> None:
    """Compare the local database against the live course counts."""
    cfg = _config(db, Path("data/cookies.json"), 4, 30.0, 3, "en")
    store = _open_store(cfg)
    try:
        counts = store.counts()
        slug = slug_from_course_url(url)
        console.print(f"local pyq={counts.get('pyq', 0)} practice={counts.get('practice', 0)} "
                      f"topics={counts['topics']} questions={counts['questions']}")
        try:
            session = _session(cfg)
        except AuthError as exc:
            err_console.print(f"[red]✗ cookies[/red] {exc}")
            raise typer.Exit(code=1) from exc

        async def probe() -> None:
            async with KgClient(session, concurrency=2, timeout=30.0, max_retries=3) as client:
                summary = await KgApi(client).course_summary(slug)
                live_pyq = summary.get("pyqCount", 0)
                live_practice = summary.get("practiceCount", 0)
                live_topics = summary.get("totalSubtopics", 0)
                console.print(f"live  pyq={live_pyq} practice={live_practice} topics={live_topics}")
                checks = [
                    ("pyq", counts.get("pyq", 0), live_pyq),
                    ("practice", counts.get("practice", 0), live_practice),
                    ("topics", counts["topics"], live_topics),
                ]
                bad = False
                for label, local, remote in checks:
                    ok = local == remote
                    bad = bad or not ok
                    console.print(
                        f"  {'[green]✓[/green]' if ok else '[red]✗[/red]'} {label}: "
                        f"local={local} live={remote}"
                    )
                if bad:
                    err_console.print("[yellow]counts differ - re-run kgscrape scrape[/yellow]")

        asyncio.run(probe())
    finally:
        store.close()


@app.command()
def version() -> None:
    """Print the version."""
    console.print(__version__)


def main() -> None:  # pragma: no cover
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
