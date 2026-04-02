"use client";

import { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Copy, Check, ChevronDown, ChevronUp,
  Search, X, Download, Clock,
} from "lucide-react";
import { fetchTranscript, type Transcript, type TranscriptSegment } from "@/lib/api";

interface Props {
  url: string;
}

const LANGS = [
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "pt", label: "Portuguese" },
  { code: "hi", label: "Hindi" },
];

// Arabic script detection — used to auto-apply RTL
const IS_RTL = (lang: string) => ["ar", "he", "fa", "ur"].includes(lang);

// Arabic-optimised font stack
const ARABIC_FONT =
  '"Segoe UI", "Tahoma", "Arial Unicode MS", "Geeza Pro", "Al Nile", sans-serif';

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${safe})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-lime text-black px-0 rounded-none">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Build SRT file content from segments */
function toSrt(segments: TranscriptSegment[]): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s % 1) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(sec)},${String(ms).padStart(3, "0")}`;
  };
  return segments
    .map((seg, i) => {
      const end = seg.start + seg.duration;
      return `${i + 1}\n${ts(seg.start)} --> ${ts(end)}\n${seg.text}\n`;
    })
    .join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function TranscriptCard({ url }: Props) {
  const [language, setLanguage] = useState("ar");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);

  const isRtl = IS_RTL(transcript?.language ?? language);

  const filteredSegments = useMemo<TranscriptSegment[]>(() => {
    if (!transcript) return [];
    if (!searchQuery.trim()) return transcript.segments;
    const q = searchQuery.toLowerCase();
    return transcript.segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [transcript, searchQuery]);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);
    setTranscript(null);
    setSearchQuery("");
    setExpanded(false);
    try {
      const data = await fetchTranscript(url, language);
      setTranscript(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch transcript");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    const text = filteredSegments.map((s) => s.text).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTxt = () => {
    if (!transcript) return;
    const lines = filteredSegments.map((s) =>
      showTimestamps ? `[${formatTime(s.start)}]  ${s.text}` : s.text
    );
    downloadFile(lines.join("\n"), "transcript.txt", "text/plain");
    setShowDownloadMenu(false);
  };

  const handleDownloadSrt = () => {
    if (!transcript) return;
    downloadFile(toSrt(filteredSegments), "transcript.srt", "text/plain");
    setShowDownloadMenu(false);
  };

  return (
    <div className="flex flex-col">
      {/* ── Card header bar ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <FileText size={16} className="text-lime" />
          <span className="font-display font-black uppercase tracking-widest text-sm text-white">
            Transcript
          </span>
          {transcript && (
            <span className="text-[10px] font-body tracking-widest uppercase text-white/30 ml-2">
              {transcript.language.toUpperCase()} · {transcript.segments.length} segments
            </span>
          )}
        </div>

        {/* Right-side toolbar — only visible once transcript is loaded */}
        {transcript && (
          <div className="flex items-center gap-4">
            {/* Show timestamps toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setShowTimestamps((p) => !p)}
                className={`w-8 h-4 border transition-colors duration-150 relative cursor-pointer ${
                  showTimestamps ? "border-lime bg-lime/20" : "border-white/20"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 transition-all duration-150 ${
                    showTimestamps ? "left-4 bg-lime" : "left-0.5 bg-white/30"
                  }`}
                />
              </div>
              <Clock size={11} className={showTimestamps ? "text-lime" : "text-white/30"} />
              <span className="text-[10px] tracking-widest uppercase font-body text-white/40 hidden sm:block">
                Timestamps
              </span>
            </label>

            {/* Copy */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-body text-white/40 hover:text-lime transition-colors"
            >
              {copied ? <Check size={11} className="text-lime" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>

            {/* Download dropdown */}
            <div className="relative" ref={downloadRef}>
              <button
                onClick={() => setShowDownloadMenu((p) => !p)}
                className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-body border border-white/20 text-white/40 hover:border-lime hover:text-lime px-2 py-1 transition-colors"
              >
                <Download size={11} />
                Export
                <ChevronDown size={9} />
              </button>
              <AnimatePresence>
                {showDownloadMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 bg-black border border-lime/40 z-20 min-w-[100px]"
                  >
                    <button
                      onClick={handleDownloadTxt}
                      className="w-full text-left px-4 py-2 text-[11px] font-body tracking-widest uppercase text-white/60 hover:bg-lime hover:text-black transition-colors"
                    >
                      .txt
                    </button>
                    <button
                      onClick={handleDownloadSrt}
                      className="w-full text-left px-4 py-2 text-[11px] font-body tracking-widest uppercase text-white/60 hover:bg-lime hover:text-black transition-colors border-t border-white/10"
                    >
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
          <span className="text-[10px] tracking-widest uppercase text-white/30 font-body mr-1">Lang:</span>
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => setLanguage(l.code)}
              className={`px-2 py-0.5 text-[10px] tracking-widest uppercase font-body border transition-colors duration-100 ${
                language === l.code
                  ? "border-lime text-black bg-lime"
                  : "border-white/20 text-white/40 hover:border-white/40"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Search bar — always visible, enabled after fetch */}
        <div
          className={`flex items-center border-b transition-colors ${
            transcript ? "border-white/20 focus-within:border-lime" : "border-white/10 opacity-40 pointer-events-none"
          }`}
        >
          <Search size={12} className="text-white/30 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcript…"
            disabled={!transcript}
            className="flex-1 bg-transparent text-xs font-body text-white placeholder:text-white/20 px-2 py-2 tracking-wide"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-white/30 hover:text-white transition-colors">
              <X size={11} />
            </button>
          )}
          {searchQuery && transcript && (
            <span className="text-[10px] font-body text-white/30 ml-2 shrink-0">
              {filteredSegments.length}/{transcript.segments.length}
            </span>
          )}
        </div>

        {/* Fetch button */}
        <button
          onClick={handleFetch}
          disabled={loading}
          className="border border-white py-3 text-xs tracking-widest uppercase font-body font-bold hover:bg-white hover:text-black disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 flex items-center justify-center gap-2 max-w-sm"
        >
          {loading ? (
            <>
              <span className="inline-block w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
              Fetching captions…
            </>
          ) : (
            transcript ? "Re-fetch" : "Fetch Transcript"
          )}
        </button>

        {error && <p className="text-red-400 text-xs font-body tracking-wide">{error}</p>}

        {/* Segments viewer */}
        <AnimatePresence>
          {transcript && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="border border-white/10 bg-white/[0.02]"
            >
              {/* Viewer body */}
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  expanded ? "max-h-[70vh] overflow-y-auto" : "max-h-64"
                }`}
                dir={isRtl ? "rtl" : "ltr"}
              >
                {filteredSegments.length === 0 ? (
                  <p className="text-white/20 text-xs font-body tracking-widest uppercase p-4">
                    No matches
                  </p>
                ) : (
                  <table className="w-full border-collapse">
                    <tbody>
                      {filteredSegments.map((seg, i) => (
                        <tr
                          key={i}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors group"
                        >
                          {/* Timestamp cell — hidden when toggled off */}
                          {showTimestamps && (
                            <td
                              className="text-[10px] font-mono text-lime/50 group-hover:text-lime px-4 py-2 whitespace-nowrap align-top w-16 transition-colors"
                              style={{ direction: "ltr" }}
                            >
                              {formatTime(seg.start)}
                            </td>
                          )}
                          {/* Text cell */}
                          <td
                            className="px-4 py-2 text-sm leading-relaxed text-white/80"
                            style={{
                              textAlign: isRtl ? "right" : "left",
                              fontFamily: isRtl ? ARABIC_FONT : undefined,
                              fontSize: isRtl ? "0.95rem" : undefined,
                              lineHeight: isRtl ? "1.9" : undefined,
                            }}
                          >
                            <Highlighted text={seg.text} query={searchQuery} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Expand / collapse bar */}
              <button
                onClick={() => setExpanded((p) => !p)}
                className="w-full flex items-center justify-center gap-2 py-2 text-[10px] tracking-widest uppercase font-body text-white/20 hover:text-lime hover:bg-white/5 transition-colors border-t border-white/10"
              >
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {expanded
                  ? "Collapse"
                  : `Show all ${filteredSegments.length} lines`}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
