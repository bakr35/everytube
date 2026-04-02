"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { Clock, Eye, User } from "lucide-react";
import { type Metadata, formatDuration } from "@/lib/api";

interface Props {
  meta: Metadata;
}

export default function MetadataCard({ meta }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22 }}
      className="w-full border border-white/20 grid grid-cols-1 md:grid-cols-[auto_1fr]"
    >
      {/* Thumbnail */}
      <div className="relative w-full md:w-80 aspect-video border-b md:border-b-0 md:border-r border-white/20 overflow-hidden">
        <Image
          src={meta.thumbnail}
          alt={meta.title}
          fill
          className="object-cover"
          unoptimized
        />
        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 bg-black border border-white/30 px-2 py-0.5 text-xs font-body font-bold tracking-widest">
          {formatDuration(meta.duration)}
        </div>
      </div>

      {/* Info */}
      <div className="p-6 flex flex-col justify-between gap-4">
        <h2 className="font-display font-black uppercase text-3xl md:text-5xl leading-none tracking-tight text-white">
          {meta.title}
        </h2>

        <div className="flex flex-wrap gap-6 text-white/40 text-xs tracking-widest uppercase font-body">
          <span className="flex items-center gap-1.5">
            <User size={12} />
            {meta.uploader}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={12} />
            {formatDuration(meta.duration)}
          </span>
          {meta.view_count != null && (
            <span className="flex items-center gap-1.5">
              <Eye size={12} />
              {meta.view_count.toLocaleString()} views
            </span>
          )}
        </div>

        {/* Quality pills */}
        <div className="flex flex-wrap gap-2">
          {meta.available_qualities.map((q) => (
            <span
              key={q}
              className="border border-white/20 px-2 py-0.5 text-[10px] tracking-widest uppercase font-body text-white/50"
            >
              {q}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
