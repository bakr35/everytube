import yt_dlp
from pathlib import Path
from app.core.config import settings
from app.core.jobs import update_job, JobStatus

# Quality label → yt-dlp format string.
# Each entry tries H.264 (vcodec^=avc1) + AAC (acodec^=mp4a) first —
# YouTube serves these natively up to 1080p, so FFmpeg just stream-copies
# (instant, no CPU re-encoding). Falls back to any mp4/m4a, then anything.
QUALITY_MAP = {
    "best":  "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
    "2160p": "bestvideo[height<=2160][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]",
    "1080p": "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
    "720p":  "bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
    "480p":  "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
    "360p":  "bestvideo[height<=360][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
}

# Stream-copy both tracks — no re-encoding, instant merge.
# Works because the format strings above select native H.264+AAC sources.
# QuickTime / iOS / browsers all play H.264+AAC MP4 natively.
FFMPEG_POSTPROCESS_ARGS = [
    "-c:v", "copy",
    "-c:a", "copy",
]


def _make_progress_hook(job_id: str):
    def hook(d: dict):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            pct = int(downloaded / total * 90) if total else 0
            update_job(job_id, progress=pct, message=f"Downloading… {pct}%")
        elif d["status"] == "finished":
            update_job(job_id, progress=95, message="Merging streams…")
    return hook


def download_video(job_id: str, url: str, quality: str, fmt: str) -> Path:
    out_dir = settings.download_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    ydl_opts = {
        **_base_opts(),
        "format": QUALITY_MAP.get(quality, QUALITY_MAP["best"]),
        "outtmpl": str(out_dir / "%(title)s.%(ext)s"),
        "merge_output_format": fmt,
        "ffmpeg_location": str(Path(settings.ffmpeg_path).parent),
        "progress_hooks": [_make_progress_hook(job_id)],
        # "ffmpeg" key applies these args to ALL FFmpeg-based postprocessor steps
        "postprocessor_args": {
            "ffmpeg": FFMPEG_POSTPROCESS_ARGS,
        },
        "postprocessors": [{
            "key": "FFmpegVideoConvertor",
            "preferedformat": fmt,
        }],
    }

    update_job(job_id, status=JobStatus.RUNNING, message="Starting download…")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    # Find the output file (there will be exactly one after conversion)
    files = list(out_dir.iterdir())
    if not files:
        raise FileNotFoundError("yt-dlp produced no output file")

    out_file = max(files, key=lambda f: f.stat().st_mtime)
    update_job(
        job_id,
        status=JobStatus.DONE,
        progress=100,
        message="Download complete",
        file_path=str(out_file),
        filename=out_file.name,
    )
    return out_file


def _base_opts() -> dict:
    """Shared yt-dlp options."""
    return {
        "quiet": True,
        "noplaylist": True,
    }


def get_metadata(url: str) -> dict:
    ydl_opts = {
        **_base_opts(),
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    qualities = sorted(
        {
            f"{f['height']}p"
            for f in info.get("formats", [])
            if f.get("height") and f.get("vcodec") != "none"
        },
        key=lambda q: int(q[:-1]),
        reverse=True,
    )

    return {
        "video_id": info.get("id", ""),
        "title": info.get("title", ""),
        "uploader": info.get("uploader", ""),
        "duration": info.get("duration", 0),
        "thumbnail": info.get("thumbnail", ""),
        "view_count": info.get("view_count"),
        "available_qualities": qualities or ["best"],
    }
