"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

// Matches standard, short, shorts, embed, and mobile (m.) YouTube URLs
const YT_REGEX = /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

interface Props {
  value: string;
  onChange: (v: string) => void;
  onDetected: (url: string) => void;
  collapsed: boolean;
}

export default function UrlInput({ value, onChange, onDetected, collapsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteHandled = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    // Skip if this change was already handled by handlePaste
    if (pasteHandled.current) {
      pasteHandled.current = false;
      return;
    }
    if (YT_REGEX.test(v)) onDetected(v.trim());
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (YT_REGEX.test(pasted)) {
      e.preventDefault();
      pasteHandled.current = true;
      onChange(pasted);
      onDetected(pasted);
    }
  };

  return (
    <motion.div
      layout
      animate={collapsed ? { opacity: 0.4, scale: 0.97 } : { opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-full"
    >
      {!collapsed && (
        <p className="text-xs tracking-[0.25em] uppercase text-white/30 mb-4 font-body">
          Paste a YouTube link
        </p>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder="https://youtube.com/watch?v=..."
        spellCheck={false}
        className={`
          w-full bg-transparent border-none
          font-display font-black uppercase tracking-tight text-white
          placeholder:text-white/10
          transition-all duration-300
          ${collapsed ? "text-2xl" : "text-4xl md:text-6xl lg:text-7xl"}
        `}
      />
      {!collapsed && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: value ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
          style={{ originX: 0 }}
          className="h-px bg-lime mt-4"
        />
      )}
    </motion.div>
  );
}
