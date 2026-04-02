import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


@dataclass
class Job:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: JobStatus = JobStatus.PENDING
    progress: int = 0          # 0–100
    message: str = ""
    file_path: Optional[str] = None
    filename: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    error: Optional[str] = None


# Simple in-memory store — good enough for single-process dev use
_store: dict[str, Job] = {}


def create_job() -> Job:
    job = Job()
    _store[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    return _store.get(job_id)


def update_job(job_id: str, **kwargs) -> None:
    job = _store.get(job_id)
    if job:
        for k, v in kwargs.items():
            setattr(job, k, v)
