"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Music, Scissors, Zap } from "lucide-react";
import { startDownload, extractAudio, trimAudio, normalizeAudio, pollJob } from "@/lib/api";
import { useJobPoller } from "@/hooks/useJobPoller";
import ProgressButton from "./ProgressButton";

interface Props {
  url: string;
}

const AUDIO_FORMATS = ["mp3", "wav", "flac"] as const;
type AudioFmt = (typeof AUDIO_FORMATS)[number];
type Mode = "extract" | "trim" | "normalize";

async function waitForJob(jobId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      const j = await pollJob(jobId);
      if (j.status === "done") { clearInterval(iv); resolve(j.job_id); }
      if (j.status === "error") { clearInterval(iv); reject(new Error(j.error ?? "Job failed")); }
    }, 1200);
  });
}

export default function AudioCard({ url }: Props) {
  const [mode, setMode] = useState<Mode>("extract");
  const [audioFmt, setAudioFmt] = useState<AudioFmt>("mp3");
  const [trimStart, setTrimStart] = useState("0");
  const [trimEnd, setTrimEnd] = useState("30");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useJobPoller(jobId);

  const handleRun = async () => {
    setError(null);
    setJobId(null);
    try {
      const dl = await startDownload(url, "best", "mp4");
      const dlId = await waitForJob(dl.job_id);
      let result;
      if (mode === "extract") {
        result = await extractAudio(dlId, audioFmt);
      } else if (mode === "trim") {
        const extr = await extractAudio(dlId, audioFmt);
        const extrId = await waitForJob(extr.job_id);
        result = await trimAudio(extrId, parseFloat(trimStart), parseFloat(trimEnd));
      } else {
        const extr = await extractAudio(dlId, audioFmt);
        const extrId = await waitForJob(extr.job_id);
        result = await normalizeAudio(extrId);
      }
      setJobId(result.job_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  const modes: { id: Mode; label: string; icon: React.ReactNode }[] = [
    { id: "extract", label: "Extract", icon: <Music size={12} /> },
    { id: "trim", label: "Trim", icon: <Scissors size={12} /> },
    { id: "normalize", label: "Normalize", icon: <Zap size={12} /> },
  ];

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* Section header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/10">
        <Music size={16} className="text-lime" />
        <span className="font-display font-black uppercase tracking-widest text-sm text-white">
          Audio Processing
        </span>
      </div>

      <div className="flex flex-wrap gap-8">
        {/* Mode tabs */}
        <div className="space-y-2">
          <label className="text-[10px] tracking-widest uppercase text-white/30 font-body">Mode</label>
          <div className="flex gap-0">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-[10px] tracking-widest uppercase font-body border-b-2 transition-colors duration-100 ${
                  mode === m.id
                    ? "border-lime text-lime"
                    : "border-white/10 text-white/30 hover:text-white/60"
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Format */}
        <div className="space-y-2">
          <label className="text-[10px] tracking-widest uppercase text-white/30 font-body">Format</label>
          <div className="flex gap-2">
            {AUDIO_FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setAudioFmt(f)}
                className={`px-3 py-1 text-xs tracking-widest uppercase font-body border transition-colors duration-100 ${
                  audioFmt === f
                    ? "border-lime text-black bg-lime"
                    : "border-white/20 text-white/50 hover:border-white/50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Trim range */}
        {mode === "trim" && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <label className="text-[10px] tracking-widest uppercase text-white/30 font-body">Range (seconds)</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={trimStart}
                onChange={(e) => setTrimStart(e.target.value)}
                min={0}
                placeholder="Start"
                className="w-24 bg-transparent border-b border-white/20 pb-1 text-white font-body text-sm focus:border-lime transition-colors text-center"
              />
              <span className="text-white/20 text-xs">→</span>
              <input
                type="number"
                value={trimEnd}
                onChange={(e) => setTrimEnd(e.target.value)}
                min={0}
                placeholder="End"
                className="w-24 bg-transparent border-b border-white/20 pb-1 text-white font-body text-sm focus:border-lime transition-colors text-center"
              />
            </div>
          </motion.div>
        )}
      </div>

      <div className="max-w-sm">
        <ProgressButton job={job} onStart={handleRun} idleLabel={`Run ${mode}`} />
        {error && <p className="text-red-400 text-xs font-body tracking-wide mt-2">{error}</p>}
      </div>
    </div>
  );
}
