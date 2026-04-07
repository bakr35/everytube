"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Copy, Check, ChevronDown, ChevronUp,
  Search, X, Download, Clock, ArrowUp, ArrowDown, ShieldOff, Users,
} from "lucide-react";
import {
  fetchTranscript, pollJob, isWhisperJob,
  type Transcript, type TranscriptSegment,
} from "@/lib/api";

interface Props {
  url: string;
  title?: string;
  uploader?: string;
  description?: string;
  videoUrl?: string;
}

// ── RTL detection ─────────────────────────────────────────────────────────────
const RTL_LANG_CODES = new Set(["ar", "he", "iw", "fa", "ur"]);

function detectIsRtl(langCode: string, sampleText: string): boolean {
  if (!RTL_LANG_CODES.has(langCode)) return false;
  if (!sampleText.trim()) return true;
  const rtlChars  = (sampleText.match(/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const totalChars = sampleText.replace(/\s/g, "").length;
  return totalChars > 0 && rtlChars / totalChars > 0.3;
}

// ── Quran detection ───────────────────────────────────────────────────────────
const QURAN_KEYWORDS = new RegExp(
  [
    "quran","koran","surah","sura\\b","ayah","ayat",
    "recitation","tarteel","tajweed","tilawat","tilawa\\b",
    "qari\\b","hafiz","sheikh",
    "menshawi","menshawy","minshawi","tablawi","tablawy",
    "sudais","shuraim","ghamdi","husary","husari",
    "maher","mishary","alafasy","abdulbasit","abdul basit",
    "fatiha","baqarah","baqara","imran","nisa\\b",
    "maidah","yasin","yaseen","kahf\\b","mulk\\b",
    "rahman\\b","waqiah","falaq\\b","ikhlas\\b",
    "القرآن","قرآن","سورة","تلاوة","تجويد",
    "ترتيل","مصحف","آية","آيات","حافظ","قارئ",
    "المنشاوي","منشاوي","الطبلاوي","طبلاوي",
    "الحصري","حصري","الغامدي","السديس","الشريم",
    "عبد الباسط","عبدالباسط","المنشد",
  ].join("|"), "i"
);
const QURAN_PHRASES = new RegExp(
  ["بِسْمِ ٱللَّهِ","بسم الله الرحمن الرحيم","صدق الله",
   "ٱلْحَمْدُ لِلَّهِ","الحمد لله رب العالمين",
   "الٓمٓ","الٓرٰ","طسٓمٓ","يسٓ"].join("|")
);
const NOISE_SEG_RE = /^\s*[\[♪♫][^\]]*\]?\s*$|^\s*[♪♫]\s*$/;
const TRANSCRIPT_FONT_MONO = 'ui-monospace, "Cascadia Code", "Source Code Pro", "Courier New", monospace';
const TRANSCRIPT_FONT_RTL  = 'var(--font-ibm-arabic, "IBM Plex Sans Arabic", "Tahoma", sans-serif)';

function metaIsQuranic(title?: string, uploader?: string, description?: string) {
  return QURAN_KEYWORDS.test(title ?? "") || QURAN_KEYWORDS.test(uploader ?? "") || QURAN_KEYWORDS.test(description ?? "");
}
// Require ≥3 distinct phrase matches across the full transcript.
// A speech that opens with Bismillah scores 1 → not blocked.
// Actual recitation scores many → blocked.
function transcriptIsQuranic(segments: TranscriptSegment[]): boolean {
  const fullText = segments.map(s => s.text).join(" ");
  let matches = 0;
  // Count how many distinct phrases appear (each phrase counts once)
  const phrases = ["بِسْمِ ٱللَّهِ","بسم الله الرحمن الرحيم","صدق الله",
    "ٱلْحَمْدُ لِلَّهِ","الحمد لله رب العالمين",
    "الٓمٓ","الٓرٰ","طسٓمٓ","يسٓ"];
  for (const phrase of phrases) {
    if (fullText.includes(phrase)) matches++;
    if (matches >= 3) return true;
  }
  return false;
}

// ── Speaker colours (cycles if > 6 speakers) ─────────────────────────────────
const SPEAKER_COLOURS = [
  "text-lime",
  "text-sky-400",
  "text-orange-400",
  "text-violet-400",
  "text-rose-400",
  "text-emerald-400",
];
function speakerColour(label: string): string {
  const n = parseInt(label.replace(/\D/g, ""), 10) || 1;
  return SPEAKER_COLOURS[(n - 1) % SPEAKER_COLOURS.length];
}

// ── Paragraph grouping ────────────────────────────────────────────────────────
interface Paragraph { segmentIndices: number[]; segments: TranscriptSegment[]; }

function groupIntoParagraphs(segments: TranscriptSegment[]): Paragraph[] {
  const TIME_GAP = 2.5, SOFT_WORD_CAP = 70, HARD_WORD_CAP = 130, HARD_SEG_CAP = 16, MIN_SENT = 3;
  const result: Paragraph[] = [];
  let indices: number[] = [], segs: TranscriptSegment[] = [];
  let sentCount = 0, wordCount = 0, softCapped = false;

  const flush = () => {
    if (segs.length) result.push({ segmentIndices: [...indices], segments: [...segs] });
    indices = []; segs = []; sentCount = 0; wordCount = 0; softCapped = false;
  };

  segments.forEach((seg, i) => {
    const text = seg.text.trim();
    if (!text) return;
    if (NOISE_SEG_RE.test(text) || /^>>/.test(text)) { flush(); return; }
    if (segs.length > 0) {
      const prev = segs[segs.length - 1];
      if (seg.start - (prev.start + prev.duration) > TIME_GAP) flush();
    }
    indices.push(i); segs.push(seg);
    wordCount += text.split(/\s+/).length;
    const endsWithPunct = /[.!?؟]\s*$/.test(text);
    if (endsWithPunct) sentCount++;
    if (wordCount >= SOFT_WORD_CAP) softCapped = true;
    if (softCapped && endsWithPunct)                               { flush(); return; }
    if (sentCount >= MIN_SENT && wordCount >= SOFT_WORD_CAP * 0.6) { flush(); return; }
    if (wordCount >= HARD_WORD_CAP || segs.length >= HARD_SEG_CAP)   flush();
  });
  flush();
  return result;
}

// ── Search highlight ──────────────────────────────────────────────────────────
function Highlighted({ text, query, matchOffset, activeMatchIndex }: {
  text: string; query: string; matchOffset: number; activeMatchIndex: number;
}) {
  if (!query.trim()) return <>{text}</>;
  const safe  = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${safe})`, "gi"));
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const idx      = matchOffset + Math.floor(i / 2);
          const isActive = idx === activeMatchIndex;
          return (
            <mark key={i} data-active-match={isActive ? "true" : undefined}
              className={`px-0 rounded-none font-semibold ${isActive
                ? "bg-yellow-500 text-stone-900 ring-1 ring-yellow-700 dark:bg-white dark:text-black dark:ring-lime"
                : "bg-yellow-300 text-stone-900 dark:bg-lime dark:text-black"}`}>
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function toSrt(segments: TranscriptSegment[]) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts  = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, "0")}`;
  };
  return segments.map((seg, i) =>
    `${i+1}\n${ts(seg.start)} --> ${ts(seg.start+seg.duration)}\n${seg.text}\n`
  ).join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

function buildExportFilename(title: string | undefined, lang: string, ext: string) {
  const safe = (title ?? "Transcript").replace(/[\\/:*?"<>|]/g, "").trim().replace(/\s+/g, "_");
  return `${safe}_Transcript_${lang.toUpperCase()}.${ext}`;
}

function QuranicBarrier({ triggeredBy, onOverride }: {
  triggeredBy: "meta" | "content";
  onOverride?: () => void;
}) {
  return (
    <div className="py-4 flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <ShieldOff size={14} className="text-red-500 shrink-0" />
        <p className="text-xs font-body tracking-wide text-red-500">
          Quranic recitations are blocked — please use verified text sources.
        </p>
      </div>
      {triggeredBy === "content" && onOverride && (
        <button onClick={onOverride}
          className="text-[11px] font-body tracking-widest uppercase border border-stone-400 text-stone-500 hover:border-stone-700 hover:text-stone-800 dark:border-fg/20 dark:text-fg/40 dark:hover:border-fg/50 dark:hover:text-fg px-3 py-1.5 transition-colors">
          This is not a recitation — show anyway
        </button>
      )}
    </div>
  );
}

// ── Whisper progress bar ──────────────────────────────────────────────────────
function WhisperProgress({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [message,  setMessage]  = useState("Starting…");
  const [failed,   setFailed]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const job = await pollJob(jobId);
          if (cancelled) break;
          setProgress(job.progress);
          setMessage(job.message);
          if (job.status === "done")  { onDone(); break; }
          if (job.status === "error") { setFailed(true); break; }
        } catch { /* ignore network blips */ }
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [jobId, onDone]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs font-body tracking-widest uppercase text-stone-500 dark:text-fg/40">
        <span>{failed ? "Transcription failed. Please try again." : message}</span>
        {!failed && <span className="font-mono tabular-nums">{progress}%</span>}
      </div>
      {!failed && (
        <div className="w-full h-0.5 bg-stone-200 dark:bg-fg/10">
          <motion.div
            className="h-full bg-stone-900 dark:bg-lime"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TranscriptCard({ url, title, uploader, description, videoUrl }: Props) {
  const [transcript,       setTranscript]       = useState<Transcript | null>(null);
  const [whisperJobId,     setWhisperJobId]      = useState<string | null>(null);
  const [loading,          setLoading]           = useState(false);
  const [error,            setError]             = useState<string | null>(null);
  const [copied,           setCopied]            = useState(false);
  const [expanded,         setExpanded]          = useState(false);
  const [searchQuery,      setSearchQuery]       = useState("");
  const [showTimestamps,   setShowTimestamps]    = useState(false);
  const [showDownloadMenu, setShowDownloadMenu]  = useState(false);
  const [activeMatchIndex, setActiveMatchIndex]  = useState(0);
  const [showSpeakers,     setShowSpeakers]      = useState(true);

  const [isQuranic,    setIsQuranic]    = useState(() => metaIsQuranic(title, uploader, description));
  const [quranTrigger, setQuranTrigger] = useState<"meta"|"content">(() =>
    metaIsQuranic(title, uploader, description) ? "meta" : "content"
  );

  const downloadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const detected = metaIsQuranic(title, uploader, description);
    setIsQuranic(detected); setQuranTrigger("meta");
    setTranscript(null); setWhisperJobId(null); setSearchQuery(""); setExpanded(false);
    setShowTimestamps(false); setShowDownloadMenu(false); setActiveMatchIndex(0); setError(null);
  }, [title, uploader, description]);

  const isRtl = detectIsRtl(
    transcript?.language ?? "en",
    transcript?.full_text?.slice(0, 300) ?? ""
  );

  // ── Clean paragraphs (reader view) ───────────────────────────────────────
  const cleanParagraphs = useMemo(() =>
    (transcript?.full_text ?? "").split(/\n\n+/).map(p => p.trim()).filter(Boolean),
    [transcript]
  );

  // ── Segment groups (timestamps view) ─────────────────────────────────────
  const paragraphs = useMemo(() => {
    if (!transcript) return [] as Paragraph[];
    return groupIntoParagraphs(transcript.segments);
  }, [transcript]);

  // ── Speaker-aware paragraphs (reader view with speakers) ─────────────────
  // Each entry: { speaker, text } — consecutive same-speaker segments merged
  const speakerBlocks = useMemo(() => {
    if (!transcript) return [] as { speaker: string | null; text: string }[];
    const blocks: { speaker: string | null; text: string }[] = [];
    for (const seg of transcript.segments) {
      const last = blocks[blocks.length - 1];
      if (last && last.speaker === (seg.speaker ?? null)) {
        last.text += " " + seg.text;
      } else {
        blocks.push({ speaker: seg.speaker ?? null, text: seg.text });
      }
    }
    return blocks;
  }, [transcript]);

  // ── Search ────────────────────────────────────────────────────────────────
  const searchInfo = useMemo(() => {
    if (!transcript || !searchQuery.trim())
      return { matchesPerBlock: [] as number[], blockOffsets: [] as number[], totalMatches: 0 };
    const safe  = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "gi");
    const blocks = showTimestamps ? transcript.segments.map(s => s.text) : cleanParagraphs;
    const matchesPerBlock = blocks.map(b => (b.match(regex) ?? []).length);
    const blockOffsets: number[] = [];
    let cum = 0;
    for (const c of matchesPerBlock) { blockOffsets.push(cum); cum += c; }
    return { matchesPerBlock, blockOffsets, totalMatches: cum };
  }, [transcript, searchQuery, showTimestamps, cleanParagraphs]);

  useEffect(() => { setActiveMatchIndex(0); }, [searchQuery]);
  useEffect(() => { if (searchInfo.totalMatches > 0) setExpanded(true); }, [searchInfo.totalMatches]);
  useEffect(() => {
    if (!searchInfo.totalMatches) return;
    document.querySelector("[data-active-match='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatchIndex, searchInfo.totalMatches]);

  const goNext = () => { if (searchInfo.totalMatches) setActiveMatchIndex(i => (i+1) % searchInfo.totalMatches); };
  const goPrev = () => { if (searchInfo.totalMatches) setActiveMatchIndex(i => (i-1+searchInfo.totalMatches) % searchInfo.totalMatches); };

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleFetch = async () => {
    const fromMeta = metaIsQuranic(title, uploader, description);
    setIsQuranic(fromMeta); setQuranTrigger("meta");
    if (fromMeta) return;

    setLoading(true); setError(null); setTranscript(null); setWhisperJobId(null);
    setSearchQuery(""); setExpanded(false);

    try {
      const result = await fetchTranscript(url);

      if (isWhisperJob(result)) {
        // No YouTube captions — Whisper job started
        setWhisperJobId(result.job_id);
        return;
      }

      if (transcriptIsQuranic(result.segments)) {
        setIsQuranic(true); setQuranTrigger("content"); return;
      }
      setTranscript(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        msg.includes("blocking") || msg.includes("IP")
          ? "YouTube is blocking this request. Try again in a moment, or try a different video."
          : msg.includes("disabled") || msg.includes("No transcript")
          ? "No transcript is available for this video."
          : msg.includes("unavailable") || msg.includes("private")
          ? "This video is unavailable or private."
          : "Could not load transcript. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // Called when Whisper job finishes — re-fetch from cache (instant)
  const handleWhisperDone = async () => {
    setWhisperJobId(null);
    setLoading(true);
    try {
      const result = await fetchTranscript(url);
      if (!isWhisperJob(result)) {
        if (transcriptIsQuranic(result.segments)) { setIsQuranic(true); setQuranTrigger("content"); return; }
        setTranscript(result);
      }
    } catch {
      setError("Could not load transcript. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    const text = transcript.full_text.trim() || transcript.segments.map(s => s.text).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    if (!transcript) return;
    const now    = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const header = [`VIDEO TITLE: ${title ?? "(unknown)"}`, `URL:         ${videoUrl ?? url}`,
      `DATE:        ${now}`, "-".repeat(50), ""].join("\n");
    const body = showTimestamps
      ? transcript.segments.map(s => `[${formatTime(s.start)}]  ${s.text}`).join("\n")
      : transcript.full_text;
    downloadFile(`${header}\n${body}`, buildExportFilename(title, transcript.language, "txt"), "text/plain");
    setShowDownloadMenu(false);
  };

  const handleDownloadSrt = () => {
    if (!transcript) return;
    downloadFile(toSrt(transcript.segments), buildExportFilename(title, transcript.language, "srt"), "text/plain");
    setShowDownloadMenu(false);
  };

  const readerStyle: React.CSSProperties = isRtl
    ? { fontFamily: TRANSCRIPT_FONT_RTL,  fontSize: "0.95rem", lineHeight: "1.9", textAlign: "right" as const, direction: "rtl" as const }
    : { fontFamily: TRANSCRIPT_FONT_MONO, fontSize: "0.925rem", lineHeight: "1.7", fontWeight: "600" };

  const langBadge = (transcript?.language ?? "").toUpperCase();

  return (
    <div className="flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-fg/10">
        <div className="flex items-center gap-3 min-w-0">
          <FileText size={16} className="text-stone-700 dark:text-lime shrink-0" />
          <span className="font-display font-black uppercase tracking-widest text-sm text-fg">Transcript</span>
          {transcript && (
            <span className="text-xs font-body tracking-widest uppercase text-stone-500 dark:text-fg/40 ml-1 truncate">
              {langBadge} · {transcript.segments.length} lines
            </span>
          )}
          {isQuranic && (
            <span className="text-xs font-body tracking-widest uppercase text-stone-500 dark:text-fg/35 ml-1">· Protected</span>
          )}
        </div>

        {transcript && !isQuranic && (
          <div className="flex items-center gap-1.5 shrink-0">

            {/* Speaker toggle — only shown when transcript has speaker data */}
            {transcript.segments.some(s => s.speaker) && (
              <button onClick={() => setShowSpeakers(p => !p)} title="Toggle speakers"
                className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs tracking-widest uppercase font-body transition-colors duration-150 ${
                  showSpeakers
                    ? "border-stone-900 text-stone-900 dark:border-lime dark:text-lime"
                    : "border-stone-300 text-stone-500 hover:border-stone-700 hover:text-stone-800 dark:border-fg/20 dark:text-fg/40 dark:hover:border-fg/50 dark:hover:text-fg/60"
                }`}>
                <Users size={11} /><span className="hidden sm:block">Speakers</span>
              </button>
            )}

            <button onClick={() => setShowTimestamps(p => !p)} title="Toggle timestamps"
              className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs tracking-widest uppercase font-body transition-colors duration-150 ${
                showTimestamps
                  ? "border-stone-900 text-stone-900 dark:border-lime dark:text-lime"
                  : "border-stone-300 text-stone-500 hover:border-stone-700 hover:text-stone-800 dark:border-fg/20 dark:text-fg/40 dark:hover:border-fg/50 dark:hover:text-fg/60"
              }`}>
              <Clock size={11} /><span className="hidden sm:block">Times</span>
            </button>

            <button onClick={handleCopy}
              className="flex items-center gap-1.5 border border-stone-300 text-stone-600 hover:border-stone-700 hover:text-stone-900 dark:border-fg/20 dark:text-fg/40 dark:hover:border-lime dark:hover:text-lime px-2.5 py-1.5 text-xs tracking-widest uppercase font-body transition-colors duration-150">
              {copied ? <Check size={11} className="text-emerald-700 dark:text-lime" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>

            <div className="relative" ref={downloadRef}>
              <button onClick={() => setShowDownloadMenu(p => !p)}
                className="flex items-center gap-1.5 border border-stone-300 text-stone-600 hover:border-stone-700 hover:text-stone-900 dark:border-fg/20 dark:text-fg/40 dark:hover:border-lime dark:hover:text-lime px-2.5 py-1.5 text-xs tracking-widest uppercase font-body transition-colors duration-150">
                <Download size={11} />Export<ChevronDown size={9} />
              </button>
              <AnimatePresence>
                {showDownloadMenu && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 bg-white border border-stone-300 dark:bg-bg dark:border-lime/40 z-20 min-w-[100px]">
                    <button onClick={handleDownloadTxt}
                      className="w-full text-left px-4 py-2 text-[11px] font-body tracking-widest uppercase text-fg/60 hover:bg-lime hover:text-black transition-colors">.txt</button>
                    <button onClick={handleDownloadSrt}
                      className="w-full text-left px-4 py-2 text-[11px] font-body tracking-widest uppercase text-fg/60 hover:bg-lime hover:text-black transition-colors border-t border-fg/10">.srt</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="p-6 flex flex-col gap-5">

        {/* Search bar */}
        <AnimatePresence>
          {transcript && !isQuranic && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
              <div className="flex items-center gap-2 border border-stone-300 bg-stone-50 dark:border-fg/15 dark:bg-card/[0.02] px-3 py-2 focus-within:border-stone-600 dark:focus-within:border-lime/40 transition-colors duration-150">
                <Search size={12} className="text-stone-400 dark:text-fg/30 shrink-0" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter") e.shiftKey ? goPrev() : goNext(); if (e.key==="Escape") setSearchQuery(""); }}
                  placeholder="Search in transcript…"
                  className="flex-1 bg-transparent text-xs font-body text-fg placeholder:text-stone-400 dark:placeholder:text-fg/20 tracking-wide focus:outline-none" />
                {searchQuery.trim() && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="text-xs font-mono tabular-nums text-stone-500 dark:text-fg/40 mr-1.5">
                      {searchInfo.totalMatches > 0 ? `${activeMatchIndex+1} / ${searchInfo.totalMatches}` : "no results"}
                    </span>
                    <button onClick={goPrev} disabled={!searchInfo.totalMatches}
                      className="p-1 text-stone-500 hover:text-stone-900 dark:text-fg/30 dark:hover:text-lime disabled:opacity-20 transition-colors"><ArrowUp size={12} /></button>
                    <button onClick={goNext} disabled={!searchInfo.totalMatches}
                      className="p-1 text-stone-500 hover:text-stone-900 dark:text-fg/30 dark:hover:text-lime disabled:opacity-20 transition-colors"><ArrowDown size={12} /></button>
                    <button onClick={() => setSearchQuery("")}
                      className="p-1 ml-0.5 text-stone-400 hover:text-stone-700 dark:text-fg/20 dark:hover:text-fg/60 transition-colors"><X size={11} /></button>
                  </div>
                )}
              </div>
              {searchQuery.trim() && (
                <p className="text-xs font-mono text-stone-400 dark:text-fg/30 mt-1.5 px-1 tracking-wide">
                  {searchInfo.totalMatches > 0
                    ? `${searchInfo.totalMatches} result${searchInfo.totalMatches!==1?"s":""} · Enter ↓  Shift+Enter ↑`
                    : "No matches found"}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {isQuranic ? (
          <QuranicBarrier
            triggeredBy={quranTrigger}
            onOverride={quranTrigger === "content" ? () => setIsQuranic(false) : undefined}
          />
        ) : (
          <>
            {/* Fetch / Re-fetch button */}
            <button onClick={handleFetch} disabled={loading || !!whisperJobId}
              className="py-3 text-xs tracking-widest uppercase font-body font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 max-w-sm bg-stone-900 text-white border border-stone-900 shadow-sm hover:bg-stone-700 hover:border-stone-700 dark:bg-transparent dark:text-fg dark:border-fg dark:shadow-none dark:hover:bg-fg dark:hover:text-bg">
              {loading
                ? <><span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> Loading…</>
                : (transcript ? "Re-fetch" : "Get Transcript")}
            </button>

            {error && <p className="text-red-500 text-xs font-body tracking-wide">{error}</p>}

            {/* Whisper progress */}
            <AnimatePresence>
              {whisperJobId && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <WhisperProgress jobId={whisperJobId} onDone={handleWhisperDone} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Transcript viewer */}
            <AnimatePresence>
              {transcript && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="border border-stone-200 bg-white dark:border-fg/10 dark:bg-card/[0.015]">
                  <div className={`transition-all duration-300 ${expanded ? "max-h-[70vh] overflow-y-auto" : "max-h-80 overflow-hidden"}`}
                    dir={isRtl ? "rtl" : "ltr"}>
                    <div className="w-full">

                      {showTimestamps ? (
                        <div className="px-5 py-4" style={{ direction: "ltr" }}>
                          {paragraphs.map((para, pi) => (
                            <div key={pi} className="mb-5 last:mb-0">
                              {para.segments.map((seg, si) => {
                                const gi = para.segmentIndices[si];
                                return (
                                  <div key={gi} className="flex items-baseline gap-3 py-0.5 hover:bg-stone-50 dark:hover:bg-white/[0.03] rounded-sm px-1 -mx-1 transition-colors">
                                    <span className="text-[0.85rem] font-mono shrink-0 w-14 text-right text-stone-400 dark:text-lime/50 select-none" style={{ direction: "ltr" }}>
                                      [{formatTime(seg.start)}]
                                    </span>
                                    <span className="text-[0.85rem] leading-snug text-stone-700 dark:text-fg/75">
                                      <Highlighted text={seg.text} query={searchQuery}
                                        matchOffset={searchInfo.blockOffsets[gi] ?? 0}
                                        activeMatchIndex={activeMatchIndex} />
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      ) : showSpeakers && speakerBlocks.some(b => b.speaker) ? (
                        // ── Speaker view ──────────────────────────────────
                        <div className="px-5 py-5 text-stone-800 dark:text-fg/80">
                          {speakerBlocks.map((block, bi) => (
                            <div key={bi} className="mb-5 last:mb-0">
                              {block.speaker && (
                                <div className={`text-[0.7rem] font-bold tracking-[0.2em] uppercase mb-1 select-none ${speakerColour(block.speaker)}`}>
                                  {block.speaker}
                                </div>
                              )}
                              <p style={readerStyle}>
                                <Highlighted text={block.text} query={searchQuery}
                                  matchOffset={searchInfo.blockOffsets[bi] ?? 0}
                                  activeMatchIndex={activeMatchIndex} />
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        // ── Clean reader view ─────────────────────────────
                        <div className="px-5 py-5 text-stone-800 dark:text-fg/80">
                          {cleanParagraphs.map((para, pi) => (
                            <p key={pi} className="mb-5 last:mb-0" style={readerStyle}>
                              <Highlighted text={para} query={searchQuery}
                                matchOffset={searchInfo.blockOffsets[pi] ?? 0}
                                activeMatchIndex={activeMatchIndex} />
                            </p>
                          ))}
                        </div>
                      )}

                    </div>
                  </div>

                  <button onClick={() => setExpanded(p => !p)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-xs tracking-widest uppercase font-body text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-fg/35 dark:hover:text-lime dark:hover:bg-card/[0.03] transition-colors border-t border-stone-200 dark:border-fg/10">
                    {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    {expanded ? "Collapse" : `Show all ${transcript.segments.length} lines`}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
