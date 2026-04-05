from pydantic_settings import BaseSettings
from pathlib import Path
import shutil


def _find_ffmpeg() -> str:
    """
    Resolve FFmpeg binary path.
    Priority: env var → Apple Silicon Homebrew → Intel Homebrew → PATH.
    """
    candidates = [
        "/opt/homebrew/bin/ffmpeg",   # Apple Silicon (M1/M2/M3)
        "/usr/local/bin/ffmpeg",      # Intel Mac Homebrew
    ]
    for p in candidates:
        if Path(p).is_file():
            return p
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise EnvironmentError(
        "FFmpeg not found. Install it with: brew install ffmpeg"
    )


class Settings(BaseSettings):
    download_dir: Path = Path("downloads")
    max_file_age_hours: float = 0.5  # 30 minutes
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    # Resolved once at startup — all services read from here
    ffmpeg_path: str = ""
    # Optional: path to a Netscape-format cookies.txt exported from your browser.
    # Set via COOKIES_FILE env var or .env file to bypass YouTube bot detection.
    cookies_file: str = ""
    # Optional: pull cookies live from an installed browser (no export needed).
    # Values: "chrome", "firefox", "safari", "edge", "brave", "chromium" — or leave empty.
    cookies_from_browser: str = ""
    # Optional: YouTube Data API v3 key — enables channel metadata (creation date,
    # country, custom URL, video count, topic categories). Leave empty to skip.
    youtube_api_key: str = ""
    # Anthropic API key — enables LLM-powered transcript cleaning.
    anthropic_api_key: str = ""
    # Whisper model size: tiny | base | small | medium | large
    whisper_model: str = "small"

    model_config = {"env_file": ".env"}


settings = Settings()
settings.download_dir.mkdir(parents=True, exist_ok=True)

# Resolve FFmpeg after settings are loaded (allows env override via FFMPEG_PATH)
if not settings.ffmpeg_path:
    settings.ffmpeg_path = _find_ffmpeg()
