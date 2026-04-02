"use client";

import { useState } from "react";
import { Film } from "lucide-react";
import { startDownload, type Metadata } from "@/lib/api";
import { useJobPoller } from "@/hooks/useJobPoller";
import ProgressButton from "./ProgressButton";

interface Props {
  url: string;
  meta: Metadata;
}

const FORMATS = ["mp4", "webm"] as const;

export default function VideoCard({ url, meta }: Props) {
  const [quality, setQuality] = useState(meta.available_qualities[0] ?? "best");
  const [format, setFormat] = useState<"mp4" | "webm">("mp4");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useJobPoller(jobId);

  const handleDownload = async () => {
    setError(null);
    setJobId(null);
    try {
      const j = await startDownload(url, quality, format);
      setJobId(j.job_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* Section header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/10">
        <Film size={16} className="text-lime" />
        <span className="font-display font-black uppercase tracking-widest text-sm text-white">
          Video Download
        </span>
      </div>

      <div className="flex flex-wrap gap-8">
        {/* Quality */}
        <div className="space-y-2">
          <label className="text-[10px] tracking-widest uppercase text-white/30 font-body">Quality</label>
          <div className="flex flex-wrap gap-2">
            {meta.available_qualities.map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`px-3 py-1 text-xs tracking-widest uppercase font-body border transition-colors duration-100 ${
                  quality === q
                    ? "border-lime text-black bg-lime"
                    : "border-white/20 text-white/50 hover:border-white/50"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Format */}
        <div className="space-y-2">
          <label className="text-[10px] tracking-widest uppercase text-white/30 font-body">Format</label>
          <div className="flex gap-2">
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1 text-xs tracking-widest uppercase font-body border transition-colors duration-100 ${
                  format === f
                    ? "border-lime text-black bg-lime"
                    : "border-white/20 text-white/50 hover:border-white/50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-sm">
        <ProgressButton
          job={job}
          onStart={handleDownload}
          idleLabel={`Download ${quality} ${format.toUpperCase()}`}
        />
        {error && <p className="text-red-400 text-xs font-body tracking-wide mt-2">{error}</p>}
      </div>
    </div>
  );
}
