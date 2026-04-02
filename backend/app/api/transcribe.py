from fastapi import APIRouter, HTTPException
from app.models.schemas import TranscriptRequest, TranscriptResponse
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
