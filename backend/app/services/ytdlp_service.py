import re
import json
import shutil
import urllib.request
import urllib.parse
import yt_dlp
from pathlib import Path
from app.core.config import settings
from app.core.jobs import update_job, JobStatus


def _clean(text: str) -> str:
    """Strip ANSI escape codes from yt-dlp error messages."""
    return re.sub(r'\x1b\[[0-9;]*[mK]', '', text)


# ── Country code → name + flag emoji ────────────────────────────────────────
_COUNTRY_NAMES = {
    "AE": "UAE", "AU": "Australia", "BR": "Brazil", "CA": "Canada",
    "CN": "China", "DE": "Germany", "EG": "Egypt", "ES": "Spain",
    "FR": "France", "GB": "UK", "ID": "Indonesia", "IN": "India",
    "IQ": "Iraq", "IR": "Iran", "IT": "Italy", "JP": "Japan",
    "KR": "South Korea", "KW": "Kuwait", "LB": "Lebanon", "MA": "Morocco",
    "MX": "Mexico", "MY": "Malaysia", "NG": "Nigeria", "NL": "Netherlands",
    "PK": "Pakistan", "PS": "Palestine", "QA": "Qatar", "RU": "Russia",
    "SA": "Saudi Arabia", "SE": "Sweden", "SY": "Syria", "TR": "Turkey",
    "TN": "Tunisia", "US": "USA", "YE": "Yemen", "ZA": "South Africa",
}

def _country_flag(code: str) -> str:
    """Convert ISO 3166-1 alpha-2 code to flag emoji."""
    if not code or len(code) != 2:
        return ""
    return chr(0x1F1E0 + ord(code[0]) - ord("A")) + chr(0x1F1E0 + ord(code[1]) - ord("A"))


def _parse_topic_categories(raw: list[str]) -> list[str]:
    """Extract readable topic names from Wikipedia URLs."""
    topics = []
    for url in raw:
        # e.g. https://en.wikipedia.org/wiki/Military_history → "Military history"
        if "/wiki/" in url:
            slug = url.split("/wiki/")[-1]
            topics.append(urllib.parse.unquote(slug).replace("_", " "))
    return topics


def get_channel_info(channel_id: str) -> dict:
    """
    Fetch channel metadata via YouTube Data API v3.
    Returns empty dict if no API key is configured or the call fails.
    """
    if not settings.youtube_api_key or not channel_id:
        return {}
    try:
        params = urllib.parse.urlencode({
            "part": "snippet,statistics,topicDetails",
            "id": channel_id,
            "key": settings.youtube_api_key,
        })
        url = f"https://www.googleapis.com/youtube/v3/channels?{params}"
        with urllib.request.urlopen(url, timeout=6) as r:
            data = json.loads(r.read())

        items = data.get("items") or []
        if not items:
            return {}
        item = items[0]

        snippet    = item.get("snippet", {})
        statistics = item.get("statistics", {})
        topics     = item.get("topicDetails", {})

        country_code = snippet.get("country", "")
        country_name = _COUNTRY_NAMES.get(country_code, country_code)
        flag         = _country_flag(country_code)

        raw_topics = topics.get("topicCategories") or []
        topic_names = _parse_topic_categories(raw_topics)

        return {
            "channel_created":     snippet.get("publishedAt", ""),       # ISO timestamp
            "channel_country":     f"{flag} {country_name}".strip() if country_code else "",
            "channel_country_code": country_code,
            "channel_custom_url":  snippet.get("customUrl", ""),          # @handle
            "channel_video_count": int(statistics.get("videoCount", 0)),
            "channel_topics":      topic_names,
        }
    except Exception:
        return {}

# ── MP4 quality map ──────────────────────────────────────────────────────────
# Prefers H.264 (vcodec^=avc1) + AAC (acodec^=mp4a) so FFmpeg can stream-copy
# (no re-encoding). QuickTime / iOS / all browsers play H.264+AAC MP4 natively.
QUALITY_MAP_MP4 = {
    "bestaudio": "bestaudio[ext=m4a]/bestaudio",
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
    "bestaudio": "bestaudio[ext=webm]/bestaudio",
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
        msg = _clean(str(exc))
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
    """Shared yt-dlp options. Includes cookie source when configured."""
    opts: dict = {
        "quiet": True,
        "noplaylist": True,
        "no_color": True,
    }
    # Cookie file takes priority over browser cookies
    if settings.cookies_file and Path(settings.cookies_file).is_file():
        opts["cookiefile"] = settings.cookies_file
    elif settings.cookies_from_browser:
        opts["cookiesfrombrowser"] = (settings.cookies_from_browser,)
    return opts


def download_audio(job_id: str, url: str, fmt: str, bitrate: str = "192k", output_name: str = "") -> Path:
    """
    Download and convert audio in one yt-dlp pass.
    Uses the same proven format selector as the old bestaudio flow, converted
    via FFmpegExtractAudio postprocessor — no intermediate video file.
    """
    out_dir = settings.download_dir / f"{job_id}_audio_{fmt}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    if output_name:
        safe = "".join(c for c in output_name if c not in r'\/:*?"<>|').strip()
        outtmpl = str(out_dir / f"{safe}.%(ext)s")
    else:
        outtmpl = str(out_dir / "%(title)s.%(ext)s")

    ydl_opts = {
        **_base_opts(),
        # Same selector that worked in the old two-step flow
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "outtmpl": outtmpl,
        "ffmpeg_location": str(Path(settings.ffmpeg_path).parent),
        "progress_hooks": [_make_progress_hook(job_id)],
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": fmt,
                "preferredquality": bitrate.rstrip("k") if fmt == "mp3" else "0",
            },
            {"key": "FFmpegMetadata", "add_metadata": True},
        ],
    }

    update_job(job_id, status=JobStatus.RUNNING, message="Starting audio download…")
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:
        raise RuntimeError(f"Download error: {_clean(str(exc))[-300:]}") from exc

    # Find the converted audio file
    target_exts = {fmt, "mp3", "wav", "flac", "m4a", "ogg", "opus"}
    files = [f for f in out_dir.iterdir() if f.suffix.lstrip(".").lower() in target_exts]
    if not files:
        raise FileNotFoundError("yt-dlp produced no audio output file")

    out_file = max(files, key=lambda f: f.stat().st_mtime)
    update_job(
        job_id,
        status=JobStatus.DONE,
        progress=100,
        message="Audio download complete",
        file_path=str(out_file),
        filename=out_file.name,
    )
    return out_file


def get_playlist_info(url: str) -> dict:
    """
    Fetch playlist metadata using yt-dlp's flat extraction.
    No media is downloaded. Capped at 50 entries for stability.
    """
    ydl_opts = {
        **_base_opts(),
        "extract_flat": "in_playlist",
        "playlistend": 50,
        "ignoreerrors": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info:
        raise ValueError("Could not fetch playlist info")

    entries = info.get("entries") or []
    playlist_uploader = info.get("uploader") or info.get("channel") or ""

    videos = []
    for entry in entries[:50]:
        if not entry or not entry.get("id"):
            continue
        video_id = entry["id"]
        videos.append({
            "video_id": video_id,
            "title": entry.get("title") or f"Video {video_id}",
            # Construct thumbnail URL directly — flat extraction rarely returns one
            "thumbnail": (
                entry.get("thumbnail")
                or f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
            ),
            "duration": entry.get("duration") or 0,
            "uploader": (
                entry.get("uploader")
                or entry.get("channel")
                or playlist_uploader
            ),
        })

    return {
        "playlist_id": info.get("id", ""),
        "title": info.get("title") or "Untitled Playlist",
        "uploader": playlist_uploader,
        "video_count": len(videos),
        "videos": videos,
    }


def _fetch_sponsorblock(video_id: str) -> list[dict]:
    """Fetch SponsorBlock segments (free, no API key). Returns [] on failure."""
    try:
        import urllib.request as ur, json as _json
        url = f"https://sponsor.ajay.app/api/skipSegments?videoID={video_id}"
        with ur.urlopen(url, timeout=4) as r:
            return _json.loads(r.read())
    except Exception:
        return []


def _fetch_dislikes(video_id: str) -> dict | None:
    """Fetch estimated dislike count from returnyoutubedislike.com. Returns None on failure."""
    try:
        import urllib.request as ur, json as _json
        url = f"https://returnyoutubedislike.com/api/votes?videoId={video_id}"
        with ur.urlopen(url, timeout=4) as r:
            return _json.loads(r.read())
    except Exception:
        return None


def _fmt_upload_date(raw: str | None) -> str | None:
    """Convert YYYYMMDD → ISO date string YYYY-MM-DD."""
    if not raw or len(raw) != 8:
        return None
    return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"


def get_metadata(url: str) -> dict:
    ydl_opts = {
        **_base_opts(),
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    video_id = info.get("id", "")

    qualities = sorted(
        {
            f"{f['height']}p"
            for f in info.get("formats", [])
            if f.get("height") and f.get("vcodec") != "none"
        },
        key=lambda q: int(q[:-1]),
        reverse=True,
    )

    # HDR formats available?
    hdr_formats = [
        f.get("dynamic_range", "")
        for f in info.get("formats", [])
        if f.get("dynamic_range") and f.get("dynamic_range") != "SDR"
    ]
    hdr_types = sorted(set(filter(None, hdr_formats)))

    # Captions availability
    subtitles     = info.get("subtitles") or {}
    auto_captions = info.get("automatic_captions") or {}
    has_captions  = bool(subtitles)
    caption_langs = list(subtitles.keys())[:8]          # manual caption languages
    auto_langs    = list(auto_captions.keys())[:8]       # auto-caption languages

    # Chapters
    chapters = [
        {"title": c.get("title", ""), "start_time": c["start_time"], "end_time": c["end_time"]}
        for c in (info.get("chapters") or [])
        if "start_time" in c and "end_time" in c
    ]

    # Heatmap (Most Replayed)
    heatmap = [
        {"start_time": h["start_time"], "end_time": h["end_time"], "value": round(h["value"], 4)}
        for h in (info.get("heatmap") or [])
    ]

    # Availability label
    availability = info.get("availability") or "public"

    # SponsorBlock + Dislikes + Channel info — fetch in parallel via threads
    # so three sequential network calls don't add up to 14+ seconds of blocking.
    import concurrent.futures
    channel_id = info.get("channel_id", "")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_sponsor  = pool.submit(_fetch_sponsorblock, video_id) if video_id else None
        f_dislikes = pool.submit(_fetch_dislikes,     video_id) if video_id else None
        f_channel  = pool.submit(get_channel_info, channel_id)

        sponsor_segments = f_sponsor.result()  if f_sponsor  else []
        dislike_data     = f_dislikes.result() if f_dislikes else None
        channel_info     = f_channel.result()

    return {
        "video_id":            video_id,
        "title":               info.get("title", ""),
        "uploader":            info.get("uploader", ""),
        "channel_is_verified": info.get("channel_is_verified", False),
        "channel_follower_count": info.get("channel_follower_count"),
        "duration":            info.get("duration", 0),
        "thumbnail":           info.get("thumbnail", ""),
        "upload_date":         _fmt_upload_date(info.get("upload_date")),
        "view_count":          info.get("view_count"),
        "like_count":          info.get("like_count"),
        "dislike_count":       dislike_data.get("dislikes") if dislike_data else None,
        "comment_count":       info.get("comment_count"),
        "available_qualities": qualities or ["best"],
        "hdr_types":           hdr_types,
        "description":         info.get("description", ""),
        "tags":                info.get("tags") or [],
        "categories":          info.get("categories") or [],
        "license":             info.get("license") or "",
        "age_limit":           info.get("age_limit") or 0,
        "availability":        availability,
        "live_status":         info.get("live_status") or "",
        "has_captions":        has_captions,
        "caption_langs":       caption_langs,
        "auto_langs":          auto_langs,
        "chapters":            chapters,
        "heatmap":             heatmap,
        "sponsor_segments":    sponsor_segments,
        "language":            info.get("language") or "",
        # Channel-level fields (from YouTube Data API v3)
        "channel_created":     channel_info.get("channel_created", ""),
        "channel_country":     channel_info.get("channel_country", ""),
        "channel_custom_url":  channel_info.get("channel_custom_url", ""),
        "channel_video_count": channel_info.get("channel_video_count"),
        "channel_topics":      channel_info.get("channel_topics", []),
    }
