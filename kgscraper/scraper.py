"""Scrape a whole KnowledgeGate course into SQLite.

Flow::

    course URL -> slug
      -> GET /course-content/student/course/{slug}/summary      (course + module list)
      -> GET .../modules/{moduleSlug}                          (subject -> chapter -> topic)
      -> GET .../{pyq|practice}/subtopic/{scopeId}/question/{id}  (one per question)

The API expects the *collection* ``originId`` as the scope id, not the id of
the topic node in the tree - using the wrong one returns HTTP 400.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

from .api import KgApi
from .richtext import doc_to_html, doc_to_markdown, doc_to_text, extract_text
from .store import Store
from .web import note_web_link

VIDEO_TYPES = frozenset({"drm-video", "standard-video", "video", "live-video"})
COLLECTION_TYPES = frozenset({"pyq", "practice"})


@dataclass
class ScrapeStats:
    """Counters surfaced to the CLI."""

    subjects: int = 0
    chapters: int = 0
    topics: int = 0
    questions_total: int = 0
    questions_fetched: int = 0
    questions_skipped: int = 0
    notes: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    elapsed: float = 0.0

    @property
    def rate(self) -> float:
        if self.elapsed <= 0:
            return 0.0
        return self.questions_fetched / self.elapsed


@dataclass
class _Pending:
    """A question that still needs to be fetched."""

    question_id: str
    kind: str
    scope_id: str
    topic_id: str
    subject_id: str
    chapter_id: str


class _NullProgress:
    """No-op progress reporter."""

    def message(self, text: str) -> None:
        pass

    def advance(self, done: int, total: int) -> None:
        pass


def _as_progress(reporter: Any) -> Any:
    """Accept either a reporter object, a plain callable, or None."""
    if reporter is None:
        return _NullProgress()
    if hasattr(reporter, "message") and hasattr(reporter, "advance"):
        return reporter
    if callable(reporter):
        class _Callback:
            def message(self, text: str) -> None:
                reporter(text)

            def advance(self, done: int, total: int) -> None:
                pass

        return _Callback()
    return _NullProgress()


def _option_label(index: int) -> str:
    return chr(ord("A") + index)


def _extract_answer(detail: dict[str, Any]) -> dict[str, Any]:
    """Pull the answer key + solution out of a question detail payload."""
    answer = detail.get("answer") or {}
    correct_option = answer.get("correctOption")
    correct_options = answer.get("correctOptions")
    correct_answer = answer.get("correctAnswer")
    if correct_option is None and correct_options is None and correct_answer is None:
        # Some payloads put the key directly on the question.
        for key in ("correctOption", "correctOptions", "correctAnswer"):
            if detail.get(key) is not None:
                if key == "correctOption":
                    correct_option = detail[key]
                elif key == "correctOptions":
                    correct_options = detail[key]
                else:
                    correct_answer = detail[key]
                break
    return {
        "answer_correct_option": None if correct_option is None else str(correct_option),
        "answer_correct_options": None if correct_options is None else json.dumps(correct_options),
        "answer_correct_answer": None if correct_answer is None else str(correct_answer),
    }


def _extract_tags(detail: dict[str, Any]) -> list[dict[str, Any]]:
    tags: list[dict[str, Any]] = []
    for tag in detail.get("pyqVisibleTags") or []:
        tags.append(
            {
                "exam_id": tag.get("examId"),
                "exam_name": tag.get("examDisplayName"),
                "exam_slug": tag.get("examSlug"),
                "year": tag.get("cycleYear"),
                "paper_label": tag.get("paperLabel"),
                "section_label": tag.get("sectionLabel"),
                "label": tag.get("label"),
            }
        )
    for tag in detail.get("pyqTags") or []:
        if not isinstance(tag, dict):
            continue
        tags.append(
            {
                "exam_id": tag.get("examId") or tag.get("_id"),
                "exam_name": tag.get("examDisplayName") or tag.get("name"),
                "exam_slug": tag.get("examSlug") or tag.get("slug"),
                "year": tag.get("cycleYear") or tag.get("year"),
                "paper_label": tag.get("paperLabel") or tag.get("paper"),
                "section_label": tag.get("sectionLabel") or tag.get("section"),
                "label": tag.get("label") or tag.get("name"),
            }
        )
    return tags


def _primary_tag(tags: list[dict[str, Any]]) -> dict[str, Any]:
    for tag in tags:
        if tag.get("exam_name") or tag.get("year"):
            return tag
    return {}


class CourseScraper:
    """Drives the full download of one course."""

    def __init__(
        self,
        api: KgApi,
        store: Store,
        *,
        slug: str,
        kinds: Iterable[str] = ("pyq", "practice"),
        concurrency: int = 8,
        lang: str = "en",
        resume: bool = True,
        include_notes: bool = True,
        question_limit: int | None = None,
    ) -> None:
        self.api = api
        self.store = store
        self.slug = slug
        self.kinds = tuple(kinds)
        self.concurrency = concurrency
        self.lang = lang
        self.resume = resume
        self.include_notes = include_notes
        self.question_limit = question_limit
        self.stats = ScrapeStats()

    # ------------------------------------------------------------------ run
    async def run(self, progress=None) -> ScrapeStats:
        started = time.time()
        reporter = _as_progress(progress)
        try:
            await self._scrape_structure(reporter)
            await self._scrape_questions(reporter)
        finally:
            self.stats.elapsed = time.time() - started
            self.store.commit()
        return self.stats

    # ------------------------------------------------------------ structure
    async def _scrape_structure(self, progress=None) -> None:
        progress.message("Fetching course summary…")
        summary = await self.api.course_summary(self.slug)
        listing = await self.api.course_listing(self.slug)

        course_payload = {
            "id": listing.get("_id") or listing.get("courseListingId"),
            "slug": listing.get("slug") or self.slug,
            "canonicalUrl": listing.get("canonicalUrl"),
            "courseName": listing.get("courseName"),
            "extendedTitle": listing.get("extendedTitle"),
            "courseDescription": listing.get("courseDescription"),
            "courseImage": listing.get("courseImage"),
            "courseListingId": listing.get("courseListingId"),
            "pyqCount": summary.get("pyqCount"),
            "practiceCount": summary.get("practiceCount"),
            "totalSubtopics": summary.get("totalSubtopics"),
            "courseInfo": summary.get("courseInfo", {}),
            "raw_listing": listing,
        }
        self.store.upsert_course(course_payload)
        course_id = course_payload["id"]

        modules = summary.get("moduleSummaries") or []
        self.stats.subjects = len(modules)
        pending: list[_Pending] = []
        seen_questions: set[str] = set()

        for module in modules:
            module_slug = module.get("slug")
            if not module_slug:
                continue
            progress.message(f"Fetching tree: {module.get('title')}")
            tree = await self.api.module_tree(self.slug, module_slug)
            module_node = tree.get("module") or {}
            subject_id = module_node.get("id") or module.get("id")

            self.store.upsert_subject(
                {
                    "id": subject_id,
                    "course_id": course_id,
                    "slug": module_slug,
                    "title": module_node.get("title") or module.get("title"),
                    "ord": module.get("order", 0),
                    "pyq_count": module.get("pyqCount", 0),
                    "practice_count": module.get("practiceCount", 0),
                    "duration_seconds": module.get("durationSeconds", 0),
                    "pyq_percent": module.get("pyqPercentOfCourse"),
                    "raw": module,
                }
            )

            for chapter_ord, chapter_node in enumerate(module_node.get("items") or []):
                if chapter_node.get("itemType") not in (None, "topic"):
                    continue
                chapter_id = chapter_node.get("id")
                chapter_slug = chapter_node.get("slug")
                self.store.upsert_chapter(
                    {
                        "id": chapter_id,
                        "subject_id": subject_id,
                        "slug": chapter_slug,
                        "title": chapter_node.get("title"),
                        "ord": chapter_ord,
                        "pyq_count": 0,
                        "practice_count": 0,
                        "raw": chapter_node,
                    }
                )
                self.stats.chapters += 1

                chapter_pyq = 0
                chapter_practice = 0

                for topic_ord, topic_node in enumerate(chapter_node.get("items") or []):
                    topic_kind = topic_node.get("itemType")
                    if topic_kind == "topic":
                        # A chapter can hold a nested collection list.
                        continue
                    if topic_kind not in (None, "subtopic"):
                        continue

                    topic_id = topic_node.get("id")
                    topic_slug = topic_node.get("slug")
                    self.store.upsert_topic(
                        {
                            "id": topic_id,
                            "chapter_id": chapter_id,
                            "subject_id": subject_id,
                            "slug": topic_slug,
                            "title": topic_node.get("title"),
                            "ord": topic_ord,
                            "scope_id": None,
                            "pyq_count": 0,
                            "practice_count": 0,
                            "raw": topic_node,
                        }
                    )
                    self.stats.topics += 1

                    topic_pyq = 0
                    topic_practice = 0
                    scope_ids: dict[str, str] = {}

                    for lesson in topic_node.get("items") or []:
                        lesson_type = lesson.get("type")
                        origin_type = lesson.get("originType")

                        if lesson_type in COLLECTION_TYPES:
                            scope_id = lesson.get("originId")
                            if scope_id:
                                scope_ids[lesson_type] = scope_id
                            ids = lesson.get("questionIds") or []
                            if lesson_type == "pyq":
                                topic_pyq += len(ids)
                            else:
                                topic_practice += len(ids)
                            for qid in ids:
                                if qid in seen_questions:
                                    continue
                                seen_questions.add(qid)
                                pending.append(
                                    _Pending(
                                        question_id=qid,
                                        kind=lesson_type,
                                        scope_id=scope_id,
                                        topic_id=topic_id,
                                        subject_id=subject_id,
                                        chapter_id=chapter_id,
                                    )
                                )
                        elif lesson_type == "pdf" and self.include_notes:
                            self._index_note(
                                note=lesson,
                                topic_id=topic_id,
                                subject_id=subject_id,
                                module_slug=module_slug,
                                chapter_slug=chapter_slug,
                                topic_slug=topic_slug,
                            )
                        elif lesson_type in VIDEO_TYPES:
                            continue

                    # Store the scope id + counts on the topic row.
                    self.store.conn.execute(
                        "UPDATE topic SET scope_id=?, pyq_count=?, practice_count=? WHERE id=?",
                        (scope_ids.get("pyq") or scope_ids.get("practice"), topic_pyq, topic_practice, topic_id),
                    )
                    chapter_pyq += topic_pyq
                    chapter_practice += topic_practice

                self.store.conn.execute(
                    "UPDATE chapter SET pyq_count=?, practice_count=? WHERE id=?",
                    (chapter_pyq, chapter_practice, chapter_id),
                )

            self.store.commit()

        self.store.conn.execute(
            "UPDATE course SET total_topics=? WHERE id=?", (self.stats.topics, course_id)
        )
        self.store.set_scrape_state(f"questions:{self.slug}", len(pending), 0)
        self.store.commit()
        self._pending = pending

    # --------------------------------------------------------------- notes
    def _index_note(
        self,
        *,
        note: dict[str, Any],
        topic_id: str,
        subject_id: str,
        module_slug: str,
        chapter_slug: str | None,
        topic_slug: str | None,
    ) -> None:
        meta = note.get("assetMetadata") or {}
        note_id = note.get("id") or note.get("originId")
        self.store.upsert_note(
            {
                "id": note_id,
                "topic_id": topic_id,
                "subject_id": subject_id,
                "kind": "pdf",
                "title": note.get("title"),
                "origin_id": note.get("originId"),
                "asset_url": note_web_link(self.slug, module_slug, chapter_slug, topic_slug, note.get("slug")),
                "page_count": meta.get("pageCount"),
                "file_size": meta.get("fileSize"),
                "duration_seconds": note.get("durationSeconds") or 0,
                "is_video": False,
                "raw": note,
            }
        )
        self.stats.notes += 1

    # ----------------------------------------------------------- questions
    async def _scrape_questions(self, progress: Any = None) -> None:
        progress = _as_progress(progress)
        pending = getattr(self, "_pending", [])
        if not pending:
            return

        already = self.store.scraped_question_ids() if self.resume else set()
        todo = [p for p in pending if p.question_id not in already]
        if self.question_limit:
            todo = todo[: self.question_limit]
        self.stats.questions_skipped = len(pending) - len(todo)
        self.stats.questions_total = len(pending)

        progress.message(
            f"Fetching {len(todo)} questions "
            f"({len(already)} already stored) at concurrency {self.concurrency}…"
        )
        if not todo:
            self.store.set_scrape_state(f"questions:{self.slug}", 0, 0)
            self.store.commit()
            return

        work: asyncio.Queue[_Pending | None] = asyncio.Queue()
        results: asyncio.Queue[tuple[_Pending, dict[str, Any] | None, Exception | None]] = (
            asyncio.Queue()
        )
        for item in todo:
            work.put_nowait(item)

        async def worker() -> None:
            while True:
                item = await work.get()
                try:
                    if item is None:
                        return
                    try:
                        detail = await self.api.question_detail(
                            self.slug,
                            item.kind,
                            "subtopic",
                            item.scope_id,
                            item.question_id,
                        )
                        await results.put((item, detail, None))
                    except Exception as exc:  # noqa: BLE001 - reported, not fatal
                        await results.put((item, None, exc))
                finally:
                    work.task_done()

        workers = [asyncio.create_task(worker()) for _ in range(self.concurrency)]
        for _ in workers:
            work.put_nowait(None)

        done = 0
        last_report = 0.0
        started = time.time()
        try:
            while done < len(todo):
                item, detail, error = await results.get()
                done += 1
                if error is not None:
                    self.stats.errors.append(f"{item.question_id}: {error}")
                elif detail is not None:
                    try:
                        self._store_question(item, detail)
                        self.stats.questions_fetched += 1
                    except Exception as exc:  # noqa: BLE001
                        self.stats.errors.append(f"{item.question_id} (store): {exc}")

                now = time.time()
                if now - last_report >= 0.5:
                    last_report = now
                    progress.advance(done, len(todo))
                    progress.message(
                        f"Downloading questions · {done}/{len(todo)} · "
                        f"{done / max(now - started, 0.001):.0f}/s"
                    )
                if done % 200 == 0:
                    self.store.commit()
                    self.store.set_scrape_state(
                        f"questions:{self.slug}", len(todo), self.stats.questions_skipped + done
                    )
        finally:
            await asyncio.gather(*workers, return_exceptions=True)

        self.store.commit()
        self.store.set_scrape_state(
            f"questions:{self.slug}", len(todo), self.stats.questions_skipped + done
        )
        self.store.commit()
        progress.message(f"Stored {done} questions")

    # ------------------------------------------------------------- persist
    def _store_question(self, item: _Pending, detail: dict[str, Any]) -> None:
        lang = self.lang
        question_text = doc_to_text(detail.get("questionText"))
        instructions = doc_to_text(detail.get("instructions"))
        solution = extract_text(detail.get("solution"), lang)
        answer = _extract_answer(detail)
        tags = _extract_tags(detail)
        primary = _primary_tag(tags)

        analytics = detail.get("analytics") or {}
        glob = analytics.get("global") or {}

        options: list[dict[str, Any]] = []
        for index, option in enumerate(detail.get("options") or []):
            options.append(
                {
                    "ord": option.get("order", index),
                    "label": _option_label(index),
                    "text": doc_to_text(option.get("text")),
                    "is_correct": bool(option.get("isCorrect")),
                    "feedback": extract_text(option.get("feedback"), lang) or None,
                }
            )

        correct_ids = set()
        if answer["answer_correct_option"]:
            correct_ids.add(answer["answer_correct_option"])
        if answer["answer_correct_options"]:
            try:
                correct_ids.update(str(x) for x in json.loads(answer["answer_correct_options"]))
            except (ValueError, TypeError):
                pass
        for option in options:
            option["is_correct"] = bool(option.get("is_correct")) or str(option["ord"]) in correct_ids

        has_answer = bool(
            answer["answer_correct_option"]
            or answer["answer_correct_options"]
            or answer["answer_correct_answer"]
        )

        self.store.upsert_question(
            {
                "id": detail.get("questionId") or item.question_id,
                "topic_id": item.topic_id,
                "subject_id": item.subject_id,
                "chapter_id": item.chapter_id,
                "kind": item.kind,
                "scope_id": item.scope_id,
                "number": detail.get("questionNumber"),
                "display_id": detail.get("displayId"),
                "type": detail.get("type"),
                "title": detail.get("title"),
                "question_text": question_text,
                "instructions": instructions or None,
                "solution_text": solution or None,
                **answer,
                "answer_available": int(has_answer),
                "has_video_solution": bool(detail.get("hasVideoSolution")),
                "avg_success_rate": glob.get("avgSuccessRate"),
                "total_attempts": glob.get("totalAttempts"),
                "median_time_taken": glob.get("medianTimeTaken"),
                "source_category": detail.get("sourceCategory"),
                "exam_label": primary.get("label"),
                "exam_slug": primary.get("exam_slug"),
                "exam_name": primary.get("exam_name"),
                "year": primary.get("year"),
                "paper_label": primary.get("paper_label"),
                "section_label": primary.get("section_label"),
                "language": detail.get("primaryLanguage") or lang,
                "raw_json": json.dumps(detail, ensure_ascii=False)[:2_000_000],
            }
        )
        self.store.replace_options(detail.get("questionId") or item.question_id, options)
        self.store.replace_tags(detail.get("questionId") or item.question_id, tags)


def markdown_of(detail: dict[str, Any]) -> str:
    """Markdown rendering of a question detail payload (used by the md exporter)."""
    parts = [doc_to_markdown(detail.get("questionText"))]
    instructions = doc_to_markdown(detail.get("instructions"))
    if instructions:
        parts.append(instructions)
    return "\n\n".join(p for p in parts if p)


def html_of(detail: dict[str, Any]) -> str:
    """HTML rendering of a question detail payload."""
    parts = [doc_to_html(detail.get("questionText"))]
    instructions = doc_to_html(detail.get("instructions"))
    if instructions:
        parts.append(instructions)
    return "<br/>".join(p for p in parts if p)
