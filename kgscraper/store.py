"""SQLite persistence for the scraped course, notes and practice history.

One file, no ORM, WAL mode so the Next.js frontend can read it while the
scraper writes.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

SCHEMA_VERSION = 1

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS course (
    id             TEXT PRIMARY KEY,
    slug           TEXT NOT NULL UNIQUE,
    canonical_url  TEXT,
    title          TEXT,
    extended_title TEXT,
    description    TEXT,
    image          TEXT,
    listing_id     TEXT,
    plan_tier      TEXT,
    pyq_count      INTEGER DEFAULT 0,
    practice_count INTEGER DEFAULT 0,
    total_topics   INTEGER DEFAULT 0,
    raw_json       TEXT,
    scraped_at     REAL
);

CREATE TABLE IF NOT EXISTS subject (
    id               TEXT PRIMARY KEY,
    course_id        TEXT NOT NULL,
    slug             TEXT NOT NULL,
    title            TEXT,
    ord              INTEGER DEFAULT 0,
    pyq_count        INTEGER DEFAULT 0,
    practice_count   INTEGER DEFAULT 0,
    duration_seconds REAL DEFAULT 0,
    pyq_percent      REAL,
    raw_json         TEXT
);
CREATE INDEX IF NOT EXISTS idx_subject_course ON subject(course_id, ord);

CREATE TABLE IF NOT EXISTS chapter (
    id             TEXT PRIMARY KEY,
    subject_id     TEXT NOT NULL,
    slug           TEXT NOT NULL,
    title          TEXT,
    ord            INTEGER DEFAULT 0,
    pyq_count      INTEGER DEFAULT 0,
    practice_count INTEGER DEFAULT 0,
    raw_json       TEXT
);
CREATE INDEX IF NOT EXISTS idx_chapter_subject ON chapter(subject_id, ord);

CREATE TABLE IF NOT EXISTS topic (
    id             TEXT PRIMARY KEY,
    chapter_id     TEXT NOT NULL,
    subject_id     TEXT NOT NULL,
    slug           TEXT,
    title          TEXT,
    ord            INTEGER DEFAULT 0,
    scope_id       TEXT,
    pyq_count      INTEGER DEFAULT 0,
    practice_count INTEGER DEFAULT 0,
    raw_json       TEXT
);
CREATE INDEX IF NOT EXISTS idx_topic_chapter ON topic(chapter_id, ord);
CREATE INDEX IF NOT EXISTS idx_topic_subject ON topic(subject_id);

CREATE TABLE IF NOT EXISTS question (
    id                    TEXT PRIMARY KEY,
    topic_id              TEXT,
    subject_id            TEXT,
    chapter_id            TEXT,
    kind                  TEXT,
    scope_id              TEXT,
    number                INTEGER,
    display_id            TEXT,
    type                  TEXT,
    title                 TEXT,
    question_text         TEXT,
    instructions          TEXT,
    solution_text         TEXT,
    answer_correct_option TEXT,
    answer_correct_options TEXT,
    answer_correct_answer TEXT,
    answer_available      INTEGER DEFAULT 0,
    answer_source         TEXT,
    has_video_solution    INTEGER DEFAULT 0,
    avg_success_rate      REAL,
    total_attempts        INTEGER,
    median_time_taken     REAL,
    source_category       TEXT,
    exam_label            TEXT,
    exam_slug             TEXT,
    exam_name             TEXT,
    year                  INTEGER,
    paper_label           TEXT,
    section_label         TEXT,
    language              TEXT,
    raw_json              TEXT,
    scraped_at            REAL
);
CREATE INDEX IF NOT EXISTS idx_question_topic ON question(topic_id, kind);
CREATE INDEX IF NOT EXISTS idx_question_subject ON question(subject_id, kind);
CREATE INDEX IF NOT EXISTS idx_question_kind ON question(kind);
CREATE INDEX IF NOT EXISTS idx_question_exam ON question(exam_slug);
CREATE INDEX IF NOT EXISTS idx_question_year ON question(year);

CREATE TABLE IF NOT EXISTS option (
    question_id  TEXT NOT NULL,
    ord          INTEGER NOT NULL,
    label        TEXT,
    text         TEXT,
    is_correct   INTEGER DEFAULT 0,
    feedback     TEXT,
    PRIMARY KEY (question_id, ord)
);

CREATE TABLE IF NOT EXISTS question_tag (
    question_id TEXT NOT NULL,
    exam_id     TEXT,
    exam_name   TEXT,
    exam_slug   TEXT,
    year        INTEGER,
    paper_label TEXT,
    section_label TEXT,
    label       TEXT,
    PRIMARY KEY (question_id, exam_id, year, paper_label, section_label)
);

CREATE TABLE IF NOT EXISTS note (
    id               TEXT PRIMARY KEY,
    topic_id         TEXT,
    subject_id       TEXT,
    kind             TEXT,
    title            TEXT,
    origin_id        TEXT,
    asset_url        TEXT,
    page_count       INTEGER,
    file_size        INTEGER,
    duration_seconds REAL,
    is_video         INTEGER DEFAULT 0,
    downloaded       INTEGER DEFAULT 0,
    local_path       TEXT,
    raw_json         TEXT
);
CREATE INDEX IF NOT EXISTS idx_note_topic ON note(topic_id);

CREATE TABLE IF NOT EXISTS attempt (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT,
    question_id     TEXT NOT NULL,
    topic_id        TEXT,
    subject_id      TEXT,
    kind            TEXT,
    selected_option TEXT,
    is_correct      INTEGER,
    elapsed_seconds REAL,
    answered_at     REAL,
    grading_source  TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempt_question ON attempt(question_id);
CREATE INDEX IF NOT EXISTS idx_attempt_session ON attempt(session_id);
CREATE INDEX IF NOT EXISTS idx_attempt_time ON attempt(answered_at);
CREATE INDEX IF NOT EXISTS idx_attempt_topic ON attempt(topic_id);
CREATE INDEX IF NOT EXISTS idx_attempt_subject ON attempt(subject_id);
CREATE INDEX IF NOT EXISTS idx_attempt_kind ON attempt(kind);

CREATE TABLE IF NOT EXISTS session (
    id         TEXT PRIMARY KEY,
    scope_json TEXT,
    kind       TEXT,
    started_at REAL,
    ended_at   REAL,
    total      INTEGER DEFAULT 0,
    correct    INTEGER DEFAULT 0,
    incorrect  INTEGER DEFAULT 0,
    skipped    INTEGER DEFAULT 0,
    mode       TEXT DEFAULT 'study',
    paused_seconds REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scrape_state (
    scope        TEXT PRIMARY KEY,
    total        INTEGER DEFAULT 0,
    done         INTEGER DEFAULT 0,
    updated_at   REAL
);
"""


class Store:
    """Thin, synchronous SQLite wrapper.  Not thread safe - one instance per thread."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, timeout=30.0, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

    # ------------------------------------------------------------- lifecycle
    def close(self) -> None:
        try:
            self.conn.commit()
        finally:
            self.conn.close()

    def _migrate(self) -> None:
        """Add columns introduced after the first schema version."""
        migrations = (
            ("attempt", "grading_source", "TEXT"),
            ("session", "mode", "TEXT DEFAULT 'study'"),
            ("session", "paused_seconds", "REAL DEFAULT 0"),
        )
        for table, column, definition in migrations:
            columns = {
                row["name"]
                for row in self.conn.execute(f"PRAGMA table_info({table})")
            }
            if column not in columns:
                self.conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
                )
        self.conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_attempt_time ON attempt(answered_at);
            CREATE INDEX IF NOT EXISTS idx_attempt_topic ON attempt(topic_id);
            CREATE INDEX IF NOT EXISTS idx_attempt_subject ON attempt(subject_id);
            CREATE INDEX IF NOT EXISTS idx_attempt_kind ON attempt(kind);
            """
        )

    def __enter__(self) -> Store:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def commit(self) -> None:
        self.conn.commit()

    # ----------------------------------------------------------------- meta
    def set_meta(self, key: str, value: Any) -> None:
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value) if not isinstance(value, str) else value),
        )

    def get_meta(self, key: str, default: Any = None) -> Any:
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    # --------------------------------------------------------------- course
    def upsert_course(self, course: dict[str, Any]) -> None:
        info = course.get("courseInfo", {}) or {}
        self.conn.execute(
            """
            INSERT INTO course (id, slug, canonical_url, title, extended_title, description,
                                image, listing_id, plan_tier, pyq_count, practice_count,
                                total_topics, raw_json, scraped_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                slug=excluded.slug, canonical_url=excluded.canonical_url, title=excluded.title,
                extended_title=excluded.extended_title, description=excluded.description,
                image=excluded.image, listing_id=excluded.listing_id, plan_tier=excluded.plan_tier,
                pyq_count=excluded.pyq_count, practice_count=excluded.practice_count,
                total_topics=excluded.total_topics, raw_json=excluded.raw_json,
                scraped_at=excluded.scraped_at
            """,
            (
                course.get("id") or course.get("courseListingId") or course.get("slug"),
                course.get("slug", ""),
                course.get("canonicalUrl"),
                info.get("courseName") or course.get("courseName"),
                info.get("extendedTitle"),
                course.get("courseDescription"),
                info.get("courseImage") or course.get("courseImage"),
                info.get("courseListingId") or course.get("courseListingId"),
                course.get("plan_tier"),
                int(course.get("pyqCount") or info.get("pyqCount") or 0),
                int(course.get("practiceCount") or info.get("practiceCount") or 0),
                int(course.get("totalSubtopics") or 0),
                json.dumps(course, ensure_ascii=False)[:4_000_000],
                time.time(),
            ),
        )

    # -------------------------------------------------------------- subjects
    def upsert_subject(self, subject: dict[str, Any]) -> None:
        self.conn.execute(
            """
            INSERT INTO subject (id, course_id, slug, title, ord, pyq_count, practice_count,
                                 duration_seconds, pyq_percent, raw_json)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                course_id=excluded.course_id, slug=excluded.slug, title=excluded.title,
                ord=excluded.ord, pyq_count=excluded.pyq_count,
                practice_count=excluded.practice_count,
                duration_seconds=excluded.duration_seconds, pyq_percent=excluded.pyq_percent,
                raw_json=excluded.raw_json
            """,
            (
                subject["id"],
                subject["course_id"],
                subject["slug"],
                subject.get("title"),
                int(subject.get("ord") or 0),
                int(subject.get("pyq_count") or 0),
                int(subject.get("practice_count") or 0),
                float(subject.get("duration_seconds") or 0),
                subject.get("pyq_percent"),
                json.dumps(subject.get("raw"), ensure_ascii=False)[:200_000],
            ),
        )

    def upsert_chapter(self, chapter: dict[str, Any]) -> None:
        self.conn.execute(
            """
            INSERT INTO chapter (id, subject_id, slug, title, ord, pyq_count, practice_count, raw_json)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                subject_id=excluded.subject_id, slug=excluded.slug, title=excluded.title,
                ord=excluded.ord, pyq_count=excluded.pyq_count,
                practice_count=excluded.practice_count, raw_json=excluded.raw_json
            """,
            (
                chapter["id"],
                chapter["subject_id"],
                chapter["slug"],
                chapter.get("title"),
                int(chapter.get("ord") or 0),
                int(chapter.get("pyq_count") or 0),
                int(chapter.get("practice_count") or 0),
                json.dumps(chapter.get("raw"), ensure_ascii=False)[:200_000],
            ),
        )

    def upsert_topic(self, topic: dict[str, Any]) -> None:
        self.conn.execute(
            """
            INSERT INTO topic (id, chapter_id, subject_id, slug, title, ord, scope_id,
                               pyq_count, practice_count, raw_json)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                chapter_id=excluded.chapter_id, subject_id=excluded.subject_id,
                slug=excluded.slug, title=excluded.title, ord=excluded.ord,
                scope_id=excluded.scope_id, pyq_count=excluded.pyq_count,
                practice_count=excluded.practice_count, raw_json=excluded.raw_json
            """,
            (
                topic["id"],
                topic["chapter_id"],
                topic["subject_id"],
                topic.get("slug"),
                topic.get("title"),
                int(topic.get("ord") or 0),
                topic.get("scope_id"),
                int(topic.get("pyq_count") or 0),
                int(topic.get("practice_count") or 0),
                json.dumps(topic.get("raw"), ensure_ascii=False)[:200_000],
            ),
        )

    # ------------------------------------------------------------- questions
    def upsert_question(self, question: dict[str, Any]) -> None:
        self.conn.execute(
            """
            INSERT INTO question (id, topic_id, subject_id, chapter_id, kind, scope_id, number,
                                  display_id, type, title, question_text, instructions,
                                  solution_text, answer_correct_option, answer_correct_options,
                                  answer_correct_answer, answer_available, answer_source, has_video_solution,
                                  avg_success_rate, total_attempts, median_time_taken,
                                  source_category, exam_label, exam_slug, exam_name, year,
                                  paper_label, section_label, language, raw_json, scraped_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                topic_id=excluded.topic_id, subject_id=excluded.subject_id,
                chapter_id=excluded.chapter_id, kind=excluded.kind, scope_id=excluded.scope_id,
                number=excluded.number, display_id=excluded.display_id, type=excluded.type,
                title=excluded.title, question_text=excluded.question_text,
                instructions=excluded.instructions,
                solution_text=COALESCE(excluded.solution_text, question.solution_text),
                answer_correct_option=COALESCE(excluded.answer_correct_option, question.answer_correct_option),
                answer_correct_options=COALESCE(excluded.answer_correct_options, question.answer_correct_options),
                answer_correct_answer=COALESCE(excluded.answer_correct_answer, question.answer_correct_answer),
                answer_available=excluded.answer_available,
                answer_source=COALESCE(excluded.answer_source, question.answer_source),
                has_video_solution=excluded.has_video_solution,
                avg_success_rate=excluded.avg_success_rate, total_attempts=excluded.total_attempts,
                median_time_taken=excluded.median_time_taken,
                source_category=excluded.source_category, exam_label=excluded.exam_label,
                exam_slug=excluded.exam_slug, exam_name=excluded.exam_name, year=excluded.year,
                paper_label=excluded.paper_label, section_label=excluded.section_label,
                language=excluded.language, raw_json=excluded.raw_json, scraped_at=excluded.scraped_at
            """,
            (
                question["id"],
                question.get("topic_id"),
                question.get("subject_id"),
                question.get("chapter_id"),
                question.get("kind"),
                question.get("scope_id"),
                question.get("number"),
                question.get("display_id"),
                question.get("type"),
                question.get("title"),
                question.get("question_text"),
                question.get("instructions"),
                question.get("solution_text"),
                question.get("answer_correct_option"),
                question.get("answer_correct_options"),
                question.get("answer_correct_answer"),
                int(bool(question.get("answer_available"))),
                question.get("answer_source"),
                int(bool(question.get("has_video_solution"))),
                question.get("avg_success_rate"),
                question.get("total_attempts"),
                question.get("median_time_taken"),
                question.get("source_category"),
                question.get("exam_label"),
                question.get("exam_slug"),
                question.get("exam_name"),
                question.get("year"),
                question.get("paper_label"),
                question.get("section_label"),
                question.get("language"),
                question.get("raw_json"),
                time.time(),
            ),
        )

    def replace_options(self, question_id: str, options: Sequence[dict[str, Any]]) -> None:
        self.conn.execute("DELETE FROM option WHERE question_id=?", (question_id,))
        if not options:
            return
        self.conn.executemany(
            "INSERT INTO option (question_id, ord, label, text, is_correct, feedback) "
            "VALUES (?,?,?,?,?,?)",
            [
                (
                    question_id,
                    int(o.get("ord", index)),
                    o.get("label"),
                    o.get("text"),
                    int(bool(o.get("is_correct"))),
                    o.get("feedback"),
                )
                for index, o in enumerate(options)
            ],
        )

    def replace_tags(self, question_id: str, tags: Iterable[dict[str, Any]]) -> None:
        self.conn.execute("DELETE FROM question_tag WHERE question_id=?", (question_id,))
        rows = [
            (
                question_id,
                t.get("exam_id"),
                t.get("exam_name"),
                t.get("exam_slug"),
                t.get("year"),
                t.get("paper_label"),
                t.get("section_label"),
                t.get("label"),
            )
            for t in tags
        ]
        if rows:
            self.conn.executemany(
                "INSERT OR IGNORE INTO question_tag (question_id, exam_id, exam_name, exam_slug, "
                "year, paper_label, section_label, label) VALUES (?,?,?,?,?,?,?,?)",
                rows,
            )

    # ----------------------------------------------------------------- notes
    def upsert_note(self, note: dict[str, Any]) -> None:
        self.conn.execute(
            """
            INSERT INTO note (id, topic_id, subject_id, kind, title, origin_id, asset_url,
                              page_count, file_size, duration_seconds, is_video, downloaded,
                              local_path, raw_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                topic_id=excluded.topic_id, subject_id=excluded.subject_id, kind=excluded.kind,
                title=excluded.title, origin_id=excluded.origin_id, asset_url=excluded.asset_url,
                page_count=excluded.page_count, file_size=excluded.file_size,
                duration_seconds=excluded.duration_seconds, is_video=excluded.is_video,
                downloaded=excluded.downloaded, local_path=excluded.local_path,
                raw_json=excluded.raw_json
            """,
            (
                note["id"],
                note.get("topic_id"),
                note.get("subject_id"),
                note.get("kind"),
                note.get("title"),
                note.get("origin_id"),
                note.get("asset_url"),
                note.get("page_count"),
                note.get("file_size"),
                note.get("duration_seconds"),
                int(bool(note.get("is_video"))),
                int(bool(note.get("downloaded"))),
                note.get("local_path"),
                json.dumps(note.get("raw"), ensure_ascii=False)[:200_000],
            ),
        )

    # ---------------------------------------------------------- scrape state
    def get_scrape_state(self, scope: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM scrape_state WHERE scope=?", (scope,)).fetchone()
        if not row:
            return {"scope": scope, "total": 0, "done": 0}
        return dict(row)

    def set_scrape_state(self, scope: str, total: int, done: int) -> None:
        self.conn.execute(
            "INSERT INTO scrape_state (scope, total, done, updated_at) VALUES (?,?,?,?) "
            "ON CONFLICT(scope) DO UPDATE SET total=excluded.total, done=excluded.done, "
            "updated_at=excluded.updated_at",
            (scope, total, done, time.time()),
        )

    def scraped_question_ids(self) -> set[str]:
        return {r["id"] for r in self.conn.execute("SELECT id FROM question")}

    # ------------------------------------------------------------- unlocking
    def unlock_candidates(
        self,
        *,
        kinds: Sequence[str] = ("pyq", "practice"),
        limit: int = 50,
        subject_slug: str | None = None,
        chapter_slug: str | None = None,
    ) -> list[sqlite3.Row]:
        """Questions that still need an answer key, cheapest first."""
        where = ["answer_available=0"]
        params: list[Any] = []
        if kinds:
            where.append(f"kind IN ({','.join('?' * len(kinds))})")
            params.extend(kinds)
        if subject_slug:
            where.append("subject_id IN (SELECT id FROM subject WHERE slug=?)")
            params.append(subject_slug)
        if chapter_slug:
            where.append("chapter_id IN (SELECT id FROM chapter WHERE slug=?)")
            params.append(chapter_slug)
        sql = (
            "SELECT q.* FROM question q WHERE "
            + " AND ".join(where)
            + " ORDER BY (SELECT COUNT(*) FROM option o WHERE o.question_id=q.id), q.kind, q.id"
            + " LIMIT ?"
        )
        params.append(limit)
        return list(self.conn.execute(sql, params))

    def set_answer(
        self,
        question_id: str,
        *,
        option_ids: Sequence[int],
        source: str = "verified",
        solution_text: str | None = None,
    ) -> None:
        """Store the answer key for a question."""
        ids = [str(i) for i in option_ids]
        self.conn.execute(
            "UPDATE question SET answer_correct_option=?, answer_correct_options=?, "
            "answer_available=1, answer_source=?, solution_text=COALESCE(?, solution_text) "
            "WHERE id=?",
            (
                ids[0] if ids else None,
                json.dumps(ids) if ids else None,
                source,
                solution_text,
                question_id,
            ),
        )
        for option_id in ids:
            self.conn.execute(
                "UPDATE option SET is_correct=1 WHERE question_id=? AND ord=?",
                (question_id, int(option_id)),
            )

    def set_option_feedback(
        self, question_id: str, option_ord: int, feedback: str | None
    ) -> None:
        """Store the per-option explanation returned by the attempt endpoint."""
        self.conn.execute(
            "UPDATE option SET feedback=COALESCE(?, feedback) WHERE question_id=? AND ord=?",
            (feedback, question_id, int(option_ord)),
        )

    # -------------------------------------------------------------- queries
    def courses(self) -> list[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM course ORDER BY title"))

    def course(self, slug: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM course WHERE slug=?", (slug,)).fetchone()

    def subjects(self, course_id: str | None = None) -> list[sqlite3.Row]:
        if course_id:
            return list(
                self.conn.execute(
                    "SELECT * FROM subject WHERE course_id=? ORDER BY ord, title", (course_id,)
                )
            )
        return list(self.conn.execute("SELECT * FROM subject ORDER BY ord, title"))

    def chapters(self, subject_id: str) -> list[sqlite3.Row]:
        return list(
            self.conn.execute("SELECT * FROM chapter WHERE subject_id=? ORDER BY ord, title", (subject_id,))
        )

    def topics(self, chapter_id: str) -> list[sqlite3.Row]:
        return list(
            self.conn.execute("SELECT * FROM topic WHERE chapter_id=? ORDER BY ord, title", (chapter_id,))
        )

    def questions(
        self,
        *,
        subject_slug: str | None = None,
        chapter_slug: str | None = None,
        topic_slug: str | None = None,
        topic_id: str | None = None,
        kinds: Sequence[str] = ("pyq", "practice"),
        exam_slug: str | None = None,
        year: int | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[sqlite3.Row]:
        where: list[str] = []
        params: list[Any] = []
        if subject_slug:
            where.append("q.subject_id IN (SELECT id FROM subject WHERE slug=?)")
            params.append(subject_slug)
        if chapter_slug:
            where.append("q.chapter_id IN (SELECT id FROM chapter WHERE slug=?)")
            params.append(chapter_slug)
        if topic_slug:
            where.append("q.topic_id IN (SELECT id FROM topic WHERE slug=?)")
            params.append(topic_slug)
        if topic_id:
            where.append("q.topic_id=?")
            params.append(topic_id)
        if kinds:
            where.append(f"q.kind IN ({','.join('?' * len(kinds))})")
            params.extend(kinds)
        if exam_slug:
            where.append("q.exam_slug=?")
            params.append(exam_slug)
        if year:
            where.append("q.year=?")
            params.append(year)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        sql = f"SELECT q.* FROM question q {clause} ORDER BY q.subject_id, q.chapter_id, q.topic_id, q.number"
        if limit:
            sql += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        elif offset:
            sql += " LIMIT -1 OFFSET ?"
            params.append(offset)
        return list(self.conn.execute(sql, params))

    def options(self, question_id: str) -> list[sqlite3.Row]:
        return list(
            self.conn.execute(
                "SELECT * FROM option WHERE question_id=? ORDER BY ord", (question_id,)
            )
        )

    def tags(self, question_id: str) -> list[sqlite3.Row]:
        return list(
            self.conn.execute("SELECT * FROM question_tag WHERE question_id=?", (question_id,))
        )

    def notes(self, topic_id: str | None = None, include_videos: bool = False) -> list[sqlite3.Row]:
        where: list[str] = []
        params: list[Any] = []
        if topic_id:
            where.append("topic_id=?")
            params.append(topic_id)
        if not include_videos:
            where.append("kind != 'video'")
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        return list(self.conn.execute(f"SELECT * FROM note {clause} ORDER BY title", params))

    def counts(self) -> dict[str, int]:
        row = self.conn.execute(
            "SELECT kind, COUNT(*) c FROM question GROUP BY kind"
        ).fetchall()
        out = {r["kind"]: r["c"] for r in row}
        out["questions"] = sum(out.values())
        out["topics"] = self.conn.execute("SELECT COUNT(*) c FROM topic").fetchone()["c"]
        out["chapters"] = self.conn.execute("SELECT COUNT(*) c FROM chapter").fetchone()["c"]
        out["subjects"] = self.conn.execute("SELECT COUNT(*) c FROM subject").fetchone()["c"]
        out["notes"] = self.conn.execute("SELECT COUNT(*) c FROM note").fetchone()["c"]
        out["answers_available"] = self.conn.execute(
            "SELECT COUNT(*) c FROM question WHERE answer_available=1"
        ).fetchone()["c"]
        return out

    # ------------------------------------------------------------- practice
    def start_session(
        self,
        session_id: str,
        scope: dict[str, Any],
        kind: str,
        total: int,
        mode: str = "study",
    ) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO session (id, scope_json, kind, started_at, total, mode) "
            "VALUES (?,?,?,?,?,?)",
            (session_id, json.dumps(scope), kind, time.time(), total, mode),
        )

    def finish_session(self, session_id: str, correct: int, incorrect: int, skipped: int) -> None:
        self.conn.execute(
            "UPDATE session SET ended_at=?, correct=?, incorrect=?, skipped=? WHERE id=?",
            (time.time(), correct, incorrect, skipped, session_id),
        )

    def record_attempt(
        self,
        session_id: str,
        question_id: str,
        *,
        topic_id: str | None,
        subject_id: str | None,
        kind: str | None,
        selected_option: str | None,
        is_correct: bool | None,
        elapsed_seconds: float | None,
        grading_source: str | None = None,
    ) -> None:
        self.conn.execute(
            "INSERT INTO attempt (session_id, question_id, topic_id, subject_id, kind, "
            "selected_option, is_correct, elapsed_seconds, answered_at, grading_source) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                session_id,
                question_id,
                topic_id,
                subject_id,
                kind,
                selected_option,
                None if is_correct is None else int(is_correct),
                elapsed_seconds,
                time.time(),
                grading_source,
            ),
        )
