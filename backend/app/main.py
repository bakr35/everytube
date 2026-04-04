from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.cleanup import start_cleanup_thread
from app.api import download, audio, transcribe, metadata, jobs, playlist


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background file cleanup (every 5 min, deletes files older than 30 min)
    start_cleanup_thread(interval_seconds=300)
    yield


app = FastAPI(
    title="YouTube Media Platform API",
    description="Download, extract, process, and transcribe YouTube content.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(download.router, prefix="/api", tags=["Download"])
app.include_router(audio.router, prefix="/api", tags=["Audio"])
app.include_router(transcribe.router, prefix="/api", tags=["Transcribe"])
app.include_router(metadata.router, prefix="/api", tags=["Metadata"])
app.include_router(jobs.router, prefix="/api", tags=["Jobs"])
app.include_router(playlist.router, prefix="/api", tags=["Playlist"])


@app.get("/health")
async def health():
    return {"status": "ok"}
