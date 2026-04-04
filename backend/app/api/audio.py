import asyncio
from fastapi import APIRouter, HTTPException
from app.core.jobs import create_job, get_job, update_job, JobStatus
from app.models.schemas import AudioExtractRequest, AudioTrimRequest, AudioNormalizeRequest, JobResponse
from app.services.ffmpeg_service import extract_audio, trim_audio, normalize_audio

router = APIRouter()


def _source_path(job_id: str) -> str:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != JobStatus.DONE or not job.file_path:
        raise HTTPException(status_code=409, detail="Source job is not complete")
    return job.file_path


@router.post("/audio/extract", response_model=JobResponse, status_code=202)
async def start_extract(req: AudioExtractRequest):
    """Extract audio track from a completed download job."""
    source = _source_path(req.job_id)
    job = create_job()

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _run_extract, job.id, source, req.format,
                         req.bitrate, req.output_name, req.title, req.uploader, req.thumbnail_url)

    return JobResponse(job_id=job.id, status=job.status, progress=0, message="Job queued")


@router.post("/audio/trim", response_model=JobResponse, status_code=202)
async def start_trim(req: AudioTrimRequest):
    """Trim audio to [start, end] seconds."""
    if req.start < 0 or req.end <= req.start:
        raise HTTPException(status_code=422, detail="end must be greater than start")

    source = _source_path(req.job_id)
    job = create_job()

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _run_trim, job.id, source, req.start, req.end, req.output_name)

    return JobResponse(job_id=job.id, status=job.status, progress=0, message="Job queued")


@router.post("/audio/normalize", response_model=JobResponse, status_code=202)
async def start_normalize(req: AudioNormalizeRequest):
    """Apply EBU R128 loudnorm to audio."""
    source = _source_path(req.job_id)
    job = create_job()

    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _run_normalize, job.id, source)

    return JobResponse(job_id=job.id, status=job.status, progress=0, message="Job queued")


# --- sync wrappers for executor ---

def _run_extract(job_id, source, fmt, bitrate="192k", output_name="", title="", uploader="", thumbnail_url=""):
    try:
        extract_audio(job_id, source, fmt, bitrate=bitrate, output_name=output_name,
                      title=title, uploader=uploader, thumbnail_url=thumbnail_url)
    except Exception as e:
        update_job(job_id, status=JobStatus.ERROR, error=str(e), message="Extraction failed")


def _run_trim(job_id, source, start, end, output_name=""):
    try:
        trim_audio(job_id, source, start, end, output_name=output_name)
    except Exception as e:
        update_job(job_id, status=JobStatus.ERROR, error=str(e), message="Trim failed")


def _run_normalize(job_id, source):
    try:
        normalize_audio(job_id, source)
    except Exception as e:
        update_job(job_id, status=JobStatus.ERROR, error=str(e), message="Normalize failed")
