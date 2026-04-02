# YouTube Media Platform — Master Plan

## Vision

A self-hosted media tool for power users: download YouTube videos up to 4K, extract and process audio (trim, normalize), and generate transcriptions — all through a clean, fast web interface.

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Backend | FastAPI (Python 3.11+) | REST API, job queue, file management |
| Frontend | Next.js 14 (React, TypeScript) | UI, real-time job status |
| Media Processing | yt-dlp | Video/audio downloading |
| Media Processing | FFmpeg | Audio extraction, trim, normalize |
| Transcription | OpenAI Whisper (local) | Speech-to-text |
| Task Queue | Celery + Redis | Async job processing |
| Storage | Local filesystem | Downloaded media files |

---

## Design Vibe

- **Aesthetic**: Components.ai — brutalist-minimal
- **Background**: OLED black (`#000000`)
- **Typography**: Massive white bold fonts, tight tracking
- **Borders**: 1px solid white/gray borders (no rounded corners)
- **Palette**: Black, white, and a single accent (electric blue `#0066FF` or acid green `#00FF41`)
- **Motion**: Subtle — progress bars, fade-ins only

---

## Features

### Phase 1 — Backend Engine
- [x] Project scaffolding (FastAPI app, folder structure, dependencies)
- [x] `/api/download` endpoint — accepts YouTube URL + quality options
- [x] yt-dlp integration — download video up to 4K (mp4/webm)
- [x] FFmpeg integration — audio extraction (mp3/wav/flac)
- [x] Audio trim endpoint — start/end time params
- [x] Audio normalize endpoint — EBU R128 loudnorm filter
- [x] `/api/transcribe` endpoint — youtube-transcript-api (instant captions)
- [x] `/api/metadata` endpoint — title, thumbnail URL, duration, quality list
- [x] Job status tracking (in-memory store, UUID-keyed)
- [x] `/api/files/{job_id}` file serving endpoint

### Phase 2 — Frontend UI
- [ ] Next.js project setup with TypeScript + Tailwind
- [ ] URL input component with format/quality selector
- [ ] Real-time job progress display (polling or SSE)
- [ ] Audio waveform trimmer component
- [ ] Download manager — list of completed files
- [ ] Transcription viewer with copy/export
- [ ] OLED dark theme system

### Phase 3 — Polish & Production
- [ ] Docker Compose setup (backend + frontend + Redis)
- [ ] Environment config (.env, secrets management)
- [ ] Error handling & user feedback
- [ ] Rate limiting / basic auth protection
- [ ] File cleanup (auto-delete old downloads)

---

## Progress

> Updated after each major task. Resume here if session is interrupted.

| # | Task | Status | Date |
|---|------|--------|------|
| 0 | CLAUDE.md created, plan established | ✅ Done | 2026-04-01 |
| 1 | Backend scaffolding — FastAPI app, folder structure, `requirements.txt` | ✅ Done | 2026-04-01 |
| 2 | `/api/download` endpoint + yt-dlp service (up to 4K, async job) | ✅ Done | 2026-04-01 |
| 3 | `/api/audio/extract`, `/api/audio/trim`, `/api/audio/normalize` + FFmpeg service | ✅ Done | 2026-04-01 |
| 4 | `/api/transcribe` — youtube-transcript-api (instant captions, no Whisper) | ✅ Done | 2026-04-01 |
| 5 | `/api/metadata` — thumbnail URL, duration, title, quality list | ✅ Done | 2026-04-01 |
| 6 | `/api/jobs/{id}` status polling + `/api/files/{id}` file serving | ✅ Done | 2026-04-01 |
| 7 | Next.js scaffold — TypeScript, Tailwind, Archivo Black + Inter Tight fonts | ✅ Done | 2026-04-01 |
| 8 | `UrlInput` — massive borderless auto-detect input with lime underline morph | ✅ Done | 2026-04-01 |
| 9 | `MetadataCard` — thumbnail, bold title, duration, quality pills | ✅ Done | 2026-04-01 |
| 10 | `VideoCard`, `AudioCard`, `TranscriptCard` — staggered spring animation | ✅ Done | 2026-04-01 |
| 11 | `JobProgress`, `useJobPoller` — real-time polling, progress bar, download link | ✅ Done | 2026-04-01 |
| 12 | `lib/api.ts` — typed API client; `next.config.mjs` — YouTube thumbnail domains | ✅ Done | 2026-04-01 |
| 13 | Next.js 14 + Tailwind v3 + Node 18 compatibility resolved; production build clean | ✅ Done | 2026-04-02 |
| 14 | `ProgressButton` — button morphs into live fill bar (lime, % counter, status text) | ✅ Done | 2026-04-02 |
| 15 | Transcript search bar with live highlight + context-aware copy (results or full) | ✅ Done | 2026-04-02 |
| 16 | Backend auto-cleanup thread — purges files + job store every 5 min, 30 min TTL | ✅ Done | 2026-04-02 |
| 17 | Layout overhaul — vertical stack (Video→Audio→Transcript), full-width cards, lime borders | ✅ Done | 2026-04-02 |
| 18 | TranscriptCard rebuilt — timestamps toggle, .txt/.srt export, RTL+Arabic font, search in header | ✅ Done | 2026-04-02 |

---

## File Structure (Target)

```
youtube-tool/
├── CLAUDE.md
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── download.py
│   │   │   ├── audio.py
│   │   │   └── transcribe.py
│   │   ├── services/
│   │   │   ├── ytdlp_service.py
│   │   │   ├── ffmpeg_service.py
│   │   │   └── whisper_service.py
│   │   ├── models/
│   │   │   └── schemas.py
│   │   └── core/
│   │       ├── config.py
│   │       └── jobs.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

---

## Rules for Claude

1. **After every major task**, update the Progress table above with status and date.
2. **Never skip progress updates** — this file is the crash-recovery checkpoint.
3. Follow the design vibe strictly — no rounded corners, no soft shadows, no color gradients.
4. Keep backend and frontend fully decoupled (REST API only, CORS enabled).
5. All media processing is async — never block the API thread.
