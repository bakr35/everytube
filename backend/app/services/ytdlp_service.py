import shutil
import yt_dlp
from pathlib import Path
from app.core.config import settings
from app.core.jobs import update_job, JobStatus

# ── MP4 quality map ──────────────────────────────────────────────────────────
# Prefers H.264 (vcodec^=avc1) + AAC (acodec^=mp4a) so FFmpeg can stream-copy
# (no re-encoding). QuickTime / iOS / all browsers play H.264+AAC MP4 natively.
QUALITY_MAP_MP4 = {
    "best":  "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
    "2160p": "bestvideo[height<=2160][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]",
    "1080p": "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
    "720p":  "bestvideo[height<=720][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
    "480p":  "bestvideo[height<=480][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
    "360p":  "bestvideo[height<=360][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
}

# ── WebM quality map ─────────────────────────────────────────────────────────
# Prefers VP9 + Opus — the native WebM codecs. Stream-copy works when these are
# selected. Falls back to any webm, then anything; FFmpegVideoConvertor will
# re-encode as needed without the stream-copy restriction.
QUALITY_MAP_WEBM = {
    "best":  "bestvideo[vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio/best",
    "2160p": "bestvideo[height<=2160][vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo[height<=2160][ext=webm]+bestaudio/best[height<=2160]",
    "1080p": "bestvideo[height<=1080][vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo[height<=1080][ext=webm]+bestaudio/best[height<=1080]",
    "720p":  "bestvideo[height<=720][vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo[height<=720][ext=webm]+bestaudio/best[height<=720]",
    "480p":  "bestvideo[height<=480][vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo[height<=480][ext=webm]+bestaudio/best[height<=480]",
    "360p":  "bestvideo[height<=360][vcodec^=vp9]+bestaudio[acodec^=opus]/bestvideo[height<=360][ext=webm]+bestaudio/best[height<=360]",
}

# MP4 stream-copy args — safe because format strings above select native H.264+AAC.
# NOT used for WebM: stream-copying H.264 into a WebM container is invalid; we let
# yt-dlp / FFmpeg choose the right codec when the native VP9+Opus fallback triggers.
FFMPEG_ARGS_MP4 = ["-c:v", "copy", "-c:a", "copy"]


def _quality_map(fmt: str) -> dict:
    return QUALITY_MAP_WEBM if fmt == "webm" else QUALITY_MAP_MP4


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
    # Directory encodes the selection — eliminates any ambiguity between
    # different quality/format requests stored under the same job root.
    out_dir = settings.download_dir / f"{job_id}_{quality}_{fmt}"

    # Wipe any leftover partial files from a previous (failed) attempt so they
    # cannot interfere with the retry and cause a false "already exists" result.
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    qmap = _quality_map(fmt)
    ydl_opts = {
        **_base_opts(),
        "format": qmap.get(quality, qmap["best"]),
        "outtmpl": str(out_dir / f"%(title)s_{quality}_{fmt.upper()}.%(ext)s"),
        "merge_output_format": fmt,
        "ffmpeg_location": str(Path(settings.ffmpeg_path).parent),
        "progress_hooks": [_make_progress_hook(job_id)],
        "postprocessors": [{
            "key": "FFmpegVideoConvertor",
            "preferedformat": fmt,
        }],
    }

    # Stream-copy optimisation only applies to MP4 (H.264+AAC → MP4 container).
    # For WebM we omit this so FFmpeg can re-encode if the VP9+Opus fast path
    # doesn't match — forcing -c copy on a non-VP9 stream into WebM errors out.
    if fmt == "mp4":
        ydl_opts["postprocessor_args"] = {"ffmpeg": FFMPEG_ARGS_MP4}

    update_job(job_id, status=JobStatus.RUNNING, message="Starting download…")
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:
        # Surface the yt-dlp/FFmpeg error text directly so the frontend can
        # display something actionable rather than the generic "Download failed".
        msg = str(exc)
        if "ffmpeg" in msg.lower() or "converter" in msg.lower():
            raise RuntimeError(f"FFmpeg conversion failed: {msg[-300:]}") from exc
        raise RuntimeError(f"Download error: {msg[-300:]}") from exc

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
    """Shared yt-dlp options. Includes cookie file when configured."""
    opts: dict = {
        "quiet": True,
        "noplaylist": True,
    }
    if settings.cookies_file and Path(settings.cookies_file).is_file():
        opts["cookiefile"] = settings.cookies_file
    return opts


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
        "description": info.get("description", ""),
    }
