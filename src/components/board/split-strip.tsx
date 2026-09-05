"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface SplitStripProps {
  label: string;
  count: number;
  /** Which way the collapsed half sits relative to its expanded neighbor — points the chevron toward more room. */
  direction: "down" | "up";
  onExpand: () => void;
}

/**
 * A collapsed half of the board — the horizontal analogue of the collapsed
 * rail in `board-column.tsx` and the weekend strip in `weekend-column.tsx`,
 * without the vertical `writing-mode` text those use (there's no narrow
 * column here to fit a title sideways into).
 */
export function SplitStrip({ label, count, direction, onExpand }: SplitStripProps) {
  const Chevron = direction === "down" ? ChevronDown : ChevronUp;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Show ${label}${count > 0 ? `, ${count} to-dos` : ""}`}
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand();
        }
      }}
      className={cn(
        "group/half flex h-10 shrink-0 cursor-pointer items-center gap-2 px-4",
        "bg-muted/30 transition-colors hover:bg-muted/60",
        "focus-ring",
      )}
    >
      <Chevron className="size-3.5 text-muted-foreground/70" aria-hidden />
      <span className="type-column-title text-sm">{label}</span>
      {count > 0 && (
        <span className="num text-2xs font-medium text-muted-foreground">{count}</span>
      )}
    </div>
  );
}
