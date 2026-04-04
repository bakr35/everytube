"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { fetchMetadata, type Metadata } from "@/lib/api";
import UrlInput from "@/components/UrlInput";
import MetadataCard from "@/components/MetadataCard";
import VideoCard from "@/components/VideoCard";
import AudioCard from "@/components/AudioCard";
import TranscriptCard from "@/components/TranscriptCard";
import ThemeToggle from "@/components/ThemeToggle";

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
  const [sharedVideoJobId, setSharedVideoJobId] = useState<string | null>(null);

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
    setSharedVideoJobId(null);
  };

  return (
    <main className="min-h-screen bg-bg text-fg flex flex-col">

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-fg/10">
        <button
          onClick={handleReset}
          className="font-display font-black uppercase text-lg tracking-widest hover:text-lime transition-colors"
        >
          YTDL
        </button>
        <span className="text-[10px] tracking-[0.3em] uppercase text-fg/20 font-body hidden sm:block">
          Download · Extract · Transcribe
        </span>
        <div className="flex items-center gap-3 text-[10px] font-body tracking-widest uppercase">
          {loading && (
            <span className="inline-flex items-center gap-1.5 text-fg/20">
              <span className="w-1.5 h-1.5 rounded-full bg-lime animate-pulse" />
              Fetching
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* ── Hero / URL input ── */}
      <section className="px-6 pt-16 pb-12 border-b border-fg/10">
        <div className="max-w-4xl mx-auto">
          <AnimatePresence>
            {!meta && (
              <motion.div
                initial={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="mb-10 overflow-hidden"
              >
                <h1 className="font-display font-black uppercase text-7xl md:text-9xl lg:text-[10rem] leading-none tracking-tight">
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
            onReset={handleReset}
            collapsed={!!meta}
          />
        </div>
      </section>

      {/* ── Results ── */}
      <section className="px-6 py-10 flex-1">
        <div className="max-w-4xl mx-auto space-y-6">

          <AnimatePresence>
            {meta && <MetadataCard meta={meta} />}
          </AnimatePresence>

          {/* Clear Dashboard */}
          <AnimatePresence>
            {meta && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="flex justify-center"
              >
                <button
                  onClick={handleReset}
                  className="flex items-center gap-3 px-6 py-3 text-xs font-bold tracking-widest uppercase font-body transition-all duration-200 border-2 border-stone-700 text-stone-700 hover:bg-stone-800 hover:border-stone-800 hover:text-white shadow-sm hover:shadow-md dark:border dark:border-fg/20 dark:text-fg/40 dark:shadow-none dark:hover:border-lime dark:hover:text-fg dark:hover:bg-transparent dark:hover:shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                >
                  <RotateCcw size={13} />
                  Clear Dashboard
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Cards */}
          <AnimatePresence>
            {meta && fetchedUrl && (
              <>
                {[
                  <VideoCard key={`video-${fetchedUrl}`} url={fetchedUrl} meta={meta} onDownloadStart={() => setSharedVideoJobId(null)} onDownloadComplete={setSharedVideoJobId} />,
                  <AudioCard key={`audio-${fetchedUrl}`} url={fetchedUrl} meta={meta} sourceJobId={sharedVideoJobId} />,
                  <TranscriptCard key={`transcript-${fetchedUrl}`} url={fetchedUrl} title={meta.title} uploader={meta.uploader} description={meta.description} videoUrl={fetchedUrl} />,
                ].map((card, i) => (
                  <motion.div
                    key={`${i}-${fetchedUrl}`}
                    custom={i}
                    variants={cardSpring}
                    initial="hidden"
                    animate="show"
                    className="border border-stone-200 hover:border-stone-400 shadow-md dark:border-lime/30 dark:hover:border-lime/60 dark:shadow-none transition-colors duration-200"
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
              className="border border-fg/10 p-8 flex items-center gap-4"
            >
              <div className="w-2 h-2 rounded-full bg-lime animate-ping" />
              <span className="text-xs font-body tracking-widest uppercase text-fg/30">
                Fetching metadata…
              </span>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="px-6 py-4 border-t border-fg/10">
        <span className="text-[10px] font-body tracking-widest uppercase text-fg/15">
          Powered by yt-dlp · FFmpeg · youtube-transcript-api
        </span>
      </footer>
    </main>
  );
}
