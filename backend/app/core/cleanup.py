"""
Background cleanup thread.
Deletes download job folders older than max_file_age_hours (default 30 min via config).
Runs every 5 minutes. Removes expired jobs from the in-memory store.
"""

import threading
import time
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from app.core.config import settings
from app.core import jobs as job_store


def _purge_once() -> None:
    cutoff = datetime.utcnow() - timedelta(hours=settings.max_file_age_hours)

    # 1. Remove expired job dirs from disk
    dl_dir = settings.download_dir
    if not dl_dir.exists():
        return

    for job_dir in dl_dir.iterdir():
        if not job_dir.is_dir():
            continue
        try:
            mtime = datetime.utcfromtimestamp(job_dir.stat().st_mtime)
            if mtime < cutoff:
                shutil.rmtree(job_dir, ignore_errors=True)
        except OSError:
            pass

    # 2. Evict stale entries from the in-memory job store
    expired_ids = [
        jid for jid, job in list(job_store._store.items())
        if job.created_at < cutoff
    ]
    for jid in expired_ids:
        job_store._store.pop(jid, None)


def _loop(interval_seconds: int) -> None:
    while True:
        time.sleep(interval_seconds)
        try:
            _purge_once()
        except Exception:
            pass  # Never crash the cleanup thread


def start_cleanup_thread(interval_seconds: int = 300) -> None:
    """Start the background cleanup thread (daemon — dies when main process exits)."""
    t = threading.Thread(target=_loop, args=(interval_seconds,), daemon=True, name="cleanup")
    t.start()
