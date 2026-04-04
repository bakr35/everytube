const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export interface Metadata {
  video_id: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  view_count: number | null;
  available_qualities: string[];
  description: string;
}

export interface Job {
  job_id: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  message: string;
  filename: string | null;
  error: string | null;
}

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface Transcript {
  video_id: string;
  language: string;
  segments: TranscriptSegment[];
  full_text: string;
}

export async function fetchMetadata(url: string): Promise<Metadata> {
  const res = await fetch(`${BASE}/api/metadata?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error((await res.json()).detail ?? "Failed to fetch metadata");
  return res.json();
}

export async function startDownload(url: string, quality: string, format: string): Promise<Job> {
  const res = await fetch(`${BASE}/api/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, quality, format }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Download failed");
  return res.json();
}

interface AudioMeta {
  title?: string;
  uploader?: string;
  thumbnail_url?: string;
}

export async function extractAudio(
  job_id: string,
  format: string,
  meta?: AudioMeta,
  bitrate = "192k",
  output_name = "",
): Promise<Job> {
  const res = await fetch(`${BASE}/api/audio/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id,
      format,
      bitrate,
      output_name,
      title: meta?.title ?? "",
      uploader: meta?.uploader ?? "",
      thumbnail_url: meta?.thumbnail_url ?? "",
    }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Extract failed");
  return res.json();
}

export async function trimAudio(job_id: string, start: number, end: number, output_name = ""): Promise<Job> {
  const res = await fetch(`${BASE}/api/audio/trim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id, start, end, output_name }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Trim failed");
  return res.json();
}

export async function normalizeAudio(job_id: string): Promise<Job> {
  const res = await fetch(`${BASE}/api/audio/normalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Normalize failed");
  return res.json();
}

export async function fetchTranscript(url: string, language = "auto"): Promise<Transcript> {
  const res = await fetch(`${BASE}/api/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, language }),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Transcription failed");
  return res.json();
}

export async function pollJob(job_id: string): Promise<Job> {
  const res = await fetch(`${BASE}/api/jobs/${job_id}`);
  if (!res.ok) throw new Error("Job not found");
  return res.json();
}

export function fileUrl(job_id: string): string {
  return `${BASE}/api/files/${job_id}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
