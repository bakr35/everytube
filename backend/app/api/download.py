import asyncio
from fastapi import APIRouter
from app.core.jobs import create_job, update_job, JobStatus
from app.models.schemas import DownloadRequest, JobResponse
from app.services.ytdlp_service import download_video

router = APIRouter()


@router.post("/download", response_model=JobResponse, status_code=202)
async def start_download(req: DownloadRequest):
    """Start an async download job. Poll /jobs/{job_id} for progress."""
    job = create_job()

    # get_event_loop() is deprecated in 3.10+ — use get_running_loop()
    loop = asyncio.get_running_loop()
    loop.run_in_executor(
        None,
        _run_download,
        job.id, req.url, req.quality, req.format,
    )

    return JobResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        message="Job queued",
    )


def _run_download(job_id: str, url: str, quality: str, fmt: str):
    try:
        download_video(job_id, url, quality, fmt)
    except Exception as e:
        update_job(job_id, status=JobStatus.ERROR, error=str(e), message="Download failed")
