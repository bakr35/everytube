import asyncio
from fastapi import APIRouter, HTTPException
from app.models.schemas import TranscriptRequest, TranscriptResponse, QuranVerifyRequest
from app.services.transcript_service import fetch_transcript
from youtube_transcript_api import NoTranscriptFound, TranscriptsDisabled, VideoUnavailable

router = APIRouter()


@router.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(req: TranscriptRequest):
    """
    Fetch YouTube's existing captions for a video.
    Instant — no audio processing. Falls back to auto-generated captions
    if no manual transcript exists in the requested language.
    """
    try:
        data = fetch_transcript(req.url, req.language)
        return TranscriptResponse(**data)
    except TranscriptsDisabled:
        raise HTTPException(status_code=404, detail="Transcripts are disabled for this video")
    except NoTranscriptFound:
        raise HTTPException(status_code=404, detail="No transcript found for this video")
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
    Returns only segments that exceeded the 70 % similarity threshold.
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
        await asyncio.sleep(0.15)   # gentle rate-limiting for alquran.cloud

    return {"verified": verified, "checked": len(segments)}
