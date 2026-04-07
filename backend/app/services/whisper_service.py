"""
Whisper-based transcription fallback with optional speaker diarization.

Flow:
  • If HUGGINGFACE_TOKEN is set  → WhisperX (transcribe + align + diarize)
  • Otherwise                    → faster-whisper (transcribe only, no speakers)

Used when a video has no YouTube captions.
"""

import os
import threading
import tempfile
from pathlib import Path

import yt_dlp

# Prevent crash when PyTorch and CTranslate2 both bundle their own OpenMP runtime.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from app.core.config import settings
from app.core.jobs import create_job, update_job, JobStatus
from app.core.cache import save_transcript, close_thread_connection
from app.services.transcript_cleaner import clean_transcript

# ── Model cache (loaded once, lazily) ────────────────────────────────────────
_model      = None
_model_lock = threading.Lock()
_use_whisperx = False   # set to True on first successful whisperx import

# ── Active job dedup ──────────────────────────────────────────────────────────
# Prevents two simultaneous Whisper jobs for the same video_id.
_active_jobs: dict[str, str] = {}   # video_id → job_id
_active_lock = threading.Lock()

# Maximum concurrent Whisper jobs — each job loads audio into RAM
_MAX_WHISPER_JOBS = 2


def get_active_whisper_job(video_id: str) -> str | None:
    """Return job_id if this video is already being transcribed, else None."""
    with _active_lock:
        return _active_jobs.get(video_id)


def _register_job(video_id: str, job_id: str) -> None:
    with _active_lock:
        _active_jobs[video_id] = job_id


def _unregister_job(video_id: str) -> None:
    with _active_lock:
        _active_jobs.pop(video_id, None)


def _active_job_count() -> int:
    with _active_lock:
        return len(_active_jobs)


def _get_model():
    global _model, _use_whisperx
    if _model is None:
        with _model_lock:
            if _model is None:
                if settings.huggingface_token:
                    try:
                        import whisperx
                        _model = whisperx.load_model(
                            settings.whisper_model, device="cpu", compute_type="int8"
                        )
                        _use_whisperx = True
                    except Exception:
                        from faster_whisper import WhisperModel
                        _model = WhisperModel(
                            settings.whisper_model, device="cpu", compute_type="int8"
                        )
                else:
                    from faster_whisper import WhisperModel
                    _model = WhisperModel(
                        settings.whisper_model, device="cpu", compute_type="int8"
                    )
    return _model


# ── Audio download ────────────────────────────────────────────────────────────

def _download_audio(url: str, job_id: str) -> str:
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


# ── WhisperX path (with diarization) ─────────────────────────────────────────

def _transcribe_with_diarization(audio_path: str, job_id: str) -> dict:
    import whisperx

    update_job(job_id, progress=50, message="Loading Whisper model…")
    model = _get_model()

    update_job(job_id, progress=55, message="Transcribing audio…")
    result = model.transcribe(audio_path, batch_size=4)
    language = result.get("language", "en")

    update_job(job_id, progress=68, message="Aligning words…")
    align_model, metadata = whisperx.load_align_model(
        language_code=language, device="cpu"
    )
    result = whisperx.align(
        result["segments"], align_model, metadata, audio_path, device="cpu"
    )

    update_job(job_id, progress=78, message="Identifying speakers…")
    diarize_pipeline = whisperx.DiarizationPipeline(
        use_auth_token=settings.huggingface_token, device="cpu"
    )
    diarize_segments = diarize_pipeline(audio_path)
    result = whisperx.assign_word_speakers(diarize_segments, result)

    speaker_map: dict[str, str] = {}
    segments = []
    for seg in result.get("segments", []):
        text = seg.get("text", "").strip()
        if not text:
            continue
        raw_spkr = seg.get("speaker", "")
        if raw_spkr and raw_spkr not in speaker_map:
            speaker_map[raw_spkr] = f"Speaker {len(speaker_map) + 1}"
        friendly = speaker_map.get(raw_spkr) if raw_spkr else None
        segments.append({
            "text":     text,
            "start":    round(seg["start"], 3),
            "duration": round(seg["end"] - seg["start"], 3),
            "speaker":  friendly,
        })

    return {"language": language, "segments": segments}


# ── faster-whisper path (no diarization) ─────────────────────────────────────

def _transcribe_basic(audio_path: str, job_id: str) -> dict:
    update_job(job_id, progress=50, message="Loading Whisper model…")
    model = _get_model()

    update_job(job_id, progress=55, message="Transcribing audio… this may take a few minutes")

    # faster-whisper returns a lazy generator — consume it with live progress updates.
    # Without this the job would sit at 55% for the entire transcription duration.
    segs_gen, info = model.transcribe(audio_path, beam_size=5)
    duration = info.duration or 1  # avoid division by zero

    segments = []
    for seg in segs_gen:
        text = seg.text.strip()
        if text:
            segments.append({
                "text":     text,
                "start":    round(seg.start, 3),
                "duration": round(seg.end - seg.start, 3),
                "speaker":  None,
            })
        # Update progress proportional to how far through the audio we are (55–85%)
        pct = 55 + int((seg.end / duration) * 30)
        update_job(job_id, progress=min(pct, 85),
                   message=f"Transcribing… {min(int(seg.end/duration*100), 99)}%")

    return {"language": info.language, "segments": segments}


# ── Background job ────────────────────────────────────────────────────────────

def run_whisper_job(job_id: str, url: str, video_id: str) -> None:
    audio_path = None
    try:
        update_job(job_id, status=JobStatus.RUNNING, progress=2,
                   message="Starting audio download…")

        audio_path = _download_audio(url, job_id)

        if settings.huggingface_token and _use_whisperx:
            whisper_result = _transcribe_with_diarization(audio_path, job_id)
        else:
            whisper_result = _transcribe_basic(audio_path, job_id)

        update_job(job_id, progress=88, message="Cleaning transcript…")
        raw_text  = " ".join(s["text"] for s in whisper_result["segments"])
        full_text = clean_transcript(raw_text)

        transcript_data = {
            "video_id": video_id,
            "language": whisper_result["language"],
            "segments": whisper_result["segments"],
            "full_text": full_text,
        }
        save_transcript(transcript_data)

        update_job(job_id, status=JobStatus.DONE, progress=100,
                   message="Transcription complete")

    except Exception as exc:
        update_job(job_id, status=JobStatus.ERROR, progress=0,
                   message="Transcription failed", error=str(exc))

    finally:
        # Always unregister so a retry can start a fresh job
        _unregister_job(video_id)

        # Close the thread-local SQLite connection to prevent connection leak
        close_thread_connection()

        # Clean up temp audio file and its directory
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                parent = Path(audio_path).parent
                if parent.exists() and not list(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass


def start_whisper_job(url: str, video_id: str) -> str:
    # Enforce concurrent job cap
    if _active_job_count() >= _MAX_WHISPER_JOBS:
        raise RuntimeError(
            "Too many transcription jobs running. Please wait for one to finish."
        )

    job = create_job()
    _register_job(video_id, job.id)

    t = threading.Thread(
        target=run_whisper_job,
        args=(job.id, url, video_id),
        daemon=True,
        name=f"whisper-{job.id[:8]}",
    )
    t.start()
    return job.id
