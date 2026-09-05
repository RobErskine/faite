"use client";

import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { useRailResize } from "./use-rail-resize";

interface RailHandleProps {
  label: string;
  panelRef: RefObject<HTMLElement | null>;
  storedWidth: number | null;
  disabled?: boolean;
  onWidthChange: (width: number | null) => void;
  onCollapsedChange: (collapsed: boolean) => void;
}

/**
 * The draggable seam on a pinned panel's right edge — one per rail (Overflow,
 * Backlog), each resizing independently. Not rendered while its rail is
 * collapsed: `BoardColumn`'s collapsed strip is itself the affordance back
 * to expanded (click anywhere on it), so there is nothing here to grab.
 */
export function RailHandle({
  label,
  panelRef,
  storedWidth,
  disabled,
  onWidthChange,
  onCollapsedChange,
}: RailHandleProps) {
  const { isDragging, separatorProps } = useRailResize(label, {
    panelRef,
    storedWidth,
    disabled,
    onWidthChange,
    onCollapsedChange,
  });

  return (
    <div
      {...separatorProps}
      className={cn(
        "absolute inset-y-0 right-0 z-20 w-1.5 translate-x-1/2 touch-none",
        // A genuine drag surface, unlike DragGrip — `touch-none` stays; the
        // hit area grows on a coarse pointer via `::after` instead, keeping
        // the 6px visual paint exactly as designed for a mouse. `absolute`
        // on the parent already establishes its own containing block, so
        // the pseudo-element positions relative to this div without an
        // explicit `relative`.
        "pointer-coarse:after:absolute pointer-coarse:after:inset-y-0 pointer-coarse:after:-inset-x-2.5 pointer-coarse:after:content-['']",
        disabled ? "cursor-default" : "cursor-col-resize",
        // A faint line at rest, same treatment as split-handle.tsx — this was
        // fully invisible until hover, which is what made the resize edge
        // hard to find in the first place.
        "border-r border-line-faint transition-colors hover:bg-primary/40 focus-visible:bg-primary/60",
        "focus-visible:outline-none",
        isDragging && "bg-primary/60",
      )}
    />
  );
}
