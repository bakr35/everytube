"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — only render after client mount
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-[38px] h-[34px]" />;

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center justify-center w-[38px] h-[34px] transition-colors duration-150 relative overflow-hidden border border-stone-400 text-stone-500 hover:border-stone-700 hover:text-stone-900 dark:border-fg/20 dark:text-fg/40 dark:hover:border-lime dark:hover:text-lime"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "moon" : "sun"}
          initial={{ rotate: -45, scale: 0.5, opacity: 0 }}
          animate={{ rotate: 0,   scale: 1,   opacity: 1 }}
          exit={{    rotate:  45, scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeInOut" }}
          className="flex items-center justify-center"
        >
          {isDark ? <Moon size={13} /> : <Sun size={13} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
