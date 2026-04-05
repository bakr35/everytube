"""
Whisper-based transcription fallback (using faster-whisper / CTranslate2).

Used when a video has no YouTube captions.
Flow: download audio → run Whisper locally → clean with Claude → cache.

The WhisperModel is loaded once and reused across requests (lazy load).
"""

import os
import threading
import tempfile
from pathlib import Path

# Prevent crash when both PyTorch and CTranslate2 bundle their own OpenMP runtime.
# Without this, macOS kills the process with "libiomp5.dylib already initialized".
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import yt_dlp

from app.core.config import settings
from app.core.jobs import create_job, update_job, JobStatus
from app.core.cache import save_transcript
from app.services.transcript_cleaner import clean_transcript

# ── Whisper model (loaded once, lazily) ──────────────────────────────────────
_model      = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel
                # cpu / int8 keeps memory low; swap to "float16" if you have GPU
                _model = WhisperModel(settings.whisper_model, device="cpu", compute_type="int8")
    return _model


# ── Audio download (temp file, deleted after transcription) ──────────────────

def _download_audio(url: str, job_id: str) -> str:
    """Download audio to a temp mp3 file. Returns the file path."""
    tmp_dir  = Path(tempfile.mkdtemp(prefix="whisper_"))
    out_tmpl = str(tmp_dir / "audio.%(ext)s")

    base_opts: dict = {"quiet": True, "noplaylist": True, "no_color": True}
    if settings.cookies_file and Path(settings.cookies_file).is_file():
        base_opts["cookiefile"] = settings.cookies_file
    elif settings.cookies_from_browser:
        base_opts["cookiesfrombrowser"] = (settings.cookies_from_browser,)

    def _progress(d: dict):
        if d["status"] == "downloading":
            total      = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            pct        = int(downloaded / total * 40) if total else 0
            update_job(job_id, progress=5 + pct, message=f"Downloading audio… {5+pct}%")
        elif d["status"] == "finished":
            update_job(job_id, progress=45, message="Audio downloaded. Starting transcription…")

    ydl_opts = {
        **base_opts,
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "outtmpl": out_tmpl,
        "ffmpeg_location": str(Path(settings.ffmpeg_path).parent),
        "progress_hooks": [_progress],
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128",
        }],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    files = list(tmp_dir.iterdir())
    if not files:
        raise FileNotFoundError("Audio download produced no output file")
    return str(max(files, key=lambda f: f.stat().st_mtime))


# ── Whisper transcription ─────────────────────────────────────────────────────

def _transcribe(audio_path: str, job_id: str) -> dict:
    """Run Whisper on an audio file. Returns {language, segments}."""
    update_job(job_id, progress=50, message="Loading Whisper model…")
    model = _get_model()

    update_job(job_id, progress=55, message="Transcribing audio… this may take a few minutes")

    segs, info = model.transcribe(audio_path, beam_size=5)

    segments = []
    for seg in segs:
        text = seg.text.strip()
        if text:
            segments.append({
                "text":     text,
                "start":    round(seg.start, 3),
                "duration": round(seg.end - seg.start, 3),
            })

    return {
        "language": info.language,
        "segments": segments,
    }


# ── Background job ────────────────────────────────────────────────────────────

def run_whisper_job(job_id: str, url: str, video_id: str) -> None:
    """
    Full Whisper pipeline run in a background thread:
      1. Download audio to temp file
      2. Transcribe with Whisper
      3. Clean with Claude
      4. Save to transcript cache
      5. Mark job done
    """
    audio_path = None
    try:
        update_job(job_id, status=JobStatus.RUNNING, progress=2,
                   message="Starting audio download…")

        # 1 — download
        audio_path = _download_audio(url, job_id)

        # 2 — transcribe
        whisper_result = _transcribe(audio_path, job_id)

        # 3 — clean
        update_job(job_id, progress=88, message="Cleaning transcript…")
        raw_text  = " ".join(s["text"] for s in whisper_result["segments"])
        full_text = clean_transcript(raw_text)

        # 4 — cache
        transcript_data = {
            "video_id": video_id,
            "language": whisper_result["language"],
            "segments": whisper_result["segments"],
            "full_text": full_text,
        }
        save_transcript(transcript_data)

        # 5 — done
        update_job(job_id, status=JobStatus.DONE, progress=100,
                   message="Transcription complete")

    except Exception as exc:
        update_job(job_id, status=JobStatus.ERROR, progress=0,
                   message="Transcription failed", error=str(exc))

    finally:
        # Always delete the temp audio file
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                parent = Path(audio_path).parent
                if parent.exists() and not list(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass


def start_whisper_job(url: str, video_id: str) -> str:
    """Create a job, start the background thread, return the job_id."""
    job = create_job()
    t   = threading.Thread(
        target=run_whisper_job,
        args=(job.id, url, video_id),
        daemon=True,
    )
    t.start()
    return job.id
