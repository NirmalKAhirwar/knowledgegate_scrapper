"""Async HTTP client for the KnowledgeGate API.

Handles the boring but important parts: cookie injection, transparent token
refresh on 401, exponential backoff on 429/5xx and a global concurrency cap.
"""

from __future__ import annotations

import asyncio
import random
import time
from typing import Any

import httpx

from . import API_BASE
from .auth import AuthError, AuthSession

RETRY_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class ApiError(RuntimeError):
    """A non retryable API failure."""

    def __init__(self, status: int, url: str, body: str = "") -> None:
        super().__init__(f"HTTP {status} for {url}: {body[:400]}")
        self.status = status
        self.url = url
        self.body = body


class DailyLimitReached(ApiError):
    """The free tier daily attempt/solution cap was hit."""

    def __init__(self, status: int, url: str, body: str, details: dict[str, Any]) -> None:
        super().__init__(status, url, body)
        self.details = details

    @property
    def bucket(self) -> str:
        return str(self.details.get("bucket") or "unknown")

    @property
    def used(self) -> int | None:
        value = self.details.get("used")
        return int(value) if isinstance(value, int | float) else None

    @property
    def limit(self) -> int | None:
        value = self.details.get("limit")
        return int(value) if isinstance(value, int | float) else None

    @property
    def resets_at(self) -> str | None:
        value = self.details.get("resetsAt")
        return str(value) if value else None


def _extract_limit_details(body: str) -> dict[str, Any]:
    """Pull {bucket, limit, used, resetsAt} out of a limit error body."""
    import json

    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return {}
    for candidate in (payload, payload.get("data") if isinstance(payload, dict) else None):
        if isinstance(candidate, dict) and candidate.get("details"):
            return dict(candidate["details"])
    if isinstance(payload, dict):
        details = {k: payload[k] for k in ("bucket", "limit", "used", "resetsAt") if k in payload}
        if details:
            return details
    return {}


class KgClient:
    """Thin, polite wrapper around the KnowledgeGate REST API."""

    def __init__(
        self,
        auth: AuthSession,
        *,
        base_url: str = API_BASE,
        concurrency: int = 8,
        timeout: float = 30.0,
        max_retries: int = 5,
        user_agent: str = "Mozilla/5.0",
    ) -> None:
        self.auth = auth
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._semaphore = asyncio.Semaphore(concurrency)
        self._refresh_lock = asyncio.Lock()
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout, connect=15.0),
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json",
                "Origin": "https://www.knowledgegate.ai",
                "Referer": "https://www.knowledgegate.ai/",
            },
            follow_redirects=True,
        )
        self.request_count = 0

    # ------------------------------------------------------------- lifecycle
    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> KgClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    # -------------------------------------------------------------- requests
    async def raw_post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json_body: Any = None,
    ) -> httpx.Response:
        """Unauthenticated-style POST used by the auth refresh flow."""
        async with self._semaphore:
            self.request_count += 1
            return await self._client.post(url, headers=headers, json=json_body)

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any = None,
        allow_status: tuple[int, ...] = (),
    ) -> Any:
        """Perform an API call, refreshing the session and retrying as needed."""
        url = path if path.startswith("http") else f"{self.base_url}/{path.lstrip('/')}"
        last_error: Exception | None = None

        for attempt in range(self.max_retries + 1):
            if attempt:
                await self._sleep_backoff(attempt)
            async with self._semaphore:
                self.request_count += 1
                try:
                    response = await self._client.request(
                        method,
                        url,
                        params=params,
                        json=json_body,
                        headers={"Cookie": self.auth.cookie_header()},
                    )
                except httpx.HTTPError as exc:
                    last_error = exc
                    continue

            if response.status_code in (200, 201, 204) or response.status_code in allow_status:
                if response.status_code == 204 or not response.content:
                    return {}
                try:
                    return response.json()
                except ValueError:
                    return {"_raw": response.text}

            if response.status_code == 401 and attempt == 0:
                try:
                    async with self._refresh_lock:
                        await self.auth.refresh(self)
                except AuthError:
                    raise
                continue

            if response.status_code in RETRY_STATUS:
                last_error = ApiError(response.status_code, url, response.text)
                continue

            if response.status_code == 400 and "_LIMIT_REACHED" in response.text:
                raise DailyLimitReached(
                    response.status_code, url, response.text, _extract_limit_details(response.text)
                )

            raise ApiError(response.status_code, url, response.text)

        raise ApiError(599, url, f"giving up after {self.max_retries} retries: {last_error}")

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Any:
        return await self.request("POST", path, **kwargs)

    async def download(self, path: str, *, params: dict[str, Any] | None = None) -> bytes:
        """Fetch a binary asset (PDF bundle, image, ...)."""
        url = path if path.startswith("http") else f"{self.base_url}/{path.lstrip('/')}"
        async with self._semaphore:
            self.request_count += 1
            response = await self._client.get(
                url, params=params, headers={"Cookie": self.auth.cookie_header()}
            )
        if response.status_code >= 400:
            raise ApiError(response.status_code, url, response.text)
        return response.content

    async def _sleep_backoff(self, attempt: int) -> None:
        delay = min(30.0, (2 ** (attempt - 1)) * 0.75) + random.uniform(0, 0.4)
        await asyncio.sleep(delay)

    # -------------------------------------------------------------- helpers
    @staticmethod
    def unwrap(payload: Any) -> Any:
        """Return the ``data`` member of an API envelope when present."""
        if isinstance(payload, dict) and "data" in payload and "success" in payload:
            return payload["data"]
        return payload
