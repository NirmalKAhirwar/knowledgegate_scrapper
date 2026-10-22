"""JSON export of the scraped course."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence

from ..store import Store


def export_json(
    store: Store,
    *,
    scope: str = "course",
    scope_slug: str | None = None,
    kinds: Sequence[str] = ("pyq", "practice"),
    out: Path = Path("out/course.json"),
    limit: int | None = None,
) -> Path:
    filters: dict[str, Any] = {}
    if scope == "subject":
        filters["subject_slug"] = scope_slug
    elif scope == "chapter":
        filters["chapter_slug"] = scope_slug
    elif scope == "topic":
        filters["topic_slug"] = scope_slug

    rows = store.questions(kinds=kinds, limit=limit, **filters)
    questions: list[dict[str, Any]] = []
    for row in rows:
        options = [
            {
                "label": option["label"],
                "text": option["text"],
                "is_correct": bool(option["is_correct"]),
                "feedback": option["feedback"],
            }
            for option in store.options(row["id"])
        ]
        questions.append(
            {
                "id": row["id"],
                "kind": row["kind"],
                "number": row["number"],
                "question": row["question_text"],
                "instructions": row["instructions"],
                "language": row["language"],
                "exam": row["exam_name"],
                "exam_label": row["exam_label"],
                "year": row["year"],
                "answer": row["answer_correct_option"],
                "answer_source": row["answer_source"],
                "answer_available": bool(row["answer_available"]),
                "solution": row["solution_text"],
                "options": options,
            }
        )

    course_rows = store.courses()
    payload = {
        "course": dict(course_rows[0]) if course_rows else {},
        "counts": store.counts(),
        "questions": questions,
    }
    for key in ("raw_json",):
        if key in payload["course"]:
            payload["course"].pop(key, None)

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out
