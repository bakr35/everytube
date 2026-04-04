"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, X } from "lucide-react";

const YT_REGEX       = /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const PLAYLIST_REGEX = /(?:www\.)?youtube\.com\/playlist\?(?:[^#\s]*&)?list=([A-Za-z0-9_-]+)/;
const RECENT_KEY = "yt_recent";
const MAX_RECENT = 5;

function getRecent(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
  catch { return []; }
}

function saveRecent(url: string) {
  const list = [url, ...getRecent().filter((u) => u !== url)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onDetected: (url: string) => void;
  onReset?: () => void;
  collapsed: boolean;
}

export default function UrlInput({ value, onChange, onDetected, onReset, collapsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteHandled = useRef(false);
  const [showRecent, setShowRecent] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setShowRecent(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleFocus = () => {
    const r = getRecent();
    if (r.length > 0 && !collapsed) {
      setRecent(r);
      setShowRecent(true);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (YT_REGEX.test(pasted) || PLAYLIST_REGEX.test(pasted)) {
      e.preventDefault();
      pasteHandled.current = true;
      onChange(pasted);
      saveRecent(pasted);
      onDetected(pasted);
      setShowRecent(false);
    }
  };

  const handleDetected = (url: string) => {
    saveRecent(url);
    onDetected(url);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    setShowRecent(false);
    if (pasteHandled.current) { pasteHandled.current = false; return; }
    if (YT_REGEX.test(v) || PLAYLIST_REGEX.test(v)) handleDetected(v.trim());
  };

  const selectRecent = (url: string) => {
    onChange(url);
    setShowRecent(false);
    handleDetected(url);
  };

  const removeRecent = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    const updated = getRecent().filter((u) => u !== url);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    setRecent(updated);
    if (updated.length === 0) setShowRecent(false);
  };

  return (
    <motion.div
      ref={containerRef}
      layout
      animate={collapsed ? { opacity: 0.4, scale: 0.97 } : { opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-full relative"
    >
      {!collapsed && (
        <p className="text-xs tracking-[0.25em] uppercase text-fg/30 mb-4 font-body">
          Paste a YouTube link
        </p>
      )}
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onPaste={handlePaste}
          onFocus={handleFocus}
          placeholder="https://youtube.com/watch?v=..."
          spellCheck={false}
          className={`
            w-full bg-transparent border-none
            font-display font-black uppercase tracking-tight text-fg
            placeholder:text-fg/10
            transition-all duration-300
            ${collapsed ? "text-2xl pr-8" : "text-4xl md:text-6xl lg:text-7xl pr-12"}
          `}
        />
        <AnimatePresence>
          {value && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.1 }}
              onClick={() => { onReset ? onReset() : onChange(""); }}
              className="absolute right-0 border border-fg/30 hover:border-red-500 text-fg/50 hover:text-red-500 transition-colors duration-150 shrink-0 p-1"
              aria-label="Clear"
            >
              <X size={collapsed ? 16 : 22} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      {!collapsed && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: value ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
          style={{ originX: 0 }}
          className="h-px bg-lime mt-4"
        />
      )}

      {/* Recent links dropdown */}
      <AnimatePresence>
        {showRecent && recent.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute top-full mt-3 left-0 right-0 bg-bg border border-fg/20 z-30"
          >
            <div className="flex items-center gap-2 px-4 py-2 border-b border-fg/10">
              <Clock size={10} className="text-fg/30" />
              <span className="text-[10px] tracking-widest uppercase font-body text-fg/30">
                Recent Links
              </span>
            </div>
            {recent.map((url) => (
              <div
                key={url}
                onClick={() => selectRecent(url)}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-fg/5 cursor-pointer group border-b border-fg/5 last:border-0"
              >
                <span className="text-xs font-body text-fg/50 group-hover:text-fg/80 truncate transition-colors">
                  {url}
                </span>
                <button
                  onClick={(e) => removeRecent(e, url)}
                  className="ml-3 text-fg/20 hover:text-fg/60 transition-colors shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
