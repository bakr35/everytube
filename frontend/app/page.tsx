"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchMetadata, type Metadata } from "@/lib/api";
import UrlInput from "@/components/UrlInput";
import MetadataCard from "@/components/MetadataCard";
import VideoCard from "@/components/VideoCard";
import AudioCard from "@/components/AudioCard";
import TranscriptCard from "@/components/TranscriptCard";

const cardSpring = {
  hidden: { opacity: 0, y: 40 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 180, damping: 22, delay: i * 0.07 },
  }),
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);

  const handleDetected = async (detectedUrl: string) => {
    if (detectedUrl === fetchedUrl) return;
    setLoading(true);
    setMeta(null);
    setFetchedUrl(detectedUrl);
    try {
      const data = await fetchMetadata(detectedUrl);
      setMeta(data);
    } catch {
      setFetchedUrl(null);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setUrl("");
    setMeta(null);
    setFetchedUrl(null);
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <button
          onClick={handleReset}
          className="font-display font-black uppercase text-lg tracking-widest hover:text-lime transition-colors"
        >
          YTDL
        </button>
        <span className="text-[10px] tracking-[0.3em] uppercase text-white/20 font-body hidden sm:block">
          Download · Extract · Transcribe
        </span>
        <div className="text-[10px] font-body tracking-widest uppercase text-white/20 w-20 text-right">
          {loading && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse" />
              Fetching
            </span>
          )}
        </div>
      </header>

      {/* ── Hero / URL input ── */}
      <section className="px-6 pt-16 pb-12 border-b border-white/10">
        <div className="max-w-4xl mx-auto">
          <AnimatePresence>
            {!meta && (
              <motion.div
                initial={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mb-10 overflow-hidden"
              >
                <h1 className="font-display font-black uppercase text-7xl md:text-9xl lg:text-[10rem] leading-none tracking-tight text-white">
                  DROP A<br />
                  <span className="text-lime">LINK.</span>
                </h1>
              </motion.div>
            )}
          </AnimatePresence>
          <UrlInput
            value={url}
            onChange={setUrl}
            onDetected={handleDetected}
            collapsed={!!meta}
          />
        </div>
      </section>

      {/* ── Results — vertical stack ── */}
      <section className="px-6 py-10 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Metadata card */}
          <AnimatePresence>
            {meta && <MetadataCard meta={meta} />}
          </AnimatePresence>

          {/* Cards stacked vertically, each full width */}
          <AnimatePresence>
            {meta && fetchedUrl && (
              <>
                {[
                  <VideoCard key="video" url={fetchedUrl} meta={meta} />,
                  <AudioCard key="audio" url={fetchedUrl} />,
                  <TranscriptCard key="transcript" url={fetchedUrl} />,
                ].map((card, i) => (
                  <motion.div
                    key={i}
                    custom={i}
                    variants={cardSpring}
                    initial="hidden"
                    animate="show"
                    className="border border-lime/30 hover:border-lime/60 transition-colors duration-200"
                  >
                    {card}
                  </motion.div>
                ))}
              </>
            )}
          </AnimatePresence>

          {/* Loading skeleton */}
          {loading && !meta && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="border border-white/10 p-8 flex items-center gap-4"
            >
              <div className="w-2 h-2 rounded-full bg-lime animate-ping" />
              <span className="text-xs font-body tracking-widest uppercase text-white/30">
                Fetching metadata…
              </span>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
        <span className="text-[10px] font-body tracking-widest uppercase text-white/15">
          Powered by yt-dlp · FFmpeg · youtube-transcript-api
        </span>
        {meta && (
          <button
            onClick={handleReset}
            className="text-[10px] font-body tracking-widest uppercase text-white/20 hover:text-lime transition-colors"
          >
            ← New link
          </button>
        )}
      </footer>
    </main>
  );
}
