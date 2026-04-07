import subprocess
import urllib.request
import tempfile
from pathlib import Path
from app.core.config import settings
from app.core.jobs import update_job, JobStatus


_FFMPEG_TIMEOUT = 3600  # 1 hour hard limit — prevents hung FFmpeg from leaking threads


def _run(cmd: list[str]) -> None:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=_FFMPEG_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise RuntimeError("FFmpeg timed out after 1 hour — process killed")
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr[-500:]}")


def _ffmpeg(*args: str) -> list[str]:
    """Build an ffmpeg command using the resolved binary path."""
    return [settings.ffmpeg_path, *args]


def _embed_cover(mp3_path: Path, thumbnail_url: str) -> None:
    """Download thumbnail and embed it as MP3 cover art."""
    tmp_img = None
    tmp_out = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp_img = Path(f.name)
        # 10s timeout — thumbnail fetch must not hang the audio job thread
        with urllib.request.urlopen(thumbnail_url, timeout=10) as resp:
            tmp_img.write_bytes(resp.read())

        tmp_out = mp3_path.with_suffix(".cover_tmp.mp3")
        _run(_ffmpeg(
            "-y",
            "-i", str(mp3_path),
            "-i", str(tmp_img),
            "-map", "0:0",
            "-map", "1:0",
            "-c", "copy",
            "-id3v2_version", "3",
            "-metadata:s:v", "title=Album cover",
            "-metadata:s:v", "comment=Cover (front)",
            str(tmp_out),
        ))
        tmp_out.replace(mp3_path)
    except Exception:
        # Cover art embedding is best-effort — don't fail the whole job
        if tmp_out and tmp_out.exists():
            tmp_out.unlink(missing_ok=True)
    finally:
        if tmp_img and tmp_img.exists():
            tmp_img.unlink(missing_ok=True)


def extract_audio(
    job_id: str,
    source_path: str,
    fmt: str,
    bitrate: str = "192k",
    output_name: str = "",
    title: str = "",
    uploader: str = "",
    thumbnail_url: str = "",
) -> Path:
    out_dir = settings.download_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    # output_name from frontend takes priority; fall back to title then stem
    raw = output_name or title or Path(source_path).stem
    safe_stem = "".join(c for c in raw if c not in r'\/:*?"<>|').strip()
    out_file = out_dir / f"{safe_stem}.{fmt}"

    update_job(job_id, status=JobStatus.RUNNING, progress=10, message="Downloading audio stream…")

    cmd = _ffmpeg("-y", "-i", source_path, "-vn", "-acodec", _codec_for(fmt))
    # Apply bitrate only for lossy formats
    if fmt == "mp3" and bitrate:
        cmd += ["-b:a", bitrate]
    if title:
        cmd += ["-metadata", f"title={title}"]
    if uploader:
        cmd += ["-metadata", f"artist={uploader}", "-metadata", f"album_artist={uploader}"]
    if title:
        cmd += ["-metadata", f"album={title}"]
    cmd += [str(out_file)]

    update_job(job_id, progress=30, message="Encoding audio…")
    _run(cmd)

    # Embed cover art for MP3 (best-effort)
    if thumbnail_url and fmt == "mp3":
        update_job(job_id, progress=80, message="Embedding cover art…")
        _embed_cover(out_file, thumbnail_url)

    update_job(
        job_id,
        status=JobStatus.DONE,
        progress=100,
        message="Audio extraction complete",
        file_path=str(out_file),
        filename=out_file.name,
    )
    return out_file


def _fmt_ts(s: float) -> str:
    """Format seconds as HH:MM:SS or MM:SS for status messages."""
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


def trim_audio(job_id: str, source_path: str, start: float, end: float, output_name: str = "") -> Path:
    out_dir = settings.download_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(source_path).suffix
    safe_stem = "".join(c for c in (output_name or "trimmed") if c not in r'\/:*?"<>|').strip()
    out_file = out_dir / f"{safe_stem}{suffix}"

    update_job(job_id, status=JobStatus.RUNNING, progress=15,
               message=f"Cutting {_fmt_ts(start)} → {_fmt_ts(end)}…")

    _run(_ffmpeg(
        "-y",
        "-i", source_path,
        "-ss", str(start),
        "-to", str(end),
        "-c", "copy",
        str(out_file),
    ))

    update_job(job_id, progress=90, message="Finalizing…")

    update_job(
        job_id,
        status=JobStatus.DONE,
        progress=100,
        message="Trim complete",
        file_path=str(out_file),
        filename=out_file.name,
    )
    return out_file


def normalize_audio(job_id: str, source_path: str) -> Path:
    out_dir = settings.download_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(source_path).suffix
    out_file = out_dir / f"normalized{suffix}"

    update_job(job_id, status=JobStatus.RUNNING, progress=10, message="Analyzing loudness…")

    # EBU R128 two-pass loudnorm:
    # Pass 1 — measure actual loudness stats (output to stderr as JSON)
    # Pass 2 — apply precise correction using measured values
    import json as _json, re as _re
    probe = subprocess.run(
        _ffmpeg("-y", "-i", source_path,
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                "-f", "null", "-"),
        capture_output=True, text=True, timeout=_FFMPEG_TIMEOUT,
    )
    # Extract the JSON block FFmpeg prints to stderr
    match = _re.search(r'\{[^{}]+\}', probe.stderr, _re.DOTALL)
    if match:
        stats = _json.loads(match.group())
        af = (
            f"loudnorm=I=-16:TP=-1.5:LRA=11"
            f":measured_I={stats['input_i']}"
            f":measured_TP={stats['input_tp']}"
            f":measured_LRA={stats['input_lra']}"
            f":measured_thresh={stats['input_thresh']}"
            f":offset={stats['target_offset']}"
            f":linear=true:print_format=summary"
        )
    else:
        # Fall back to single-pass if stats couldn't be parsed
        af = "loudnorm=I=-16:TP=-1.5:LRA=11"

    update_job(job_id, progress=55, message="Applying normalization…")
    _run(_ffmpeg("-y", "-i", source_path, "-af", af, str(out_file)))

    update_job(
        job_id,
        status=JobStatus.DONE,
        progress=100,
        message="Normalization complete",
        file_path=str(out_file),
        filename=out_file.name,
    )
    return out_file


def _codec_for(fmt: str) -> str:
    return {"mp3": "libmp3lame", "wav": "pcm_s16le", "flac": "flac"}.get(fmt, "libmp3lame")
