"use client";

import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { useSplitResize } from "./use-split-resize";

interface SplitHandleProps {
  containerRef: RefObject<HTMLElement | null>;
  calendarRef: RefObject<HTMLElement | null>;
  planningRef: RefObject<HTMLElement | null>;
  storedSplit: number | null;
  disabled?: boolean;
  onSplitChange: (percent: number | null) => void;
  onCollapse: (half: "calendar" | "planning") => void;
}

/**
 * The draggable seam between the calendar and planning halves — an in-flow
 * flex child (unlike `RailHandle`, which floats over its panel's edge)
 * because the seam here has no panel padding to straddle, just the two
 * halves meeting. Carries the 1px rule that used to live on the calendar
 * half's own `border-b`. Not rendered while either half is collapsed: the
 * collapsed strip is itself the affordance back, same rule as `RailHandle`.
 */
export function SplitHandle({
  containerRef,
  calendarRef,
  planningRef,
  storedSplit,
  disabled,
  onSplitChange,
  onCollapse,
}: SplitHandleProps) {
  const { isDragging, separatorProps } = useSplitResize({
    containerRef,
    calendarRef,
    planningRef,
    storedSplit,
    disabled,
    onSplitChange,
    onCollapse,
  });

  return (
    <div
      {...separatorProps}
      className={cn(
        // Air pass: a faint rest-state line that only strengthens on intent
        // (hover/drag tints below) — `line-strong` at rest was one of the two
        // loudest rules on the board.
        "relative z-20 h-1.5 shrink-0 touch-none border-b border-line-faint",
        // Same trade as RailHandle: `touch-none` stays (a genuine drag
        // surface), the hit area grows on a coarse pointer via `::after`
        // instead of the visible 6px bar itself.
        "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
        disabled ? "cursor-default" : "cursor-row-resize",
        "transition-colors hover:bg-primary/40 focus-visible:bg-primary/60",
        "focus-visible:outline-none",
        isDragging && "bg-primary/60",
      )}
    />
  );
}
