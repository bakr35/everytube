"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import {
  Clock, Eye, User, ThumbsUp, ThumbsDown, MessageSquare,
  CheckCircle, ChevronDown, ChevronUp, Tag, List, Zap, Tv2,
} from "lucide-react";
import { type Metadata, formatDuration } from "@/lib/api";

interface Props {
  meta: Metadata;
}

const ARABIC_FONT = 'var(--font-ibm-arabic, "IBM Plex Sans Arabic", system-ui, sans-serif)';

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Sponsor category labels ───────────────────────────────────────────────────
const SPONSOR_LABELS: Record<string, string> = {
  sponsor:        "Sponsor",
  selfpromo:      "Self-promo",
  interaction:    "Interaction",
  intro:          "Intro",
  outro:          "Outro",
  preview:        "Preview",
  music_offtopic: "Music",
  filler:         "Filler",
  poi_highlight:  "Highlight",
};

const SPONSOR_COLORS: Record<string, string> = {
  sponsor:     "bg-lime/20 text-lime border-lime/30",
  selfpromo:   "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  interaction: "bg-blue-400/10 text-blue-400 border-blue-400/30",
  intro:       "bg-purple-400/10 text-purple-400 border-purple-400/30",
  outro:       "bg-purple-400/10 text-purple-400 border-purple-400/30",
  filler:      "bg-stone-400/10 text-stone-400 border-stone-400/30",
};

// ── Heatmap sparkline (overlaid on thumbnail) ────────────────────────────────
function HeatmapOverlay({ points }: { points: { value: number }[] }) {
  if (!points.length) return null;
  const max = Math.max(...points.map(p => p.value), 0.001);
  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-end gap-px h-14 pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      {points.map((p, i) => (
        <div
          key={i}
          className="relative flex-1 bg-lime"
          style={{
            height: `${Math.max(6, (p.value / max) * 80)}%`,
            opacity: 0.5 + (p.value / max) * 0.5,
          }}
        />
      ))}
    </div>
  );
}

// ── Collapsible section ───────────────────────────────────────────────────────
function Section({ label, icon, count, children }: {
  label: string; icon: React.ReactNode; count?: number; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t-2 border-t-lime/20 border-x-0 border-b-0 border border-fg/10">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-fg/[0.04] transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-body tracking-widest uppercase text-fg/50">
          {icon}
          {label}
          {count != null && (
            <span className="border border-lime/30 text-lime/60 px-1.5 py-0 text-[11px]">{count}</span>
          )}
        </span>
        {open ? <ChevronUp size={13} className="text-fg/40" /> : <ChevronDown size={13} className="text-fg/40" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MetadataCard({ meta }: Props) {
  const likeRatio = (meta.like_count && meta.dislike_count)
    ? Math.round(meta.like_count / (meta.like_count + meta.dislike_count) * 100)
    : null;

  const sponsorTotal = meta.sponsor_segments.reduce((acc, s) => {
    return acc + (s.segment[1] - s.segment[0]);
  }, 0);

  const isCreativeCommons = meta.license?.toLowerCase().includes("creative");

  // First quality is always the best available
  const bestQuality = meta.available_qualities[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="w-full border border-fg/20"
    >
      {/* ── Top: thumbnail + core info ── */}
      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr]">

        {/* Thumbnail */}
        <div className="relative w-full md:w-72 aspect-video border-b md:border-b-0 md:border-r border-fg/20 overflow-hidden shrink-0">
          <Image src={meta.thumbnail} alt={meta.title} fill className="object-cover" unoptimized />
          {meta.heatmap.length > 0 && <HeatmapOverlay points={meta.heatmap} />}
          <div className="absolute bottom-2 right-2 bg-bg/90 border border-fg/30 px-2 py-0.5 text-xs font-body font-bold tracking-widest z-10">
            {formatDuration(meta.duration)}
          </div>
          {meta.age_limit > 0 && (
            <div className="absolute top-2 left-2 bg-red-600 text-white text-[11px] font-bold px-1.5 py-0.5 tracking-widest z-10">
              {meta.age_limit}+
            </div>
          )}
          {meta.live_status === "was_live" && (
            <div className="absolute top-2 right-2 bg-red-600/80 text-white text-[11px] font-bold px-1.5 py-0.5 tracking-widest z-10">
              LIVE
            </div>
          )}
          {meta.heatmap.length > 0 && (
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-1.5 py-0.5 z-10">
              <Zap size={9} className="text-lime" />
              <span className="text-[10px] font-body tracking-widest uppercase text-lime/80">Most Replayed</span>
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="p-5 flex flex-col gap-4 min-w-0">

          {/* Title */}
          <h2 className="font-bold text-3xl md:text-4xl leading-snug text-fg" style={{ fontFamily: ARABIC_FONT }}>
            {meta.title}
          </h2>

          {/* Uploader row */}
          <div className="flex items-center gap-2 flex-wrap">
            <User size={12} className="text-fg/40 shrink-0" />
            <span className="text-sm font-body tracking-widest uppercase text-fg/70 font-semibold">{meta.uploader}</span>
            {meta.channel_is_verified && (
              <CheckCircle size={12} className="text-lime shrink-0" aria-label="Verified" />
            )}
            {meta.channel_follower_count != null && (
              <span className="text-xs font-body text-fg/50 border border-fg/20 px-2 py-0.5">
                {fmt(meta.channel_follower_count)} subs
              </span>
            )}
            {isCreativeCommons && (
              <span className="text-[11px] font-body tracking-widest border border-lime/40 text-lime/70 px-1.5 py-0.5">
                CC
              </span>
            )}
            {meta.has_captions && (
              <span className="text-[11px] font-body tracking-widest border border-blue-400/40 text-blue-400/70 px-1.5 py-0.5">
                CC SUB
              </span>
            )}
            {meta.hdr_types.length > 0 && (
              <span className="text-[11px] font-body tracking-widest border border-yellow-400/40 text-yellow-400/70 px-1.5 py-0.5">
                {meta.hdr_types[0]}
              </span>
            )}
            {meta.channel_topics.slice(0, 3).map(t => (
              <span key={t} className="text-[11px] font-body tracking-widest border border-fg/15 text-fg/40 px-1.5 py-0.5">
                {t}
              </span>
            ))}
            {meta.channel_custom_url && (
              <span className="text-xs font-mono text-fg/35 ml-1">
                {meta.channel_custom_url}
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-body tracking-widest uppercase text-fg/50">
            {meta.upload_date && (
              <span className="flex items-center gap-1.5">
                <Clock size={12} />
                {fmtDate(meta.upload_date)}
              </span>
            )}
            {meta.view_count != null && (
              <span className="flex items-center gap-1.5">
                <Eye size={12} />
                {fmt(meta.view_count)}
              </span>
            )}
            {meta.like_count != null && (
              <span className="flex items-center gap-1.5">
                <ThumbsUp size={12} />
                {fmt(meta.like_count)}
                {likeRatio != null && <span className="text-fg/30">({likeRatio}%)</span>}
              </span>
            )}
            {meta.dislike_count != null && (
              <span className="flex items-center gap-1.5">
                <ThumbsDown size={12} />
                {fmt(meta.dislike_count)}
              </span>
            )}
            {meta.comment_count != null && (
              <span className="flex items-center gap-1.5">
                <MessageSquare size={12} />
                {fmt(meta.comment_count)}
              </span>
            )}
          </div>

          {/* Quality pills */}
          <div className="flex flex-wrap gap-1.5">
            {meta.available_qualities.map(q => (
              <span
                key={q}
                className={`border px-2.5 py-1 text-xs tracking-widest uppercase font-body ${
                  q === bestQuality
                    ? "border-lime text-lime"
                    : "border-fg/20 text-fg/45"
                }`}
              >
                {q}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chapters ── */}
      {meta.chapters.length > 0 && (
        <Section label="Chapters" icon={<List size={11} />} count={meta.chapters.length}>
          <div className="flex flex-col">
            {meta.chapters.map((c, i) => (
              <div
                key={i}
                className="group flex items-center gap-4 py-2.5 border-b border-fg/5 last:border-0 hover:border-l-2 hover:border-l-lime hover:pl-2 transition-all"
              >
                <span className="text-xs font-mono text-lime/80 shrink-0 w-12">
                  {fmtTime(c.start_time)}
                </span>
                <span className="text-xs font-body text-fg/70 truncate" style={{ fontFamily: ARABIC_FONT }}>
                  {c.title}
                </span>
                <span className="text-xs font-mono text-fg/35 ml-auto shrink-0">
                  {fmtTime(c.end_time - c.start_time)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── SponsorBlock ── */}
      {meta.sponsor_segments.length > 0 && (
        <Section label="SponsorBlock" icon={<Zap size={11} />} count={meta.sponsor_segments.length}>
          <p className="text-xs font-body text-fg/40 mb-3">
            {Math.round(sponsorTotal)}s of skippable content · {meta.sponsor_segments.length} segment{meta.sponsor_segments.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {meta.sponsor_segments.map((s, i) => (
              <span
                key={i}
                className={`text-xs font-body tracking-widest uppercase border px-2.5 py-1 ${SPONSOR_COLORS[s.category] ?? "bg-fg/5 text-fg/50 border-fg/20"}`}
              >
                {SPONSOR_LABELS[s.category] ?? s.category} {fmtTime(s.segment[0])}–{fmtTime(s.segment[1])}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── Tags ── */}
      {meta.tags.length > 0 && (
        <Section label="Tags" icon={<Tag size={11} />} count={meta.tags.length}>
          <div className="flex flex-wrap gap-2">
            {meta.tags.map((t, i) => (
              <span key={i} className="text-xs font-body tracking-wide border border-fg/20 text-fg/55 px-2.5 py-1 hover:border-fg/40 hover:text-fg/75 transition-colors">
                {t}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── Channel ── */}
      {(meta.channel_created || meta.channel_country || meta.channel_video_count != null || meta.channel_topics.length > 0) && (
        <Section label="Channel" icon={<Tv2 size={11} />}>
          <div className="flex flex-col gap-3.5">

            {meta.channel_custom_url && (
              <div className="flex items-center gap-4">
                <span className="text-xs font-body tracking-widest uppercase text-fg/30 w-24 shrink-0">Handle</span>
                <span className="text-xs font-mono text-fg/65">{meta.channel_custom_url}</span>
              </div>
            )}

            {meta.channel_created && (
              <div className="flex items-center gap-4">
                <span className="text-xs font-body tracking-widest uppercase text-fg/30 w-24 shrink-0">Created</span>
                <span className="text-xs font-body text-fg/65">
                  {new Date(meta.channel_created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  <span className="text-fg/35 ml-2">
                    · {Math.floor((Date.now() - new Date(meta.channel_created).getTime()) / (1000 * 60 * 60 * 24 * 365))} years ago
                  </span>
                </span>
              </div>
            )}

            {meta.channel_country && (
              <div className="flex items-center gap-4">
                <span className="text-xs font-body tracking-widest uppercase text-fg/30 w-24 shrink-0">Country</span>
                <span className="text-xs font-body text-fg/65">{meta.channel_country}</span>
              </div>
            )}

            {meta.channel_video_count != null && (
              <div className="flex items-center gap-4">
                <span className="text-xs font-body tracking-widest uppercase text-fg/30 w-24 shrink-0">Videos</span>
                <span className="text-xs font-body text-fg/65">{meta.channel_video_count.toLocaleString()} uploaded</span>
              </div>
            )}

            {meta.channel_topics.length > 0 && (
              <div className="flex items-start gap-4">
                <span className="text-xs font-body tracking-widest uppercase text-fg/30 w-24 shrink-0 pt-0.5">Topics</span>
                <div className="flex flex-wrap gap-1.5">
                  {meta.channel_topics.map((t, i) => (
                    <span key={i} className="text-xs font-body tracking-widest border border-fg/20 text-fg/55 px-2.5 py-1">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </Section>
      )}

    </motion.div>
  );
}
