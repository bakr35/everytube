"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Copy, Check, ChevronDown, ChevronUp,
  Search, X, Download, Clock, ArrowUp, ArrowDown, ShieldOff,
} from "lucide-react";
import {
  fetchTranscript,
  type Transcript, type TranscriptSegment,
} from "@/lib/api";

interface Props {
  url: string;
  title?: string;
  uploader?: string;
  description?: string;
  videoUrl?: string;
}

const LANGS = [
  { code: "auto", label: "Auto"       },
  { code: "en",   label: "English"    },
  { code: "ar",   label: "Arabic"     },
  { code: "es",   label: "Spanish"    },
  { code: "fr",   label: "French"     },
  { code: "de",   label: "German"     },
  { code: "ja",   label: "Japanese"   },
  { code: "pt",   label: "Portuguese" },
  { code: "hi",   label: "Hindi"      },
];

const IS_RTL = (lang: string) => ["ar", "he", "fa", "ur"].includes(lang);

// ── Layers 1, 2 & 3B: Keyword bank ───────────────────────────────────────────
// Applied to: title, uploader, and description.
// Covers: direct Arabic terms, transliterations, reciter names (Latin + Arabic
// script), common surah names, and discipline keywords.
const QURAN_KEYWORDS = new RegExp(
  [
    // Core terms (Latin)
    "quran", "koran", "surah", "sura\\b", "ayah", "ayat",
    "recitation", "tarteel", "tajweed", "tilawat", "tilawa\\b",
    "qari\\b", "hafiz", "sheikh",
    // Notable reciters — Latin transliterations
    "menshawi", "menshawy", "minshawi", "tablawi", "tablawy",
    "sudais", "shuraim", "ghamdi", "husary", "husari",
    "maher", "mishary", "alafasy", "abdulbasit", "abdul basit",
    // Common surah names (transliterated)
    "fatiha", "baqarah", "baqara", "imran", "nisa\\b",
    "maidah", "yasin", "yaseen", "kahf\\b", "mulk\\b",
    "rahman\\b", "waqiah", "falaq\\b", "ikhlas\\b",
    // Arabic core keywords
    "القرآن", "قرآن", "سورة", "تلاوة", "تجويد",
    "ترتيل", "مصحف", "آية", "آيات", "حافظ", "قارئ",
    // Arabic reciter names (script form — catches titles like "الشيخ المنشاوي")
    "المنشاوي", "منشاوي",
    "الطبلاوي", "طبلاوي",
    "الحصري", "حصري",
    "الغامدي", "السديس", "الشريم",
    "عبد الباسط", "عبدالباسط",
    "المنشد",
  ].join("|"),
  "i"
);

// ── Layer 3: In-transcript Quranic phrase scan ────────────────────────────────
// These phrases appear almost exclusively in Quranic recitation transcripts.
// Checked against the first 20 segments after a successful fetch.
const QURAN_PHRASES = new RegExp(
  [
    // Bismillah — with or without full tashkeel
    "بِسْمِ ٱللَّهِ",
    "بسم الله الرحمن الرحيم",
    // End-of-recitation marker
    "صدق الله",
    // Al-Fatiha opener
    "ٱلْحَمْدُ لِلَّهِ",
    "الحمد لله رب العالمين",
    // Disconnected letters that open several surahs
    "الٓمٓ", "الٓرٰ", "طسٓمٓ", "يسٓ",
  ].join("|")
);

// Noise-marker segments (YouTube auto-caption labels like [موسيقى])
const NOISE_SEG_RE = /^\s*[\[♪♫][^\]]*\]?\s*$|^\s*[♪♫]\s*$/;

const TRANSCRIPT_FONT =
  'var(--font-ibm-arabic, "IBM Plex Sans Arabic", "Segoe UI", "Tahoma", sans-serif)';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Run keyword check against title, uploader, and description (Layers 1, 2 & 3B). */
function metaIsQuranic(title?: string, uploader?: string, description?: string): boolean {
  return (
    QURAN_KEYWORDS.test(title ?? "") ||
    QURAN_KEYWORDS.test(uploader ?? "") ||
    QURAN_KEYWORDS.test(description ?? "")
  );
}

/** Scan first 20 segments for distinctive Quranic phrases (Layer 3). */
function transcriptIsQuranic(segments: TranscriptSegment[]): boolean {
  const sample = segments.slice(0, 20).map(s => s.text).join(" ");
  return QURAN_PHRASES.test(sample);
}

// ── Paragraph grouping ────────────────────────────────────────────────────────
interface Paragraph {
  segmentIndices: number[];
  segments: TranscriptSegment[];
}

function groupIntoParagraphs(segments: TranscriptSegment[]): Paragraph[] {
  const MAX_SEGS = 8;
  const TIME_GAP = 3.0;

  const result: Paragraph[] = [];
  let indices: number[] = [];
  let segs: TranscriptSegment[] = [];
  let sentCount = 0;

  const flush = () => {
    if (segs.length > 0) {
      result.push({ segmentIndices: [...indices], segments: [...segs] });
      indices = []; segs = []; sentCount = 0;
    }
  };

  segments.forEach((seg, i) => {
    const text = seg.text.trim();

    if (NOISE_SEG_RE.test(text) || /^>>/.test(text)) { flush(); return; }

    if (segs.length > 0) {
      const prev = segs[segs.length - 1];
      if (seg.start - (prev.start + prev.duration) > TIME_GAP) flush();
    }

    indices.push(i);
    segs.push(seg);

    if (/[.!?؟]\s*$/.test(text)) { sentCount++; if (sentCount >= 3) flush(); }
    if (segs.length >= MAX_SEGS) flush();
  });

  flush();
  return result;
}

// ── Search highlight ──────────────────────────────────────────────────────────
function Highlighted({
  text, query, segmentMatchOffset, activeMatchIndex,
}: {
  text: string; query: string; segmentMatchOffset: number; activeMatchIndex: number;
}) {
  if (!query.trim()) return <>{text}</>;
  const safe  = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${safe})`, "gi"));
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const globalIdx = segmentMatchOffset + Math.floor(i / 2);
          const isActive  = globalIdx === activeMatchIndex;
          return (
            <mark
              key={i}
              data-active-match={isActive ? "true" : undefined}
              className={`px-0 rounded-none font-semibold ${
                isActive
                  ? "bg-yellow-500 text-stone-900 ring-1 ring-yellow-700 dark:bg-white dark:text-black dark:ring-lime"
                  : "bg-yellow-300 text-stone-900 dark:bg-lime dark:text-black"
              }`}
            >
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── More helpers ──────────────────────────────────────────────────────────────
function formatTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function toSrt(segments: TranscriptSegment[]): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts  = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, "0")}`;
  };
  return segments
    .map((seg, i) => `${i + 1}\n${ts(seg.start)} --> ${ts(seg.start + seg.duration)}\n${seg.text}\n`)
    .join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildExportFilename(title: string | undefined, lang: string, ext: string): string {
  const safe = (title ?? "Transcript")
    .replace(/[\\/:*?"<>|]/g, "").trim().replace(/\s+/g, "_");
  return `${safe}_Transcript_${lang.toUpperCase()}.${ext}`;
}

// ── Safety notice ─────────────────────────────────────────────────────────────
function QuranicBarrier({ triggeredBy }: { triggeredBy: "meta" | "content" }) {
  return (
    <div className="py-4 flex items-center justify-center gap-2">
      <ShieldOff size={14} className="text-red-500 shrink-0" />
      <p className="text-xs font-body tracking-wide text-red-500 whitespace-nowrap">
        Quranic recitations are blocked — please use verified text sources.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TranscriptCard({ url, title, uploader, description, videoUrl }: Props) {
  const [language, setLanguage]                 = useState("auto");
  const [transcript, setTranscript]             = useState<Transcript | null>(null);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [copied, setCopied]                     = useState(false);
  const [expanded, setExpanded]                 = useState(false);
  const [searchQuery, setSearchQuery]           = useState("");
  const [showTimestamps, setShowTimestamps]     = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // isQuranic is state (not just computed) because Layer 3 can upgrade it
  // after a fetch even when metadata didn't trigger earlier layers.
  const [isQuranic, setIsQuranic]               = useState<boolean>(
    () => metaIsQuranic(title, uploader, description)
  );
  const [quranTrigger, setQuranTrigger]         = useState<"meta" | "content">(
    () => (metaIsQuranic(title, uploader, description) ? "meta" : "content")
  );

  const downloadRef = useRef<HTMLDivElement>(null);

  // Re-evaluate barrier whenever video metadata changes (e.g. new video loaded
  // or Clear Dashboard fired and a fresh video props arrive).
  useEffect(() => {
    const detected = metaIsQuranic(title, uploader, description);
    setIsQuranic(detected);
    setQuranTrigger("meta");
    // Reset all viewer state so the next video starts completely clean
    setTranscript(null);
    setSearchQuery("");
    setExpanded(false);
    setShowTimestamps(false);
    setShowDownloadMenu(false);
    setActiveMatchIndex(0);
    setError(null);
    setLanguage("auto");
  }, [title, uploader, description]);

  const isRtl = IS_RTL(transcript?.language ?? language);

  // ── Paragraph groups ──────────────────────────────────────────────────────
  const paragraphs = useMemo(() => {
    if (!transcript) return [] as Paragraph[];
    return groupIntoParagraphs(transcript.segments);
  }, [transcript]);

  // ── Search match computation ──────────────────────────────────────────────
  const searchInfo = useMemo(() => {
    if (!transcript || !searchQuery.trim()) {
      return { matchesPerSegment: [] as number[], segmentOffsets: [] as number[], totalMatches: 0 };
    }
    const safe  = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "gi");
    const matchesPerSegment = transcript.segments.map(s => (s.text.match(regex) ?? []).length);
    const segmentOffsets: number[] = [];
    let cum = 0;
    for (const c of matchesPerSegment) { segmentOffsets.push(cum); cum += c; }
    return { matchesPerSegment, segmentOffsets, totalMatches: cum };
  }, [transcript, searchQuery]);

  useEffect(() => { setActiveMatchIndex(0); }, [searchQuery]);
  useEffect(() => { if (searchInfo.totalMatches > 0) setExpanded(true); }, [searchInfo.totalMatches]);
  useEffect(() => {
    if (searchInfo.totalMatches === 0) return;
    document.querySelector("[data-active-match='true']")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeMatchIndex, searchInfo.totalMatches]);

  const goNext = () => { if (searchInfo.totalMatches) setActiveMatchIndex(i => (i + 1) % searchInfo.totalMatches); };
  const goPrev = () => { if (searchInfo.totalMatches) setActiveMatchIndex(i => (i - 1 + searchInfo.totalMatches) % searchInfo.totalMatches); };

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleFetch = async () => {
    // Re-evaluate Layers 1+2+3B on every fetch (handles re-fetch after prop change)
    const fromMeta = metaIsQuranic(title, uploader, description);
    setIsQuranic(fromMeta);
    setQuranTrigger("meta");
    if (fromMeta) return; // barrier is already shown — no network call needed

    setLoading(true); setError(null); setTranscript(null);
    setSearchQuery(""); setExpanded(false);

    try {
      const data = await fetchTranscript(url, language);

      // Layer 3: scan first 20 segments for Quranic phrases
      if (transcriptIsQuranic(data.segments)) {
        setIsQuranic(true);
        setQuranTrigger("content");
        return; // discard transcript — do not render it
      }

      setTranscript(data);
      if (data.language && data.language !== "auto") setLanguage(data.language);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch transcript");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript.segments.map(s => s.text).join("\n"));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    if (!transcript) return;
    const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const header = [
      `VIDEO TITLE: ${title ?? "(unknown)"}`,
      `URL:         ${videoUrl ?? url}`,
      `DATE:        ${now}`,
      "-".repeat(50), "",
    ].join("\n");
    const body = showTimestamps
      ? transcript.segments.map(s => `[${formatTime(s.start)}]  ${s.text}`).join("\n")
      : groupIntoParagraphs(transcript.segments)
          .map(p => p.segments.map(s => s.text).join(" ")).join("\n\n");
    downloadFile(`${header}\n${body}`, buildExportFilename(title, transcript.language, "txt"), "text/plain");
    setShowDownloadMenu(false);
  };

  const handleDownloadSrt = () => {
    if (!transcript) return;
    downloadFile(toSrt(transcript.segments), buildExportFilename(title, transcript.language, "srt"), "text/plain");
    setShowDownloadMenu(false);
  };

  // ── Typography ────────────────────────────────────────────────────────────
  const readerStyle: React.CSSProperties = {
    fontFamily: TRANSCRIPT_FONT,
    fontSize:   "0.9rem",
    lineHeight: "2.2",
    ...(isRtl ? { textAlign: "right" as const, direction: "rtl" as const } : {}),
  };

  return (
    <div className="flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-fg/10">
        <div className="flex items-center gap-3 min-w-0">
          <FileText size={16} className="text-stone-700 dark:text-lime shrink-0" />
          <span className="font-display font-black uppercase tracking-widest text-sm text-fg">
            Transcript
          </span>
          {transcript && (
            <span className="text-[10px] font-body tracking-widest uppercase text-fg/30 ml-1 truncate">
              {transcript.language.toUpperCase()} · {transcript.segments.length} lines
            </span>
          )}
          {isQuranic && (
            <span className="text-[10px] font-body tracking-widest uppercase text-stone-400 dark:text-fg/25 ml-1">
              · Protected
            </span>
          )}
        </div>

        {transcript && !isQuranic && (
          <div className="flex items-center gap-1.5 shrink-0">

            {/* Timestamps toggle */}
            <button
              onClick={() => setShowTimestamps(p => !p)}
              title="Toggle timestamps"
              className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-[10px] tracking-widest uppercase font-body transition-colors duration-150 ${
                showTimestamps
                  ? "border-stone-900 text-stone-900 dark:border-lime dark:text-lime"
                  : "border-stone-300 text-stone-500 hover:border-stone-600 hover:text-stone-700 dark:border-fg/20 dark:text-fg/30 dark:hover:border-fg/40 dark:hover:text-fg/50"
              }`}
            >
              <Clock size={11} />
              <span className="hidden sm:block">Times</span>
            </button>

            {/* Copy */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 border border-stone-300 text-stone-600 hover:border-stone-700 hover:text-stone-900 dark:border-fg/20 dark:text-fg/40 dark:hover:border-lime dark:hover:text-lime px-2.5 py-1.5 text-[10px] tracking-widest uppercase font-body transition-colors duration-150"
            >
              {copied ? <Check size={11} className="text-emerald-700 dark:text-lime" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>

            {/* Export */}
            <div className="relative" ref={downloadRef}>
              <button
                onClick={() => setShowDownloadMenu(p => !p)}
                className="flex items-center gap-1.5 border border-stone-300 text-stone-600 hover:border-stone-700 hover:text-stone-900 dark:border-fg/20 dark:text-fg/40 dark:hover:border-lime dark:hover:text-lime px-2.5 py-1.5 text-[10px] tracking-widest uppercase font-body transition-colors duration-150"
              >
                <Download size={11} />
                Export
                <ChevronDown size={9} />
              </button>
              <AnimatePresence>
                {showDownloadMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 bg-white border border-stone-300 dark:bg-bg dark:border-lime/40 z-20 min-w-[100px]"
                  >
                    <button onClick={handleDownloadTxt}
                      className="w-full text-left px-4 py-2 text-[11px] font-body tracking-widest uppercase text-fg/60 hover:bg-lime hover:text-black transition-colors">
                      .txt
                    </button>
                    <button onClick={handleDownloadSrt}
                      className="w-full text-left px-4 py-2 text-[11px] font-body tracking-widest uppercase text-fg/60 hover:bg-lime hover:text-black transition-colors border-t border-fg/10">
                      .srt
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="p-6 flex flex-col gap-5">

        {/* Language selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] tracking-widest uppercase text-stone-500 dark:text-fg/30 font-body mr-1">Lang:</span>
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => setLanguage(l.code)}
              className={`px-2 py-0.5 text-[10px] tracking-widest uppercase font-body border transition-colors duration-100 ${
                language === l.code
                  ? "bg-stone-900 text-white border-stone-900 dark:border-lime dark:text-black dark:bg-lime"
                  : "border-stone-400 text-stone-600 hover:border-stone-600 dark:border-fg/20 dark:text-fg/40 dark:hover:border-fg/40"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Search bar — only when a clean transcript is loaded */}
        <AnimatePresence>
          {transcript && !isQuranic && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 border border-stone-300 bg-stone-50 dark:border-fg/15 dark:bg-card/[0.02] px-3 py-2 focus-within:border-stone-600 dark:focus-within:border-lime/40 transition-colors duration-150">
                <Search size={12} className="text-stone-400 dark:text-fg/30 shrink-0" />
                <input
                  type="text" value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.shiftKey ? goPrev() : goNext();
                    if (e.key === "Escape") setSearchQuery("");
                  }}
                  placeholder="Search in transcript…"
                  className="flex-1 bg-transparent text-xs font-body text-fg placeholder:text-stone-400 dark:placeholder:text-fg/20 tracking-wide focus:outline-none"
                />
                {searchQuery.trim() && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-fg/30 mr-1.5">
                      {searchInfo.totalMatches > 0 ? `${activeMatchIndex + 1} / ${searchInfo.totalMatches}` : "no results"}
                    </span>
                    <button onClick={goPrev} disabled={!searchInfo.totalMatches}
                      className="p-1 text-stone-500 hover:text-stone-900 dark:text-fg/30 dark:hover:text-lime disabled:opacity-20 transition-colors" title="Previous (Shift+Enter)">
                      <ArrowUp size={12} />
                    </button>
                    <button onClick={goNext} disabled={!searchInfo.totalMatches}
                      className="p-1 text-stone-500 hover:text-stone-900 dark:text-fg/30 dark:hover:text-lime disabled:opacity-20 transition-colors" title="Next (Enter)">
                      <ArrowDown size={12} />
                    </button>
                    <button onClick={() => setSearchQuery("")}
                      className="p-1 ml-0.5 text-stone-400 hover:text-stone-700 dark:text-fg/20 dark:hover:text-fg/60 transition-colors">
                      <X size={11} />
                    </button>
                  </div>
                )}
              </div>
              {searchQuery.trim() && (
                <p className="text-[10px] font-mono text-stone-400 dark:text-fg/20 mt-1.5 px-1 tracking-wide">
                  {searchInfo.totalMatches > 0
                    ? `${searchInfo.totalMatches} result${searchInfo.totalMatches !== 1 ? "s" : ""} · Enter ↓  Shift+Enter ↑`
                    : "No matches found"}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Barrier (Layers 1-3 triggered) or normal fetch button ── */}
        {isQuranic ? (
          <QuranicBarrier triggeredBy={quranTrigger} />
        ) : (
          <>
            <button
              onClick={handleFetch} disabled={loading}
              className="py-3 text-xs tracking-widest uppercase font-body font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center gap-2 max-w-sm bg-stone-900 text-white border border-stone-900 shadow-sm hover:bg-stone-700 hover:border-stone-700 hover:shadow-md dark:bg-transparent dark:text-fg dark:border-fg dark:shadow-none dark:hover:bg-fg dark:hover:text-bg dark:hover:shadow-none"
            >
              {loading ? (
                <><span className="inline-block w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> Fetching captions…</>
              ) : (transcript ? "Re-fetch" : "Get Transcript")}
            </button>

            {error && <p className="text-red-500 text-xs font-body tracking-wide">{error}</p>}

            {/* ── Transcript viewer ── */}
            <AnimatePresence>
              {transcript && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="border border-stone-200 bg-white dark:border-fg/10 dark:bg-card/[0.015]"
                >
                  <div
                    className={`transition-all duration-300 ${expanded ? "max-h-[70vh] overflow-y-auto" : "max-h-80 overflow-hidden"}`}
                    dir={isRtl ? "rtl" : "ltr"}
                  >
                    <div className="max-w-[750px] mx-auto w-full">

                      {showTimestamps ? (
                        /* ── Timestamp view: grouped rows, no table borders ── */
                        <div className="px-5 py-4" style={{ direction: "ltr" }}>
                          {paragraphs.map((para, pi) => (
                            <div key={pi} className="mb-5 last:mb-0">
                              {para.segments.map((seg, si) => {
                                const gi = para.segmentIndices[si];
                                return (
                                  <div key={gi} className="flex items-baseline gap-3 py-0.5 hover:bg-stone-50 dark:hover:bg-white/[0.03] rounded-sm px-1 -mx-1 transition-colors">
                                    <span
                                      className="text-[0.85rem] font-mono shrink-0 w-14 text-right text-stone-400 dark:text-lime/50 select-none"
                                      style={{ direction: "ltr" }}
                                    >
                                      [{formatTime(seg.start)}]
                                    </span>
                                    <span className="text-[0.85rem] leading-snug text-stone-700 dark:text-fg/75" style={isRtl ? { direction: "rtl" } : {}}>
                                      <Highlighted text={seg.text} query={searchQuery}
                                        segmentMatchOffset={searchInfo.segmentOffsets[gi] ?? 0}
                                        activeMatchIndex={activeMatchIndex} />
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* ── Reader / paragraph view ── */
                        <div className="px-5 py-5 text-stone-800 dark:text-fg/80">
                          {paragraphs.map((para, pi) => (
                            <p key={pi} className="mb-4 last:mb-0" style={readerStyle}>
                              {para.segments.map((seg, si) => (
                                <span key={para.segmentIndices[si]}>
                                  <Highlighted
                                    text={seg.text}
                                    query={searchQuery}
                                    segmentMatchOffset={searchInfo.segmentOffsets[para.segmentIndices[si]] ?? 0}
                                    activeMatchIndex={activeMatchIndex}
                                  />
                                  {" "}
                                </span>
                              ))}
                            </p>
                          ))}
                        </div>
                      )}

                    </div>
                  </div>

                  <button
                    onClick={() => setExpanded(p => !p)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 text-[10px] tracking-widest uppercase font-body text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-fg/20 dark:hover:text-lime dark:hover:bg-card/[0.03] transition-colors border-t border-stone-200 dark:border-fg/10"
                  >
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
