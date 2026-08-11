"use client";

import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import {
  SPLIT_COLLAPSE_THRESHOLD,
  SPLIT_DEFAULT,
  SPLIT_MAX_PERCENT,
  SPLIT_MIN,
  SPLIT_MIN_PERCENT,
  SPLIT_NUDGE,
} from "@/lib/split";

/**
 * Pure split math for the seam between the calendar and planning halves,
 * exported separately so it is testable without a DOM — mirrors
 * `use-rail-resize.ts`'s split between pure math and the DOM-wiring hook,
 * rotated 90°: a percent of the total height rather than a pixel width,
 * because unlike a rail (whose own width is the whole story) a half's size
 * only means anything relative to the OTHER half's, and that total changes
 * with the viewport.
 */

/** Percent the top (calendar) half gets, given its raw pixel height and the pair's total. */
export function clampSplit(topPx: number, totalPx: number): number {
  // A degenerate total (window too short for even one min-height half) has no
  // valid split to express — fall back to the default rather than divide by
  // a total that can't fit both floors.
  if (totalPx < SPLIT_MIN * 2) return SPLIT_DEFAULT;
  const minPercent = Math.max(SPLIT_MIN_PERCENT, (SPLIT_MIN / totalPx) * 100);
  const maxPercent = Math.min(SPLIT_MAX_PERCENT, 100 - (SPLIT_MIN / totalPx) * 100);
  const rawPercent = (topPx / totalPx) * 100;
  return Math.min(Math.max(rawPercent, minPercent), maxPercent);
}

/**
 * What a drag of `dy` pixels from `startTopPx` resolves to: a clamped
 * percent, or which half should collapse once the pointer has pushed either
 * side under `SPLIT_COLLAPSE_THRESHOLD` — the same VS Code gesture
 * `resolveDragWidth` uses for a rail.
 */
export function resolveDragSplit(
  startTopPx: number,
  dy: number,
  totalPx: number,
): number | "calendar" | "planning" {
  const rawTop = startTopPx + dy;
  const rawBottom = totalPx - rawTop;
  if (rawTop < SPLIT_COLLAPSE_THRESHOLD) return "calendar";
  if (rawBottom < SPLIT_COLLAPSE_THRESHOLD) return "planning";
  return clampSplit(rawTop, totalPx);
}

export function nudgeSplit(topPx: number, deltaPx: number, totalPx: number): number {
  return clampSplit(topPx + deltaPx, totalPx);
}

interface UseSplitResizeOptions {
  /**
   * The outer flex column carrying `--split-top` — written to directly on
   * every pointermove, same reasoning as `use-rail-resize.ts`'s panel write:
   * a per-frame React state update would re-render on every pixel of drag,
   * where a direct DOM write only needs to win until release commits it.
   */
  containerRef: RefObject<HTMLElement | null>;
  /** The two halves themselves — their rendered heights sum to the resizable total. */
  calendarRef: RefObject<HTMLElement | null>;
  planningRef: RefObject<HTMLElement | null>;
  storedSplit: number | null;
  /** Suspended during a card/column drag, same reason as a rail's `disabled`. */
  disabled?: boolean;
  /** Committed once on release/keypress/double-click, never per pointermove. */
  onSplitChange: (percent: number | null) => void;
  onCollapse: (half: "calendar" | "planning") => void;
}

interface UseSplitResizeResult {
  isDragging: boolean;
  separatorProps: {
    role: "separator";
    "aria-orientation": "horizontal";
    "aria-label": string;
    tabIndex: number;
    "aria-valuenow": number;
    "aria-valuemin": number;
    "aria-valuemax": number;
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
    onDoubleClick: () => void;
  };
}

export function useSplitResize({
  containerRef,
  calendarRef,
  planningRef,
  storedSplit,
  disabled,
  onSplitChange,
  onCollapse,
}: UseSplitResizeOptions): UseSplitResizeResult {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startY: number;
    startTopPx: number;
    totalPx: number;
    result: number | "calendar" | "planning";
  } | null>(null);

  const measure = useCallback(() => {
    const topPx = calendarRef.current?.getBoundingClientRect().height ?? 0;
    const bottomPx = planningRef.current?.getBoundingClientRect().height ?? 0;
    return { topPx, totalPx: topPx + bottomPx };
  }, [calendarRef, planningRef]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const { topPx, totalPx } = measure();
      dragRef.current = { startY: e.clientY, startTopPx: topPx, totalPx, result: topPx };
      setIsDragging(true);
    },
    [disabled, measure],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const result = resolveDragSplit(drag.startTopPx, e.clientY - drag.startY, drag.totalPx);
      drag.result = result;
      // Frozen at the clamped edge past either collapse threshold rather than
      // shrinking further — same reasoning as use-rail-resize.ts: the real
      // collapsed rendering takes over once the drop commits it, so previewing
      // past this point would only preview a half that no longer fits its body.
      const preview =
        result === "calendar"
          ? clampSplit(0, drag.totalPx)
          : result === "planning"
            ? clampSplit(drag.totalPx, drag.totalPx)
            : result;
      container.style.setProperty("--split-top", String(preview));
    },
    [containerRef],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
      setIsDragging(false);
      containerRef.current?.style.removeProperty("--split-top");
      if (drag.result === "calendar" || drag.result === "planning") {
        onCollapse(drag.result);
      } else if (drag.result !== drag.startTopPx) {
        onSplitChange(drag.result);
      }
    },
    [containerRef, onCollapse, onSplitChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const { topPx, totalPx } = measure();
        onSplitChange(nudgeSplit(topPx, -SPLIT_NUDGE, totalPx));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const { topPx, totalPx } = measure();
        onSplitChange(nudgeSplit(topPx, SPLIT_NUDGE, totalPx));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const { topPx, totalPx } = measure();
        onCollapse(topPx <= totalPx - topPx ? "calendar" : "planning");
      }
    },
    [disabled, measure, onSplitChange, onCollapse],
  );

  const onDoubleClick = useCallback(() => {
    if (!disabled) onSplitChange(null);
  }, [disabled, onSplitChange]);

  return {
    isDragging,
    separatorProps: {
      role: "separator",
      "aria-orientation": "horizontal",
      "aria-label": "Resize the calendar and list panes",
      tabIndex: disabled ? -1 : 0,
      // storedSplit only, not measure(): reading a ref during render is a
      // lint error (react-hooks/refs) and unnecessary — SPLIT_DEFAULT is the
      // exact value the CSS falls back to.
      "aria-valuenow": Math.round(storedSplit ?? SPLIT_DEFAULT),
      "aria-valuemin": SPLIT_MIN_PERCENT,
      "aria-valuemax": SPLIT_MAX_PERCENT,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
      onDoubleClick,
    },
  };
}
