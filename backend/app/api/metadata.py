import asyncio
from fastapi import APIRouter, HTTPException, Query
from app.services.ytdlp_service import get_metadata
from app.models.schemas import MetadataResponse

router = APIRouter()


@router.get("/metadata", response_model=MetadataResponse)
async def metadata(url: str = Query(..., description="YouTube video URL")):
    """
    Fetch video metadata without downloading.
    Returns title, uploader, duration (seconds), thumbnail URL,
    view count, and list of available quality options.
    """
    try:
        # Run in a thread — yt-dlp + SponsorBlock + dislikes + YouTube API
        # are all blocking network calls that must not block the async event loop.
        data = await asyncio.to_thread(get_metadata, url)
        return MetadataResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
