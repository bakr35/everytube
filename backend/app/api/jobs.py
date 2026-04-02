from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.core.jobs import get_job, JobStatus
from app.models.schemas import JobResponse
import os

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def job_status(job_id: str):
    """Poll job status and progress (0–100)."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        message=job.message,
        filename=job.filename,
        error=job.error,
    )


@router.get("/files/{job_id}")
async def download_file(job_id: str):
    """Stream the completed file for a job."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.DONE or not job.file_path:
        raise HTTPException(status_code=409, detail="File not ready yet")
    if not os.path.exists(job.file_path):
        raise HTTPException(status_code=404, detail="File has been removed from disk")

    return FileResponse(
        path=job.file_path,
        filename=job.filename,
        media_type="application/octet-stream",
    )
