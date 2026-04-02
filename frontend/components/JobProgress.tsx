"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Loader } from "lucide-react";
import { type Job, fileUrl } from "@/lib/api";

interface Props {
  job: Job | null;
}

export default function JobProgress({ job }: Props) {
  if (!job) return null;

  const isDone = job.status === "done";
  const isError = job.status === "error";
  const isActive = job.status === "running" || job.status === "pending";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="mt-4 space-y-2"
      >
        {/* Progress bar */}
        <div className="h-px w-full bg-white/10 relative overflow-hidden">
          <motion.div
            className={`absolute left-0 top-0 h-full ${isError ? "bg-red-500" : "bg-lime"}`}
            initial={{ width: 0 }}
            animate={{ width: `${job.progress}%` }}
            transition={{ ease: "easeOut", duration: 0.4 }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-body tracking-widest uppercase">
            {isActive && <Loader size={11} className="animate-spin text-lime" />}
            {isDone && <CheckCircle size={11} className="text-lime" />}
            {isError && <XCircle size={11} className="text-red-400" />}
            <span className={isError ? "text-red-400" : "text-white/50"}>
              {isError ? (job.error ?? "Error") : job.message}
            </span>
          </div>

          {isDone && job.filename && (
            <a
              href={fileUrl(job.job_id)}
              download={job.filename}
              className="text-[10px] tracking-widest uppercase font-body border border-lime text-lime px-3 py-1 hover:bg-lime hover:text-black transition-colors duration-150"
            >
              Download {job.filename.split(".").pop()?.toUpperCase()}
            </a>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
