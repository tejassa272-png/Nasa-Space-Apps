import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy.engine import URL, make_url

Role = Literal["viewer", "operator", "telemetry"]
DEMO_ORIGINS = (
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5178", "http://127.0.0.1:5178",
)
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9._~-]{32,256}")


def read_secret(name: str) -> str:
    value = os.getenv(name, "")
    file = os.getenv(f"{name}_FILE", "")
    if file:
        if value:
            raise ValueError(f"Set either {name} or {name}_FILE.")
        value = Path(file).read_text(encoding="utf-8")
    return value.strip()


def flag(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if value in {"1", "true", "yes"}:
        return True
    if value in {"0", "false", "no"}:
        return False
    if value:
        raise ValueError(f"{name} must be true or false.")
    return default


def database_url(mode: str) -> URL:
    explicit = read_secret("DATABASE_URL")
    host = os.getenv("POSTGRES_HOST", "").strip()
    if explicit:
        url = make_url(explicit)
    elif host:
        url = URL.create(
            "postgresql+psycopg2",
            username=os.getenv("POSTGRES_USER", "astrotwin"),
            password=read_secret("POSTGRES_PASSWORD"),
            host=host,
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            database=os.getenv("POSTGRES_DB", "astrotwin"),
        )
    else:
        url = make_url("sqlite:///./astrotwin.db")

    if url.get_backend_name() not in {"postgresql", "sqlite"}:
        raise ValueError("Use PostgreSQL or, in demo mode, SQLite.")
    if mode == "production":
        if url.get_backend_name() != "postgresql" or not url.password or not url.host:
            raise ValueError("Production mode requires a PostgreSQL host and password.")
        if url.password in {"deepspacepassword", "astrotwin-demo-password", "postgres"}:
            raise ValueError("Production PostgreSQL requires a deployment-specific password.")
    return url


@dataclass(frozen=True)
class Settings:
    mode: Literal["demo", "production"]
    database: URL
    seed_inventory: bool
    cors_origins: tuple[str, ...]
    keys: dict[Role, str]
    nasa_api_key: str | None
    stale_seconds: int
    demo_telemetry: bool = False

    @property
    def demo(self) -> bool:
        return self.mode == "demo"

    @property
    def demo_stream_enabled(self) -> bool:
        return self.demo and self.demo_telemetry

    @property
    def demo_sample_seconds(self) -> float:
        return min(5.0, self.stale_seconds / 2)

    @classmethod
    def from_env(cls) -> "Settings":
        mode = os.getenv("ASTROTWIN_MODE", "demo").strip().lower()
        if mode not in {"demo", "production"}:
            raise ValueError("ASTROTWIN_MODE must be demo or production.")
        keys: dict[Role, str] = {}
        if mode == "production":
            for role in ("viewer", "operator", "telemetry"):
                name = f"ASTROTWIN_{role.upper()}_KEY"
                key = read_secret(name)
                if not TOKEN_PATTERN.fullmatch(key):
                    raise ValueError(f"{name} must be a token of 32–256 URL-safe characters.")
                keys[role] = key
            if len(set(keys.values())) != len(keys):
                raise ValueError("Each production role must have a distinct key.")
        cors_value = os.getenv("ASTROTWIN_CORS_ORIGINS", "").strip()
        origins = tuple(origin.strip().rstrip("/") for origin in cors_value.split(",") if origin.strip())
        for origin in origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.path or parsed.query or parsed.fragment:
                raise ValueError("ASTROTWIN_CORS_ORIGINS must contain specific origins.")
            if mode == "production" and parsed.scheme != "https":
                raise ValueError("Production CORS origins must use HTTPS.")
        stale_seconds = int(os.getenv("ASTROTWIN_TELEMETRY_STALE_SECONDS", "30"))
        if not 1 <= stale_seconds <= 86_400:
            raise ValueError("ASTROTWIN_TELEMETRY_STALE_SECONDS must be between 1 and 86400.")
        return cls(
            mode, database_url(mode), flag("ASTROTWIN_SEED_INVENTORY", mode == "demo"),
            origins or (DEMO_ORIGINS if mode == "demo" else ()), keys,
            read_secret("ASTROTWIN_NASA_API_KEY") or None, stale_seconds,
            demo_telemetry=mode == "demo" and flag("ASTROTWIN_DEMO_TELEMETRY", True),
        )
