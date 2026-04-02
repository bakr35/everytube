import subprocess
from pathlib import Path
from app.core.config import settings
from app.core.jobs import update_job, JobStatus


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr[-500:]}")


def _ffmpeg(*args: str) -> list[str]:
    """Build an ffmpeg command using the resolved binary path."""
    return [settings.ffmpeg_path, *args]


def extract_audio(job_id: str, source_path: str, fmt: str) -> Path:
    out_dir = settings.download_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    stem = Path(source_path).stem
    out_file = out_dir / f"{stem}_audio.{fmt}"

    update_job(job_id, status=JobStatus.RUNNING, progress=10, message="Extracting audio…")

    _run(_ffmpeg(
        "-y",
        "-i", source_path,
        "-vn",
        "-acodec", _codec_for(fmt),
        str(out_file),
    ))

    update_job(
        job_id,
        status=JobStatus.DONE,
        progress=100,
        message="Audio extraction complete",
        file_path=str(out_file),
        filename=out_file.name,
    )
    return out_file


def trim_audio(job_id: str, source_path: str, start: float, end: float) -> Path:
    out_dir = settings.download_dir / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(source_path).suffix
    out_file = out_dir / f"trimmed{suffix}"

    update_job(job_id, status=JobStatus.RUNNING, progress=10, message="Trimming audio…")

    _run(_ffmpeg(
        "-y",
        "-i", source_path,
        "-ss", str(start),
        "-to", str(end),
        "-c", "copy",
        str(out_file),
    ))

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

    update_job(job_id, status=JobStatus.RUNNING, progress=10, message="Normalizing audio…")

    _run(_ffmpeg(
        "-y",
        "-i", source_path,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        str(out_file),
    ))

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
