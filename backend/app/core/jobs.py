import uuid
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

_MAX_JOBS = 500   # hard cap — oldest jobs dropped when exceeded


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE    = "done"
    ERROR   = "error"


@dataclass
class Job:
    id:         str       = field(default_factory=lambda: str(uuid.uuid4()))
    status:     JobStatus = JobStatus.PENDING
    progress:   int       = 0          # 0–100
    message:    str       = ""
    file_path:  Optional[str] = None
    filename:   Optional[str] = None
    created_at: datetime  = field(default_factory=lambda: datetime.now(timezone.utc))
    error:      Optional[str] = None


# Thread-safe in-memory store
_store: dict[str, Job] = {}
_lock  = threading.Lock()


def create_job() -> Job:
    job = Job()
    with _lock:
        # Evict oldest job if at cap
        if len(_store) >= _MAX_JOBS:
            oldest = min(_store.values(), key=lambda j: j.created_at)
            _store.pop(oldest.id, None)
        _store[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _lock:
        return _store.get(job_id)


def update_job(job_id: str, **kwargs) -> None:
    with _lock:
        job = _store.get(job_id)
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)


def evict_expired(cutoff: datetime) -> list[str]:
    """Remove jobs older than cutoff. Returns list of evicted IDs."""
    with _lock:
        expired = [
            jid for jid, job in list(_store.items())
            if job.created_at < cutoff
        ]
        for jid in expired:
            _store.pop(jid, None)
    return expired
