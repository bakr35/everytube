"use client";
import { useState, useEffect, useRef } from "react";
import { pollJob, type Job } from "@/lib/api";

const POLL_INTERVAL  = 2000;   // ms between polls (was 1s — 2s halves server load)
const ERROR_BACKOFF  = 5000;   // ms to wait after a network error before retrying

export function useJobPoller(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    let errorCount = 0;

    const tick = async () => {
      try {
        const data = await pollJob(jobId);
        errorCount = 0;
        setJob(data);
        if (data.status === "done" || data.status === "error") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";

        // 404 means the job was evicted (server restart, TTL expiry).
        // Stop polling immediately and surface a clear error to the user.
        if (msg.includes("not found") || msg.includes("404")) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setJob({
            job_id: jobId,
            status: "error",
            progress: 0,
            message: "Job expired",
            filename: null,
            error: "Job is no longer available — the server may have restarted. Please try again.",
          });
          return;
        }

        errorCount++;
        // After 3 consecutive network errors, slow polling to 5s to avoid
        // hammering an unreachable backend
        if (errorCount >= 3 && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(tick, ERROR_BACKOFF);
        }
      }
    };

    tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId]);

  return job;
}
