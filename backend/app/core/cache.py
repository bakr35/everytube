"""
SQLite-backed cache for transcripts and translations.

Single file database stored alongside the downloads directory.
No extra services or dependencies required.
"""

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from app.core.config import settings

# ── Database location ─────────────────────────────────────────────────────────
DB_PATH = settings.download_dir.parent / "cache" / "transcripts.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Thread-local storage so each thread gets its own connection
_local = threading.local()


def _conn() -> sqlite3.Connection:
    """Return a thread-local SQLite connection, creating it if needed."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")   # safe for concurrent reads
        _local.conn.execute("PRAGMA synchronous=NORMAL")
    return _local.conn


def init_db() -> None:
    """Create tables if they don't exist. Called once at startup."""
    conn = _conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS transcript_cache (
            video_id   TEXT PRIMARY KEY,
            language   TEXT NOT NULL,
            segments   TEXT NOT NULL,
            full_text  TEXT NOT NULL,
            cached_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS translation_cache (
            video_id     TEXT NOT NULL,
            target_lang  TEXT NOT NULL,
            translated   TEXT NOT NULL,
            cached_at    TEXT NOT NULL,
            PRIMARY KEY (video_id, target_lang)
        );
    """)
    conn.commit()


# ── Transcript cache ──────────────────────────────────────────────────────────

def get_transcript(video_id: str) -> dict | None:
    """Return cached transcript dict or None if not cached."""
    row = _conn().execute(
        "SELECT language, segments, full_text FROM transcript_cache WHERE video_id = ?",
        (video_id,)
    ).fetchone()
    if row is None:
        return None
    return {
        "video_id": video_id,
        "language": row["language"],
        "segments": json.loads(row["segments"]),
        "full_text": row["full_text"],
    }


def save_transcript(data: dict) -> None:
    """Persist a transcript dict to the cache."""
    _conn().execute(
        """INSERT OR REPLACE INTO transcript_cache
           (video_id, language, segments, full_text, cached_at)
           VALUES (?, ?, ?, ?, ?)""",
        (
            data["video_id"],
            data["language"],
            json.dumps(data["segments"]),
            data["full_text"],
            datetime.utcnow().isoformat(),
        )
    )
    _conn().commit()


# ── Translation cache ─────────────────────────────────────────────────────────

def get_translation(video_id: str, target_lang: str) -> str | None:
    """Return cached translation text or None."""
    row = _conn().execute(
        "SELECT translated FROM translation_cache WHERE video_id = ? AND target_lang = ?",
        (video_id, target_lang)
    ).fetchone()
    return row["translated"] if row else None


def save_translation(video_id: str, target_lang: str, translated: str) -> None:
    """Persist a translation to the cache."""
    _conn().execute(
        """INSERT OR REPLACE INTO translation_cache
           (video_id, target_lang, translated, cached_at)
           VALUES (?, ?, ?, ?)""",
        (video_id, target_lang, translated, datetime.utcnow().isoformat())
    )
    _conn().commit()
