from youtube_transcript_api import (
    YouTubeTranscriptApi,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)
from urllib.parse import urlparse, parse_qs
import re


def _extract_video_id(url: str) -> str:
    if "youtu.be" in url:
        return urlparse(url).path.lstrip("/").split("?")[0]

    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "v" in qs:
        return qs["v"][0]

    match = re.search(r"/(shorts|embed|v)/([a-zA-Z0-9_-]{11})", parsed.path)
    if match:
        return match.group(2)

    raise ValueError(f"Could not extract video ID from URL: {url}")


def fetch_transcript(url: str, language: str = "en") -> dict:
    video_id = _extract_video_id(url)
    api = YouTubeTranscriptApi()

    # Discover all available transcripts first
    transcript_list = api.list(video_id)
    available = list(transcript_list)

    if not available:
        raise NoTranscriptFound(video_id, [language], transcript_list)

    # Pick: requested language → any manual → any generated → first available
    target = None
    for t in available:
        if t.language_code == language:
            target = t
            break
    if target is None:
        for t in available:
            if not t.is_generated:
                target = t
                break
    if target is None:
        target = available[0]

    raw = target.fetch()

    segments = [
        {"text": s.text, "start": s.start, "duration": s.duration}
        for s in raw
    ]
    full_text = " ".join(s["text"] for s in segments)

    return {
        "video_id": video_id,
        "language": target.language_code,
        "segments": segments,
        "full_text": full_text,
    }
