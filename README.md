# YTDL — YouTube Media Platform

A self-hosted tool for power users. Paste a YouTube link and instantly download videos up to 4K, extract and process audio, and generate full transcripts — all through a clean, fast web interface with real-time job tracking.

![screenshot](https://via.placeholder.com/900x500?text=YTDL+Screenshot)

---

## Features

- **Video Download** — up to 4K, mp4 or webm, quality selector
- **Audio Download & Processing** — direct audio download, extract from video, trim by timestamp, EBU R128 loudness normalization
- **Transcription** — instant from YouTube captions, with automatic fallback to local Whisper ASR for videos without captions
- **Speaker Diarization** — optional WhisperX pipeline identifies individual speakers
- **Transcript Tools** — full-text search with highlight, copy, export as `.txt` or `.srt`
- **Playlist Support** — browse and download from YouTube playlists (up to 50 videos)
- **Claude Cleaning** — AI-powered transcript cleanup for English content (punctuation, brand name corrections)
- **Rich Metadata** — views, likes, dislikes (via ReturnYouTubeDislikes), SponsorBlock segments, chapters, heatmap, channel info
- **Dark / Light mode**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.10+) |
| Frontend | Next.js 14 + TypeScript + Tailwind CSS |
| Downloading | yt-dlp |
| Media Processing | FFmpeg |
| Transcription | youtube-transcript-api + faster-whisper / WhisperX |
| AI Cleaning | Anthropic Claude (Haiku) |
| Cache | SQLite (30-day transcript cache) |
| Animations | Framer Motion |

---

## Requirements

- Python 3.10+
- Node.js 18+
- FFmpeg installed and on PATH (or via Homebrew on macOS)
- An [Anthropic API key](https://console.anthropic.com/) *(optional — for transcript cleaning)*
- A [HuggingFace token](https://huggingface.co/settings/tokens) *(optional — for speaker diarization)*

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/bakr35/everytube.git
cd everytube
```

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `backend/`:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional — YouTube authentication (avoids bot detection on some videos)
# Option A: pull cookies from an installed browser
# COOKIES_FROM_BROWSER=chrome

# Option B: use an exported cookies.txt (Netscape format)
# COOKIES_FILE=/absolute/path/to/cookies.txt

# Optional — speaker diarization
HUGGINGFACE_TOKEN=hf_...

# Whisper model size: tiny | base | small | medium | large
WHISPER_MODEL=small
```

Start the backend:

```bash
uvicorn app.main:app --reload
# Runs on http://127.0.0.1:8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | Claude API key for English transcript cleaning |
| `WHISPER_MODEL` | No | `small` | Whisper model size (`tiny` / `base` / `small` / `medium` / `large`) |
| `COOKIES_FILE` | No | — | Path to Netscape-format `cookies.txt` for YouTube auth |
| `COOKIES_FROM_BROWSER` | No | — | Browser to pull cookies from (`chrome`, `firefox`, `safari`, `edge`) |
| `HUGGINGFACE_TOKEN` | No | — | HuggingFace token for WhisperX speaker diarization |
| `YOUTUBE_API_KEY` | No | — | YouTube Data API v3 key for extended channel metadata |
| `NEXT_PUBLIC_API_URL` | No | `http://127.0.0.1:8000` | Backend URL (set in frontend `.env.local`) |

---

## API Reference

All endpoints are under `/api`. The backend runs on port `8000` by default.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/metadata?url=` | Video metadata (title, thumbnail, qualities, chapters…) |
| `GET` | `/api/playlist/info?url=` | Playlist info + up to 50 video entries |
| `POST` | `/api/download` | Start video download job |
| `POST` | `/api/download/audio` | Start direct audio download job |
| `POST` | `/api/audio/extract` | Extract audio from a completed download |
| `POST` | `/api/audio/trim` | Trim audio to start/end timestamps |
| `POST` | `/api/audio/normalize` | Apply EBU R128 loudness normalization |
| `POST` | `/api/transcribe` | Fetch transcript (captions or Whisper fallback) |
| `GET` | `/api/jobs/{job_id}` | Poll job status (0–100% progress) |
| `GET` | `/api/files/{job_id}` | Download completed file |
| `GET` | `/health` | Health check |

---

## How Transcription Works

1. The backend first tries to fetch **YouTube's existing captions** via `youtube-transcript-api` — instant, no processing required.
2. If no captions exist, a **local Whisper job** is started in the background. The frontend polls for progress.
3. For English transcripts, the raw text is passed through **Claude** to fix punctuation, grammar, and common brand name errors (e.g. "Open AAI" → "OpenAI").
4. Non-English transcripts skip the Claude step entirely to preserve content fidelity.
5. All transcripts are **cached in SQLite** for 30 days. Use the **Re-fetch** button to force a fresh fetch.

---

## Project Structure

```
youtube-tool/
├── backend/
│   ├── app/
│   │   ├── api/          # Route handlers (download, audio, transcribe, metadata…)
│   │   ├── core/         # Config, job store, SQLite cache, cleanup thread
│   │   ├── models/       # Pydantic schemas
│   │   └── services/     # yt-dlp, FFmpeg, Whisper, transcript, Claude cleaner
│   └── requirements.txt
└── frontend/
    ├── app/              # Next.js app router (page.tsx, layout.tsx)
    ├── components/       # UI components (cards, progress, transcript viewer…)
    ├── hooks/            # useJobPoller
    ├── lib/              # Typed API client
    └── package.json
```

---

## Notes

- Downloaded files are automatically deleted after **30 minutes** to save disk space.
- A maximum of **2 concurrent Whisper jobs** run at once. Additional requests are queued.
- The Whisper `small` model is recommended for Arabic and other non-Latin-script languages. Use `medium` or `large` for higher accuracy at the cost of speed.
- No Docker setup is included — this is designed for local/self-hosted use.

---

## License

MIT
