from pydantic import BaseModel, HttpUrl
from typing import Optional
from app.core.jobs import JobStatus


# --- Request bodies ---

class DownloadRequest(BaseModel):
    url: str
    quality: str = "best"        # "best", "1080p", "720p", "480p", "360p"
    format: str = "mp4"          # "mp4", "webm"


class AudioDownloadRequest(BaseModel):
    url: str
    format: str = "mp3"           # "mp3", "wav", "flac"
    bitrate: str = "192k"         # mp3 only
    output_name: str = ""         # desired file stem


class AudioExtractRequest(BaseModel):
    job_id: str                  # refers to a completed download job
    format: str = "mp3"          # "mp3", "wav", "flac"
    bitrate: str = "192k"        # mp3 only: "128k", "192k", "320k"
    output_name: str = ""        # desired file stem, e.g. "MyVideo_320k_MP3"
    title: str = ""
    uploader: str = ""
    thumbnail_url: str = ""


class AudioTrimRequest(BaseModel):
    job_id: str
    start: float                 # seconds
    end: float                   # seconds
    output_name: str = ""        # desired file stem, e.g. "MyVideo_Trim_00-00-01-30_320k"


class AudioNormalizeRequest(BaseModel):
    job_id: str


class TranscriptRequest(BaseModel):
    url: str
    # language is kept for internal/SRT use but defaults to auto-detect
    language: str = "auto"
    force_refresh: bool = False   # if True, bypass/delete the cache and re-fetch




class QuranVerifyItem(BaseModel):
    index: int
    text: str

class QuranVerifyRequest(BaseModel):
    segments: list[QuranVerifyItem]


# --- Response bodies ---

class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int
    message: str
    filename: Optional[str] = None
    error: Optional[str] = None


class TranscriptSegment(BaseModel):
    start: float
    duration: float
    text: str
    speaker: str | None = None   # e.g. "Speaker 1", "Speaker 2"
    is_cue:  bool = False         # True for inline audience cues like (Laughter)


class TranscriptResponse(BaseModel):
    video_id: str
    language: str
    segments: list[TranscriptSegment]
    full_text: str


class SponsorSegment(BaseModel):
    segment: list[float]
    category: str
    actionType: str = ""
    votes: int = 0
    views: int = 0
    UUID: str = ""

class Chapter(BaseModel):
    title: str
    start_time: float
    end_time: float

class HeatmapPoint(BaseModel):
    start_time: float
    end_time: float
    value: float

class MetadataResponse(BaseModel):
    video_id: str
    title: str
    uploader: str
    channel_is_verified: bool = False
    channel_follower_count: Optional[int] = None
    duration: int                # seconds
    thumbnail: str               # URL
    upload_date: Optional[str] = None   # YYYY-MM-DD
    view_count: Optional[int] = None
    like_count: Optional[int] = None
    dislike_count: Optional[int] = None
    comment_count: Optional[int] = None
    available_qualities: list[str]
    hdr_types: list[str] = []
    description: str = ""
    tags: list[str] = []
    categories: list[str] = []
    license: str = ""
    age_limit: int = 0
    availability: str = "public"
    live_status: str = ""
    has_captions: bool = False
    caption_langs: list[str] = []
    auto_langs: list[str] = []
    chapters: list[Chapter] = []
    heatmap: list[HeatmapPoint] = []
    sponsor_segments: list[SponsorSegment] = []
    language: str = ""
    # Channel-level (YouTube Data API v3)
    channel_created: str = ""          # ISO timestamp
    channel_country: str = ""          # "🇨🇦 Canada"
    channel_custom_url: str = ""       # "@handle"
    channel_video_count: Optional[int] = None
    channel_topics: list[str] = []     # ["Military", "Society", "Politics"]
