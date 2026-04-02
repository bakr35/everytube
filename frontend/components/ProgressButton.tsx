"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Download } from "lucide-react";
import { type Job, fileUrl } from "@/lib/api";

interface Props {
  job: Job | null;
  onStart: () => void;
  idleLabel: string;
  disabled?: boolean;
}

export default function ProgressButton({ job, onStart, idleLabel, disabled }: Props) {
  const isRunning = job?.status === "running" || job?.status === "pending";
  const isDone = job?.status === "done";
  const isError = job?.status === "error";

  // — DONE state: download link button —
  if (isDone && job?.filename) {
    return (
      <motion.a
        layout
        href={fileUrl(job.job_id)}
        download={job.filename}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center gap-2 border border-lime bg-lime text-black py-3 text-xs tracking-widest uppercase font-body font-bold hover:bg-white hover:border-white transition-colors duration-150 cursor-pointer"
      >
        <Download size={13} />
        Save {job.filename.split(".").pop()?.toUpperCase()}
      </motion.a>
    );
  }

  // — ERROR state: retry button —
  if (isError) {
    return (
      <motion.button
        layout
        onClick={onStart}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center gap-2 border border-red-500 text-red-400 py-3 text-xs tracking-widest uppercase font-body font-bold hover:bg-red-500 hover:text-black transition-colors duration-150"
      >
        <XCircle size={13} />
        {job?.error ? `Error — Retry` : "Failed — Retry"}
      </motion.button>
    );
  }

  // — RUNNING state: morphic fill bar —
  if (isRunning) {
    const pct = job?.progress ?? 0;
    return (
      <motion.div
        layout
        className="relative border border-white/20 py-3 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* Fill track */}
        <motion.div
          className="absolute inset-0 bg-lime origin-left"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct / 100 }}
          transition={{ ease: "easeOut", duration: 0.5 }}
          style={{ transformOrigin: "left" }}
        />
        {/* Label — sits above fill, color flips as bar passes */}
        <div className="relative flex items-center justify-between px-4">
          <span
            className="text-xs tracking-widest uppercase font-body font-bold transition-colors duration-200"
            style={{ color: pct > 12 ? "#000" : "#fff" }}
          >
            {job?.message ?? "Processing…"}
          </span>
          <span
            className="text-xs font-body font-bold tabular-nums transition-colors duration-200"
            style={{ color: pct > 88 ? "#000" : "#fff" }}
          >
            {pct}%
          </span>
        </div>
      </motion.div>
    );
  }

  // — IDLE state: normal CTA button —
  return (
    <motion.button
      layout
      onClick={onStart}
      disabled={disabled}
      className="flex items-center justify-center gap-2 border border-white py-3 text-xs tracking-widest uppercase font-body font-bold hover:bg-white hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
    >
      {idleLabel}
    </motion.button>
  );
}
