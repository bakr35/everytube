"use client";
import { useState, useEffect, useRef } from "react";
import { pollJob, type Job } from "@/lib/api";

export function useJobPoller(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    const tick = async () => {
      try {
        const data = await pollJob(jobId);
        setJob(data);
        if (data.status === "done" || data.status === "error") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId]);

  return job;
}
