"""Cookie based authentication against the KnowledgeGate API.

The platform hands out a short lived ``accessToken`` (1 hour) plus a long lived
``refreshToken``.  Both are stored in browser cookies, which is exactly the
format the user exports from their browser, so that file is our only input.

Nothing here ever prints a token.
"""

from __future__ import annotations

import base64
import binascii
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import API_BASE

#: Refresh a little before the token actually dies.
TOKEN_SKEW_SECONDS = 120


class AuthError(RuntimeError):
    """Raised when the session cannot be established or refreshed."""


def decode_jwt(token: str) -> dict[str, Any]:
    """Decode a JWT payload without verifying the signature (we cannot anyway)."""
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    payload += "=" * ((4 - len(payload) % 4) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload.encode()))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return {}


def _normalise(raw: Any) -> list[dict[str, Any]]:
    """Accept the list-of-cookies export format used by browser extensions."""
    if isinstance(raw, list):
        return [c for c in raw if isinstance(c, dict) and c.get("name")]
    if isinstance(raw, dict):
        # {name: value} or {name: {...}}
        out: list[dict[str, Any]] = []
        for name, value in raw.items():
            if isinstance(value, dict):
                entry = dict(value)
                entry.setdefault("name", name)
                if entry.get("name"):
                    out.append(entry)
            elif isinstance(value, str):
                out.append({"name": name, "value": value, "domain": ".knowledgegate.ai", "path": "/"})
        return out
    return []


@dataclass
class AuthSession:
    """Holds the cookie jar and knows how to renew the access token."""

    cookies_path: Path
    cookies: list[dict[str, Any]] = field(default_factory=list)
    _lock_free: bool = True

    # ------------------------------------------------------------------ load
    @classmethod
    def load(cls, cookies_path: Path) -> AuthSession:
        path = Path(cookies_path).expanduser()
        if not path.exists():
            raise AuthError(
                f"Cookie file not found: {path}\n"
                "Export your knowledgegate.ai cookies from the browser into that file "
                "(the browser extension 'cookies.json' export format works)."
            )
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AuthError(f"Could not read cookie file {path}: {exc}") from exc
        cookies = _normalise(raw)
        if not cookies:
            raise AuthError(f"Cookie file {path} contains no cookies.")
        return cls(cookies_path=path, cookies=cookies)

    # ------------------------------------------------------------- accessors
    @property
    def values(self) -> dict[str, str]:
        return {c["name"]: c.get("value", "") for c in self.cookies}

    def get(self, name: str) -> str | None:
        return self.values.get(name)

    @property
    def access_token(self) -> str | None:
        return self.get("accessToken")

    @property
    def refresh_token(self) -> str | None:
        return self.get("refreshToken")

    def cookie_header(self) -> str:
        return "; ".join(f"{c['name']}={c.get('value', '')}" for c in self.cookies)

    def access_expires_at(self) -> float:
        token = self.access_token
        if not token:
            return 0.0
        exp = decode_jwt(token).get("exp")
        return float(exp) if isinstance(exp, int | float) else 0.0

    def is_access_valid(self) -> bool:
        exp = self.access_expires_at()
        return bool(exp) and exp - TOKEN_SKEW_SECONDS > time.time()

    # --------------------------------------------------------------- refresh
    async def refresh(self, client: Any) -> dict[str, str]:
        """Exchange the refresh token for a fresh access/refresh pair."""
        if not self.refresh_token:
            raise AuthError("No refreshToken cookie present - please sign in to KnowledgeGate again.")

        response = await client.raw_post(
            f"{API_BASE}/auth/refresh-token",
            headers={
                "Cookie": self.cookie_header(),
                "Content-Type": "application/json",
                "Origin": "https://www.knowledgegate.ai",
                "Referer": "https://www.knowledgegate.ai/",
            },
            json_body={},
        )
        if response.status_code >= 400:
            raise AuthError(
                f"Token refresh failed (HTTP {response.status_code}): {response.text[:300]}"
            )
        payload = response.json()
        data = payload.get("data", payload)
        new_access = data.get("accessToken")
        new_refresh = data.get("refreshToken")
        if not new_access:
            raise AuthError(f"Unexpected refresh response: {payload!r}")

        self._set_cookie("accessToken", new_access)
        if new_refresh:
            self._set_cookie("refreshToken", new_refresh)
        self.save()
        return {"accessToken": new_access, "refreshToken": new_refresh or ""}

    def _set_cookie(self, name: str, value: str) -> None:
        for cookie in self.cookies:
            if cookie.get("name") == name:
                cookie["value"] = value
                return
        self.cookies.append(
            {"name": name, "value": value, "domain": ".knowledgegate.ai", "path": "/"}
        )

    # ----------------------------------------------------------------- save
    def save(self) -> None:
        path = Path(self.cookies_path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.cookies, indent=2), encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
