"""
SQLite-backed cache for transcripts and translations.

Single file database stored alongside the downloads directory.
No extra services or dependencies required.
"""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings

# ── Database location ─────────────────────────────────────────────────────────
DB_PATH = settings.download_dir.parent / "cache" / "transcripts.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# Cache TTL — entries older than this are pruned on startup and periodically
_CACHE_TTL_DAYS = 30

# Thread-local storage so each thread gets its own connection
_local = threading.local()


def _conn() -> sqlite3.Connection:
    """Return a thread-local SQLite connection, creating it if needed."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")   # safe for concurrent reads
        conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn = conn
    return conn


def close_thread_connection() -> None:
    """Close the SQLite connection for the current thread. Call at end of background threads."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None


def init_db() -> None:
    """Create tables and prune stale entries. Called once at startup."""
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

    # Prune entries older than TTL
    _prune_old_entries(conn)


def _prune_old_entries(conn: sqlite3.Connection) -> None:
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_CACHE_TTL_DAYS)).isoformat()
    conn.execute("DELETE FROM transcript_cache  WHERE cached_at < ?", (cutoff,))
    conn.execute("DELETE FROM translation_cache WHERE cached_at < ?", (cutoff,))
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
    conn = _conn()
    conn.execute(
        """INSERT OR REPLACE INTO transcript_cache
           (video_id, language, segments, full_text, cached_at)
           VALUES (?, ?, ?, ?, ?)""",
        (
            data["video_id"],
            data["language"],
            json.dumps(data["segments"]),
            data["full_text"],
            datetime.now(timezone.utc).isoformat(),
        )
    )
    conn.commit()


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
    conn = _conn()
    conn.execute(
        """INSERT OR REPLACE INTO translation_cache
           (video_id, target_lang, translated, cached_at)
           VALUES (?, ?, ?, ?)""",
        (video_id, target_lang, translated, datetime.now(timezone.utc).isoformat())
    )
    conn.commit()
