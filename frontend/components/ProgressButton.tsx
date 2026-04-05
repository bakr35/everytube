"use client";

import { motion } from "framer-motion";
import { XCircle, Download } from "lucide-react";
import { type Job, fileUrl } from "@/lib/api";

interface Props {
  job: Job | null;
  onStart: () => void;
  onReset?: () => void;
  idleLabel: string;
  disabled?: boolean;
}

export default function ProgressButton({ job, onStart, onReset, idleLabel, disabled }: Props) {
  const isRunning = job?.status === "running" || job?.status === "pending";
  const isDone    = job?.status === "done";
  const isError   = job?.status === "error";

  // — DONE state —
  if (isDone && job?.filename) {
    return (
      <motion.a
        layout
        href={fileUrl(job.job_id)}
        download={job.filename}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-center gap-2 border border-lime bg-lime text-black py-3 text-xs tracking-widest uppercase font-body font-bold hover:bg-stone-900 hover:border-stone-900 hover:text-white dark:hover:bg-fg dark:hover:border-fg dark:hover:text-bg transition-colors duration-150 cursor-pointer w-full shadow-sm dark:shadow-none"
      >
        <Download size={13} />
        Save {job.filename.split(".").pop()?.toUpperCase()}
      </motion.a>
    );
  }

  // — ERROR state —
  if (isError) {
    return (
      <motion.button
        layout
        onClick={onStart}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full flex items-center justify-center gap-2 border border-red-500 text-red-400 py-3 text-xs tracking-widest uppercase font-body font-bold hover:bg-red-500 hover:text-black transition-colors duration-150"
      >
        <XCircle size={13} />
        {job?.error ? "Error — Retry" : "Failed — Retry"}
      </motion.button>
    );
  }

  // — RUNNING state —
  if (isRunning) {
    const pct = job?.progress ?? 0;
    return (
      <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {/* Stage label — always readable, sits above the fill bar */}
        <p className="text-xs font-body tracking-widest uppercase text-stone-500 dark:text-fg/40 mb-1.5 truncate">
          {job?.message ?? "Processing…"}
        </p>
        <div className="relative border border-fg/20 py-3 overflow-hidden">
          <motion.div
            className="absolute inset-0 bg-lime origin-left"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: pct / 100 }}
            transition={{ ease: "easeOut", duration: 0.5 }}
            style={{ transformOrigin: "left" }}
          />
          <div className="relative flex items-center justify-end px-4">
            <span
              className="text-xs font-body font-bold tabular-nums transition-colors duration-200"
              style={{ color: pct > 88 ? "#000" : "rgb(var(--color-fg))" }}
            >
              {pct}%
            </span>
          </div>
        </div>
      </motion.div>
    );
  }

  // — IDLE state —
  return (
    <motion.button
      layout
      onClick={onStart}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 py-3 px-4 text-xs tracking-widest uppercase font-body font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 bg-stone-900 text-white border border-stone-900 shadow-sm hover:bg-stone-700 hover:border-stone-700 hover:shadow-md dark:bg-transparent dark:text-fg dark:border-fg dark:shadow-none dark:hover:bg-fg dark:hover:text-bg dark:hover:shadow-none"
    >
      {idleLabel}
    </motion.button>
  );
}
