import asyncio
from fastapi import APIRouter, HTTPException, Query
from app.services.ytdlp_service import get_playlist_info

router = APIRouter()


@router.get("/playlist/info")
async def playlist_info(url: str = Query(..., description="YouTube playlist URL")):
    """
    Fetch playlist metadata without downloading any media.
    Returns title, uploader, and up to 50 video entries.
    """
    try:
        # yt-dlp network call must not block the async event loop
        data = await asyncio.to_thread(get_playlist_info, url)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
