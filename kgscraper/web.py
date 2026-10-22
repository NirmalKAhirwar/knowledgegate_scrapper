"""Helpers for building KnowledgeGate web links."""

from __future__ import annotations

from urllib.parse import quote

WEB_BASE = "https://www.knowledgegate.ai"


def _seg(value: str | None) -> str:
    return quote(str(value), safe="") if value else ""


def note_web_link(
    course_slug: str,
    module_slug: str | None,
    chapter_slug: str | None,
    topic_slug: str | None,
    note_slug: str | None,
) -> str:
    """In-app URL for a note lesson (opens the PDF viewer when signed in)."""
    parts = ["learn", _seg(course_slug)]
    for segment in (module_slug, chapter_slug, topic_slug, note_slug):
        if segment:
            parts.append(_seg(segment))
    return f"{WEB_BASE}/" + "/".join(parts)


def lesson_web_link(course_slug: str, *segments: str | None) -> str:
    parts = ["learn", _seg(course_slug)]
    for segment in segments:
        if segment:
            parts.append(_seg(segment))
    return f"{WEB_BASE}/" + "/".join(parts)


def course_web_link(course_slug: str) -> str:
    return f"{WEB_BASE}/learn/{_seg(course_slug)}?tab=content"
