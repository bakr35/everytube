import asyncio
from fastapi import APIRouter, HTTPException
from app.models.schemas import TranscriptRequest, TranscriptResponse, QuranVerifyRequest
from app.services.transcript_service import fetch_transcript
from app.services.whisper_service import start_whisper_job, get_active_whisper_job
from app.services.transcript_service import _extract_video_id
from youtube_transcript_api import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable

router = APIRouter()


@router.post("/transcribe")
async def transcribe(req: TranscriptRequest):
    """
    Fetch transcript for a YouTube video.

    Fast path  — returns a TranscriptResponse immediately when YouTube captions exist.
    Whisper path — if no captions, starts a background Whisper job and returns
                   {"job_id": "...", "mode": "whisper"} for the client to poll.
    """
    try:
        # Run in thread — YouTube API + Claude cleaning are blocking network calls
        # that must not block the async event loop.
        data = await asyncio.to_thread(fetch_transcript, req.url, req.language)
        return TranscriptResponse(**data)

    except (NoTranscriptFound, TranscriptsDisabled):
        # No YouTube captions — fall back to local Whisper transcription
        try:
            video_id = _extract_video_id(req.url)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

        # Dedup: if this video is already being transcribed, return the existing job
        existing_job_id = get_active_whisper_job(video_id)
        if existing_job_id:
            return {"job_id": existing_job_id, "mode": "whisper", "status": "running"}

        job_id = start_whisper_job(req.url, video_id)
        return {"job_id": job_id, "mode": "whisper", "status": "pending"}

    except VideoUnavailable:
        raise HTTPException(status_code=404, detail="Video is unavailable or private")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transcribe/quran-verify")
async def quran_verify(req: QuranVerifyRequest):
    """
    Match Arabic transcript segments against the Quran (Uthmani edition).
    Returns only segments that exceeded the 70% similarity threshold.
    Hard-capped at 50 segments per request to avoid excessive API load.
    """
    from app.services.quran_verify import verify_segment

    segments = req.segments[:50]
    verified = []
    loop = asyncio.get_running_loop()

    for item in segments:
        match = await loop.run_in_executor(None, verify_segment, item.text)
        if match:
            verified.append({"index": item.index, **match})
        await asyncio.sleep(0.15)

    return {"verified": verified, "checked": len(segments)}
