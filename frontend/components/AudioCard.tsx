"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Music, ChevronDown, Check } from "lucide-react";
import { startAudioDownload, trimAudio, pollJob, type Metadata } from "@/lib/api";
import { useJobPoller } from "@/hooks/useJobPoller";
import ProgressButton from "./ProgressButton";

interface Props {
  url: string;
  meta?: Metadata | null;
  sourceJobId?: string | null;
}

const BITRATES = ["128k", "192k", "320k"] as const;

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "").trim();
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Returns true when video is 1 hour or longer — drives HH:MM:SS vs MM:SS. */
function isLongForm(duration: number | undefined): boolean {
  return (duration ?? 0) >= 3600;
}

/** Format seconds as MM:SS or HH:MM:SS depending on video length. */
function secsToStamp(secs: number, long: boolean): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (long) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Parse MM:SS or HH:MM:SS (or bare seconds) into a float. */
function parseStamp(v: string): number {
  const parts = v.split(":");
  if (parts.length === 3) {
    return (parseInt(parts[0]) || 0) * 3600
         + (parseInt(parts[1]) || 0) * 60
         + (parseFloat(parts[2]) || 0);
  }
  if (parts.length === 2) {
    return (parseInt(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(v) || 0;
}

function buildExtractStem(safeTitle: string, fmt: string, bitrate: string): string {
  return fmt === "mp3"
    ? `${safeTitle}_${bitrate}_MP3`
    : `${safeTitle}_${fmt.toUpperCase()}`;
}

function buildTrimStem(safeTitle: string, fmt: string, bitrate: string, start: string, end: string): string {
  const ts = `${start.replace(/:/g, "-")}-${end.replace(/:/g, "-")}`;
  return fmt === "mp3"
    ? `${safeTitle}_Trim_${ts}_${bitrate}`
    : `${safeTitle}_Trim_${ts}`;
}

async function waitForJob(jobId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const j = await pollJob(jobId);
        if (j.status === "done")  { clearInterval(iv); resolve(j.job_id); }
        if (j.status === "error") { clearInterval(iv); reject(new Error(j.error ?? "Job failed")); }
      } catch (e) { clearInterval(iv); reject(e); }
    }, 1200);
  });
}


function Select({
  label, value, onChange, options, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[110px]">
      <span className="text-[10px] tracking-widest uppercase text-fg/30 font-body">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none bg-white dark:bg-bg border border-stone-300 dark:border-fg/20 text-stone-900 dark:text-fg font-semibold dark:font-normal text-xs font-body tracking-widest uppercase px-3 py-2.5 pr-8 cursor-pointer hover:border-stone-500 dark:hover:border-fg/50 focus:border-lime dark:focus:border-lime focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-white dark:bg-bg">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={10} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 dark:text-fg/40 pointer-events-none" />
      </div>
    </div>
  );
}

export default function AudioCard({ url, meta, sourceJobId }: Props) {
  const [audioFmt, setAudioFmt]     = useState("mp3");
  const [bitrate, setBitrate]       = useState("192k");
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [trimStart, setTrimStart]   = useState("00:00");
  const [trimEnd, setTrimEnd]       = useState(() =>
    meta?.duration ? secsToStamp(meta.duration, isLongForm(meta.duration)) : "00:30"
  );
  const [jobId, setJobId]           = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const polledJob = useJobPoller(jobId);
  const job = polledJob ?? (isStarting ? { job_id: "", status: "pending" as const, progress: 0, message: "Preparing…", filename: null, error: null } : null);
  const isFirstRender = useRef(true);

  const isActive    = job?.status === "running" || job?.status === "pending";
  const showBitrate = audioFmt === "mp3";
  const long        = isLongForm(meta?.duration);  // drives HH:MM:SS vs MM:SS

  // ── Hard reset on URL change ──────────────────────────────────────────────
  useEffect(() => {
    setAudioFmt("mp3");
    setBitrate("192k");
    setTrimEnabled(false);
    setTrimStart(long ? "00:00:00" : "00:00");
    setTrimEnd(meta?.duration ? secsToStamp(meta.duration, long) : "00:30");
    setJobId(null);
    setError(null);
    setIsStarting(false);
    isFirstRender.current = true;
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep trimEnd in sync with loaded duration ─────────────────────────────
  useEffect(() => {
    if (meta?.duration) {
      const l = isLongForm(meta.duration);
      setTrimEnd(secsToStamp(meta.duration, l));
      // Reformat start to match the new long/short convention if still at zero
      if (parseStamp(trimStart) === 0) setTrimStart(l ? "00:00:00" : "00:00");
    }
  }, [meta?.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset job when settings change (skip initial mount) ──────────────────
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setJobId(null);
    setError(null);
    setIsStarting(false);
  }, [audioFmt, bitrate, trimEnabled, trimStart, trimEnd]);

  // ── Trim validation ───────────────────────────────────────────────────────
  const trimInvalid = trimEnabled && parseStamp(trimEnd) <= parseStamp(trimStart);

  const safeTitle   = sanitize(meta?.title ?? "audio");
  const extractStem = buildExtractStem(safeTitle, audioFmt, bitrate);
  const trimStem    = buildTrimStem(safeTitle, audioFmt, bitrate, trimStart, trimEnd);
  const activeStem  = trimEnabled ? trimStem : extractStem;
  const previewFilename = `${activeStem}.${audioFmt}`;

  const idleLabel = trimEnabled
    ? `Download ${trimStart} to ${trimEnd}`
    : audioFmt === "mp3"
      ? `Download ${bitrate} MP3`
      : `Download ${audioFmt.toUpperCase()}`;

  // ── Blur handlers: clip inputs to valid range ─────────────────────────────
  const handleStartBlur = () => {
    if (!meta?.duration) return;
    const secs = parseStamp(trimStart);
    if (secs >= meta.duration) setTrimStart(secsToStamp(Math.max(0, meta.duration - 1), long));
  };

  const handleEndBlur = () => {
    if (!meta?.duration) return;
    const secs = parseStamp(trimEnd);
    if (secs > meta.duration) setTrimEnd(secsToStamp(meta.duration, long));
  };

  // ── Run handler ───────────────────────────────────────────────────────────
  const handleRun = async () => {
    setError(null);
    setJobId(null);
    setIsStarting(true);
    try {
      // Single-pass: yt-dlp downloads audio stream + converts in one shot
      const audio = await startAudioDownload(url, audioFmt, bitrate, extractStem);
      setIsStarting(false);
      setJobId(audio.job_id);

      if (trimEnabled) {
        const audioId = await waitForJob(audio.job_id);
        setJobId(null);
        const trimmed = await trimAudio(audioId, parseStamp(trimStart), parseStamp(trimEnd), trimStem);
        setJobId(trimmed.job_id);
      }
    } catch (e: unknown) {
      setIsStarting(false);
      setJobId(null);
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  const formatOptions  = [
    { value: "mp3",  label: "MP3"  },
    { value: "wav",  label: "WAV"  },
    { value: "flac", label: "FLAC" },
  ];
  const bitrateOptions = BITRATES.map((b) => ({ value: b, label: b }));

  // Shared class for trim time inputs
  const timeInputCls = (invalid = false) =>
    `w-24 bg-transparent border text-fg font-mono text-sm focus:outline-none px-3 py-2 transition-colors text-center ${
      invalid
        ? "border-red-500/70 focus:border-red-500"
        : "border-stone-300 dark:border-fg/20 focus:border-lime dark:focus:border-lime"
    }`;

  const placeholder = long ? "00:00:00" : "00:00";

  return (
    <div className="p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-stone-200 dark:border-fg/10">
        <Music size={16} className="text-stone-700 dark:text-lime" />
        <span className="font-display font-black uppercase tracking-widest text-sm text-fg">
          Audio Processing
        </span>
      </div>

      {/* Selectors */}
      <div className={`flex flex-wrap gap-4 transition-opacity duration-200 ${isActive ? "opacity-40 pointer-events-none" : ""}`}>
        <Select label="Format"  value={audioFmt} onChange={setAudioFmt} options={formatOptions}  disabled={isActive} />
        {showBitrate && (
          <Select label="Bitrate" value={bitrate}  onChange={setBitrate}  options={bitrateOptions} disabled={isActive} />
        )}
      </div>

      {/* Trim toggle */}
      <div className={`flex flex-col gap-3 transition-opacity duration-200 ${isActive ? "opacity-40 pointer-events-none" : ""}`}>
        <button onClick={() => setTrimEnabled((p) => !p)} className="flex items-center gap-3 w-fit">
          <div className={`w-4 h-4 border flex items-center justify-center transition-colors duration-150 ${trimEnabled ? "border-lime bg-lime" : "border-stone-400 dark:border-fg/30"}`}>
            {trimEnabled && <Check size={10} className="text-black" strokeWidth={3} />}
          </div>
          <span className="text-[10px] tracking-widest uppercase font-body text-stone-500 dark:text-fg/50 hover:text-stone-800 dark:hover:text-fg/80 transition-colors">
            Trim Audio
          </span>
        </button>

        <AnimatePresence>
          {trimEnabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-3 pt-1">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-fg/20 font-body">Start</span>
                  <input
                    type="text"
                    value={trimStart}
                    onChange={(e) => setTrimStart(e.target.value.replace(/[^0-9:]/g, ""))}
                    onBlur={handleStartBlur}
                    placeholder={placeholder}
                    className={timeInputCls()}
                  />
                </div>
                <span className="text-stone-300 dark:text-fg/20 text-xs mt-5">→</span>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-fg/20 font-body">End</span>
                  <input
                    type="text"
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(e.target.value.replace(/[^0-9:]/g, ""))}
                    onBlur={handleEndBlur}
                    placeholder={placeholder}
                    className={timeInputCls(trimInvalid)}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Action */}
      <div className="max-w-sm flex flex-col gap-1.5">
        {!job && (
          <p className="text-[10px] font-mono text-fg/25 tracking-wide truncate">
            → {previewFilename}
          </p>
        )}
        <ProgressButton
          job={job}
          onStart={handleRun}
          onReset={() => { setJobId(null); setError(null); }}
          idleLabel={idleLabel}
          disabled={trimInvalid}
        />
        {trimInvalid && (
          <p className="text-red-500/80 text-[10px] font-body tracking-wide mt-1">
            End time must be after Start time
          </p>
        )}
        {error && (
          <p className="text-red-400 text-xs font-body tracking-wide mt-1">{error}</p>
        )}
      </div>
    </div>
  );
}
