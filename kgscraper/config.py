"""Runtime configuration for the scraper and the offline app."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_DB = Path("data/kg.db")
DEFAULT_COOKIES = Path("data/cookies.json")
SEED_COOKIES = Path("cookies.json")

#: Question collections the platform exposes per topic.
KINDS = ("pyq", "practice")


@dataclass(slots=True)
class Config:
    """Everything the CLI needs to talk to the API and touch the local disk."""

    db_path: Path = DEFAULT_DB
    cookies_path: Path = DEFAULT_COOKIES
    concurrency: int = 8
    timeout: float = 30.0
    max_retries: int = 5
    lang: str = "en"
    kinds: tuple[str, ...] = KINDS
    include_notes: bool = True
    download_notes: bool = False
    user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
    extra: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.db_path = Path(self.db_path).expanduser()
        self.cookies_path = Path(self.cookies_path).expanduser()
        self.concurrency = max(1, min(int(self.concurrency), 16))

    def ensure_dirs(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.cookies_path.parent.mkdir(parents=True, exist_ok=True)

    def resolve_cookies_path(self) -> Path:
        """Prefer the working copy, fall back to the seed file in the repo root."""
        if self.cookies_path.exists():
            return self.cookies_path
        if SEED_COOKIES.exists():
            return SEED_COOKIES
        return self.cookies_path


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default
