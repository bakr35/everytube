"use client";

import { useState, useEffect, useRef } from "react";
import { Film, ChevronDown } from "lucide-react";
import { startDownload, type Metadata } from "@/lib/api";
import { useJobPoller } from "@/hooks/useJobPoller";
import ProgressButton from "./ProgressButton";

interface Props {
  url: string;
  meta: Metadata;
  onDownloadStart?: () => void;
  onDownloadComplete?: (jobId: string) => void;
}

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "").trim();
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[120px]">
      <span className="text-[10px] tracking-widest uppercase text-fg/30 font-body">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none bg-white dark:bg-bg border border-stone-300 dark:border-fg/20 text-stone-900 dark:text-fg font-semibold dark:font-normal text-xs font-body tracking-widest uppercase px-3 py-2.5 pr-8 cursor-pointer hover:border-stone-500 dark:hover:border-fg/50 focus:border-lime dark:focus:border-lime focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-bg">
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={10}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 pointer-events-none"
        />
      </div>
    </div>
  );
}

export default function VideoCard({ url, meta, onDownloadStart, onDownloadComplete }: Props) {
  const [quality, setQuality] = useState(meta.available_qualities[0] ?? "best");
  const [format, setFormat] = useState("mp4");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useJobPoller(jobId);
  const isFirstRender = useRef(true);

  const isActive = job?.status === "running" || job?.status === "pending";

  // Hard reset when the source URL changes
  useEffect(() => {
    setQuality(meta.available_qualities[0] ?? "best");
    setFormat("mp4");
    setJobId(null);
    setError(null);
    isFirstRender.current = true;
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when user changes quality or format
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setJobId(null);
    setError(null);
  }, [quality, format]);

  // Notify parent when download finishes
  useEffect(() => {
    if (job?.status === "done" && job.job_id) {
      onDownloadComplete?.(job.job_id);
    }
  }, [job?.status, job?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async () => {
    onDownloadStart?.();
    setError(null);
    setJobId(null);
    try {
      const j = await startDownload(url, quality, format);
      setJobId(j.job_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  const previewFilename = `${sanitize(meta.title)}_${quality}_${format.toUpperCase()}.${format}`;

  const qualityOptions = meta.available_qualities.map((q) => ({ value: q, label: q }));
  const formatOptions = [
    { value: "mp4",  label: "MP4"  },
    { value: "webm", label: "WebM" },
  ];

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-stone-200 dark:border-fg/10">
        <Film size={16} className="text-stone-700 dark:text-lime" />
        <span className="font-display font-black uppercase tracking-widest text-sm text-fg">
          Video Download
        </span>
      </div>

      {/* Selectors */}
      <div className={`flex flex-wrap gap-4 transition-opacity duration-200 ${isActive ? "opacity-40 pointer-events-none" : ""}`}>
        <Select label="Resolution" value={quality} onChange={setQuality} options={qualityOptions} disabled={isActive} />
        <Select label="Format"     value={format}  onChange={setFormat}  options={formatOptions}  disabled={isActive} />
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
          onStart={handleDownload}
          onReset={() => { setJobId(null); setError(null); }}
          idleLabel={`Download ${quality} ${format.toUpperCase()}`}
        />
        {error && (
          <p className="text-red-400 text-xs font-body tracking-wide mt-1">{error}</p>
        )}
      </div>
    </div>
  );
}
