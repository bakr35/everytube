"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  List, Download, Music, ChevronDown, ChevronUp,
  XCircle, Check,
} from "lucide-react";
import {
  startDownload, startAudioDownload, fileUrl, formatDuration,
  type PlaylistInfo, type PlaylistVideo,
} from "@/lib/api";
import { useJobPoller } from "@/hooks/useJobPoller";

type PlaylistMode = "video" | "audio";

interface Props {
  playlist:    PlaylistInfo;
  playlistUrl: string;
}

const TRANSCRIPT_FONT =
  'var(--font-ibm-arabic, "IBM Plex Sans Arabic", "Segoe UI", sans-serif)';

// ── Shared styled select (matches VideoCard) ──────────────────────────────────
function RowSelect({
  value, onChange, options, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="appearance-none bg-white dark:bg-bg border border-stone-300 dark:border-fg/20 text-stone-800 dark:text-fg/70 text-xs font-body tracking-widest uppercase px-2.5 py-1.5 pr-6 cursor-pointer hover:border-stone-500 dark:hover:border-fg/40 focus:border-stone-700 dark:focus:border-lime focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
      >
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-white dark:bg-bg">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={8} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/30 pointer-events-none" />
    </div>
  );
}

// ── Per-row component (owns its own job poller + state) ───────────────────────
function PlaylistRow({ video, mode }: { video: PlaylistVideo; mode: PlaylistMode }) {
  const [resolution,   setResolution]   = useState("1080p");
  const [videoFormat,  setVideoFormat]  = useState("mp4");
  const [bitrate,      setBitrate]      = useState("192k");
  const [audioFormat,  setAudioFormat]  = useState("mp3");

  const [jobId,  setJobId]  = useState<string | null>(null);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [error,  setError]  = useState<string | null>(null);
  const [saved,  setSaved]  = useState(false);

  const job       = useJobPoller(jobId);
  const isRunning = job?.status === "running" || job?.status === "pending";
  const isDone    = job?.status === "done";
  const isError   = job?.status === "error";
  const pct       = job?.progress ?? 0;

  // Reset when mode changes (e.g. user switches Video ↔ Audio)
  useEffect(() => {
    setJobId(null);
    setError(null);
    setPhaseLabel("");
    setSaved(false);
  }, [mode]);

  const handleDownload = async () => {
    const videoUrl = `https://www.youtube.com/watch?v=${video.video_id}`;
    setError(null);
    setJobId(null);
    setSaved(false);

    try {
      if (mode === "video") {
        setPhaseLabel("Downloading…");
        const j = await startDownload(videoUrl, resolution, videoFormat);
        setJobId(j.job_id);
      } else {
        setPhaseLabel("Downloading audio…");
        const j = await startAudioDownload(videoUrl, audioFormat, bitrate);
        setJobId(j.job_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 120) : "Failed to start");
    }
  };

  const handleReset = () => {
    setJobId(null);
    setError(null);
    setPhaseLabel("");
    setSaved(false);
  };

  const label = mode === "video"
    ? `${resolution} ${videoFormat.toUpperCase()}`
    : `${bitrate} ${audioFormat.toUpperCase()}`;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 dark:border-fg/5 last:border-0 hover:bg-stone-50/60 dark:hover:bg-white/[0.015] transition-colors">

      {/* Thumbnail */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={video.thumbnail} alt=""
        className="w-16 h-9 object-cover shrink-0 bg-stone-200 dark:bg-stone-800"
      />

      {/* Title + duration */}
      <div className="flex-1 min-w-0" style={{ fontFamily: TRANSCRIPT_FONT }}>
        <p className="text-xs text-stone-800 dark:text-fg/80 truncate leading-snug">
          {video.title}
        </p>
        <p className="text-xs font-mono text-stone-500 dark:text-fg/35 mt-0.5">
          {formatDuration(video.duration)}
        </p>
      </div>

      {/* ── Controls area — morphs between states ── */}
      <div className="shrink-0 flex items-center gap-2">
        <AnimatePresence mode="wait">

          {/* IDLE — dropdowns + download button */}
          {!isRunning && !isDone && !isError && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex items-center gap-2"
            >
              {mode === "video" ? (
                <>
                  <RowSelect
                    value={resolution} onChange={setResolution}
                    options={[
                      { value: "1080p", label: "1080p" },
                      { value: "720p",  label: "720p"  },
                      { value: "480p",  label: "480p"  },
                    ]}
                  />
                  <RowSelect
                    value={videoFormat} onChange={setVideoFormat}
                    options={[
                      { value: "mp4", label: "MP4" },
                      { value: "mkv", label: "MKV" },
                    ]}
                  />
                </>
              ) : (
                <>
                  <RowSelect
                    value={bitrate} onChange={setBitrate}
                    options={[
                      { value: "320k", label: "320k" },
                      { value: "192k", label: "192k" },
                      { value: "128k", label: "128k" },
                    ]}
                  />
                  <RowSelect
                    value={audioFormat} onChange={setAudioFormat}
                    options={[
                      { value: "mp3", label: "MP3" },
                      { value: "wav", label: "WAV" },
                    ]}
                  />
                </>
              )}
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body tracking-widest uppercase font-bold border transition-all duration-150 bg-stone-900 text-white border-stone-900 hover:bg-stone-700 dark:bg-transparent dark:text-fg dark:border-fg/50 dark:hover:bg-fg dark:hover:text-bg dark:hover:border-fg whitespace-nowrap"
              >
                <Download size={9} />
                {label}
              </button>
            </motion.div>
          )}

          {/* RUNNING — inline progress bar */}
          {isRunning && (
            <motion.div
              key="running"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-64 flex flex-col gap-1.5"
            >
              <p className="text-xs font-body tracking-widest uppercase text-stone-500 dark:text-fg/40 truncate">
                {phaseLabel || job?.message || "Processing…"}
              </p>
              <div className="relative border border-fg/15 py-2.5 overflow-hidden">
                <motion.div
                  className="absolute inset-0 bg-lime origin-left"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: pct / 100 }}
                  transition={{ ease: "easeOut", duration: 0.5 }}
                  style={{ transformOrigin: "left" }}
                />
                <div className="relative flex items-center justify-end px-3">
                  <span
                    className="text-xs font-body font-bold tabular-nums transition-colors duration-200"
                    style={{ color: pct > 85 ? "#000" : "rgb(var(--color-fg))" }}
                  >
                    {pct}%
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* DONE — two phases: SAVE (user clicks → real download) then Downloaded ✓ */}
          {isDone && job?.filename && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1.5"
            >
              {!saved ? (
                <a
                  href={fileUrl(job.job_id)}
                  download={job.filename}
                  onClick={() => setSaved(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body tracking-widest uppercase font-bold border border-lime bg-lime text-black hover:bg-stone-900 hover:border-stone-900 hover:text-white dark:hover:bg-fg dark:hover:border-fg dark:hover:text-bg transition-all duration-150 whitespace-nowrap"
                >
                  <Download size={9} />
                  Save .{job.filename.split(".").pop()?.toUpperCase()}
                </a>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body tracking-widest uppercase font-bold border border-lime bg-lime text-black whitespace-nowrap">
                  <Check size={9} />
                  Downloaded
                </span>
              )}
              <button
                onClick={handleReset}
                className="text-fg/30 hover:text-fg/70 transition-colors"
                title="Download again"
              >
                <XCircle size={13} />
              </button>
            </motion.div>
          )}

          {/* ERROR — retry button */}
          {isError && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-end gap-1"
            >
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body tracking-widest uppercase font-bold border border-red-400 text-red-500 hover:bg-red-500 hover:text-white transition-colors whitespace-nowrap"
              >
                <XCircle size={9} />
                Retry
              </button>
              <p className="text-xs text-red-500 truncate max-w-[200px]">
                {job?.error ?? error ?? "Unknown error"}
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Main PlaylistCard ─────────────────────────────────────────────────────────
export default function PlaylistCard({ playlist }: Props) {
  const [mode, setMode]       = useState<PlaylistMode>("video");
  const [showList, setShowList] = useState(true);

  return (
    <div className="flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-fg/10">
        <div className="flex items-center gap-3 min-w-0">
          <List size={16} className="text-stone-700 dark:text-lime shrink-0" />
          <div className="min-w-0">
            <span
              className="font-bold text-sm text-fg leading-snug block truncate"
              style={{ fontFamily: TRANSCRIPT_FONT }}
            >
              {playlist.title}
            </span>
            <span className="text-xs font-body tracking-widest uppercase text-stone-500 dark:text-fg/40">
              {playlist.video_count} videos
              {playlist.uploader && ` · ${playlist.uploader}`}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowList(p => !p)}
          className="text-stone-400 dark:text-fg/30 hover:text-stone-700 dark:hover:text-fg/60 transition-colors ml-4 shrink-0"
        >
          {showList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <div className="p-6 flex flex-col gap-5">

        {/* ── Mode selector ── */}
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-widest uppercase text-stone-500 dark:text-fg/40 font-body mr-1">
            Mode:
          </span>
          {(["video", "audio"] as PlaylistMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs tracking-widest uppercase font-body border transition-colors duration-100 ${
                mode === m
                  ? "bg-stone-900 text-white border-stone-900 dark:bg-lime dark:text-black dark:border-lime"
                  : "border-stone-300 text-stone-600 hover:border-stone-700 hover:text-stone-900 dark:border-fg/20 dark:text-fg/40 dark:hover:border-fg/50"
              }`}
            >
              {m === "video" ? <Download size={10} /> : <Music size={10} />}
              {m === "video" ? "Video" : "Audio"}
            </button>
          ))}
          <span className="ml-auto text-xs font-body tracking-widest uppercase text-stone-400 dark:text-fg/30 hidden sm:block">
            {mode === "video" ? "Resolution · Format · Download" : "Bitrate · Format · Download"}
          </span>
        </div>

        {/* ── Video list ── */}
        <AnimatePresence>
          {showList && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="border border-stone-200 dark:border-fg/10 max-h-[600px] overflow-y-auto">
                {playlist.videos.map(video => (
                  <PlaylistRow key={video.video_id} video={video} mode={mode} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
