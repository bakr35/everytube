from pydantic import BaseModel, HttpUrl
from typing import Optional
from app.core.jobs import JobStatus


# --- Request bodies ---

class DownloadRequest(BaseModel):
    url: str
    quality: str = "best"        # "best", "1080p", "720p", "480p", "360p"
    format: str = "mp4"          # "mp4", "webm"


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
    language: str = "en"


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


class TranscriptResponse(BaseModel):
    video_id: str
    language: str
    segments: list[TranscriptSegment]
    full_text: str


class MetadataResponse(BaseModel):
    video_id: str
    title: str
    uploader: str
    duration: int                # seconds
    thumbnail: str               # URL
    view_count: Optional[int]
    available_qualities: list[str]
    description: str = ""
