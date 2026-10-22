"""Typed wrappers around the KnowledgeGate endpoints we rely on.

The endpoint map below was reverse engineered from the live site; every path
here is exercised by the ``kgscrape doctor`` command.
"""

from __future__ import annotations

from typing import Any

from .client import KgClient

#: Query string shared by every question-collection listing endpoint.
LIST_PARAMS = {
    "shape": "learnerWindow",
    "limit": 50,
    "sourceCategory": "all",
    "status": "all",
    "pyq": "all",
    "solution": "all",
}


def slug_from_course_url(url: str) -> str:
    """Extract the canonical slug from any KnowledgeGate course URL."""
    from urllib.parse import urlparse

    cleaned = url.strip()
    if "://" not in cleaned:
        cleaned = "https://" + cleaned
    path = urlparse(cleaned).path.strip("/")
    parts = [p for p in path.split("/") if p]
    if not parts:
        raise ValueError(f"Could not find a course slug in URL: {url!r}")
    if parts[0] in {"learn", "courses"}:
        parts = parts[1:]
    if not parts:
        raise ValueError(f"Could not find a course slug in URL: {url!r}")
    return parts[0]


class KgApi:
    """Convenience layer over :class:`~kgscraper.client.KgClient`."""

    def __init__(self, client: KgClient) -> None:
        self.client = client

    # ----------------------------------------------------------------- auth
    async def me(self) -> dict[str, Any]:
        return await self.client.get("/users/me")

    # -------------------------------------------------------------- course
    async def course_listing(self, slug: str) -> dict[str, Any]:
        payload = await self.client.get(f"/course-listings/slug/{slug}")
        return KgClient.unwrap(payload)

    async def course_summary(self, slug: str) -> dict[str, Any]:
        payload = await self.client.get(f"/course-content/student/course/{slug}/summary")
        return KgClient.unwrap(payload)

    async def module_tree(self, slug: str, module_slug: str) -> dict[str, Any]:
        payload = await self.client.get(f"/course-content/student/course/{slug}/modules/{module_slug}")
        return KgClient.unwrap(payload)

    async def free_mocks(self, slug: str) -> dict[str, Any]:
        payload = await self.client.get(f"/course-content/student/course/{slug}/free-mocks")
        return KgClient.unwrap(payload)

    # ------------------------------------------------------------ questions
    def _collection_path(self, slug: str, kind: str, scope: str, scope_id: str) -> str:
        return f"/course-content/student/course/{slug}/{kind}/{scope}/{scope_id}"

    async def question_list(
        self,
        slug: str,
        kind: str,
        scope: str,
        scope_id: str,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        params = dict(LIST_PARAMS)
        params["limit"] = limit
        if cursor:
            params["cursor"] = cursor
        payload = await self.client.get(
            self._collection_path(slug, kind, scope, scope_id), params=params
        )
        return KgClient.unwrap(payload)

    async def question_detail(
        self, slug: str, kind: str, scope: str, scope_id: str, question_id: str
    ) -> dict[str, Any]:
        path = f"{self._collection_path(slug, kind, scope, scope_id)}/question/{question_id}"
        payload = await self.client.get(path)
        return KgClient.unwrap(payload)

    async def question_progress(
        self, slug: str, kind: str, scope: str, scope_id: str, question_id: str
    ) -> dict[str, Any]:
        path = f"{self._collection_path(slug, kind, scope, scope_id)}/question/{question_id}/progress"
        payload = await self.client.get(path)
        return KgClient.unwrap(payload)

    async def submit_attempt(
        self,
        slug: str,
        kind: str,
        scope: str,
        scope_id: str,
        question_id: str,
        answer: Any,
        *,
        time_taken: int = 0,
    ) -> dict[str, Any]:
        """Record an attempt.  This is what unlocks the worked solution.

        The platform never ships the answer key to free accounts; the only way
        to learn it is to actually answer the question.  The response contains
        ``isCorrect`` plus per-option feedback, which is how the unlocker
        derives the key.

        This writes to the live KnowledgeGate account, so it is only ever called
        from the explicit ``kgscrape unlock`` command.
        """
        path = f"{self._collection_path(slug, kind, scope, scope_id)}/question/{question_id}/attempt"
        body: dict[str, Any] = {"answer": answer, "timeTaken": time_taken}
        payload = await self.client.post(path, json_body=body)
        return KgClient.unwrap(payload)

    async def attempt_progress(
        self,
        slug: str,
        kind: str,
        scope: str,
        scope_id: str,
        question_id: str,
    ) -> dict[str, Any]:
        """Read the recorded attempt for a question (does not consume budget)."""
        path = f"{self._collection_path(slug, kind, scope, scope_id)}/question/{question_id}/progress"
        payload = await self.client.get(path)
        return KgClient.unwrap(payload)

    # --------------------------------------------------------------- notes
    async def course_notes_status(
        self, course_listing_id: str, *, level: str | None = None, level_id: str | None = None
    ) -> dict[str, Any]:
        params = {}
        if level:
            params["level"] = level
        if level_id:
            params["levelId"] = level_id
        payload = await self.client.get(
            f"/course-notes/{course_listing_id}/status", params=params or None
        )
        return KgClient.unwrap(payload)

    async def course_notes_file(self, course_listing_id: str) -> bytes:
        """Download the notes bundle.  Requires a Plus/Pro admission."""
        return await self.client.download(
            f"/course-notes/{course_listing_id}/file", params={"download": "true"}
        )
