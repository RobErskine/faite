"use client";

import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import {
  RAIL_COLLAPSE_THRESHOLD,
  RAIL_DEFAULT_WIDTH,
  RAIL_MAX,
  RAIL_MIN,
  RAIL_NUDGE,
} from "@/lib/rail";

/**
 * Pure width math for a rail's resize handle, exported separately so it is
 * testable without a DOM — see use-rail-resize.test.ts. Mirrors
 * use-day-track.ts's split between pure scroll math and the DOM-wiring hook.
 */

export function clampRailWidth(width: number): number {
  return Math.min(Math.max(width, RAIL_MIN), RAIL_MAX);
}

/**
 * What a drag of `dx` pixels from `startWidth` resolves to: a clamped width,
 * or `null` once the pointer has crossed into collapse territory — the VS
 * Code gesture, so collapsing needs no separate affordance to discover.
 */
export function resolveDragWidth(startWidth: number, dx: number): number | null {
  const raw = startWidth + dx;
  if (raw < RAIL_COLLAPSE_THRESHOLD) return null;
  return clampRailWidth(raw);
}

export function nudgeRailWidth(current: number, delta: number): number {
  return clampRailWidth(current + delta);
}

interface UseRailResizeOptions {
  /**
   * The panel div carrying `--column-min` — written to directly on every
   * pointermove, same reasoning as `use-day-track.ts`'s `track.scrollTo`:
   * putting a per-frame value in React state would re-render on every pixel
   * of drag, where a direct DOM write costs nothing and only needs to win
   * until the committed value replaces it on release.
   *
   * NOT what gets measured for a first-ever drag, though: the panel's own
   * rendered width includes its `px-4` padding on top of `--column-min`, so
   * reading it directly would overshoot the true column width by ~32px.
   * `measuredWidth` below reads the pinned `BoardColumn` section itself (the
   * panel's only element child) instead.
   */
  panelRef: RefObject<HTMLElement | null>;
  storedWidth: number | null;
  /**
   * Suspended during a card/column drag — dnd-kit caches every droppable's
   * rect at drag start, and resizing mid-drag would invalidate all of them.
   */
  disabled?: boolean;
  /** Committed once on release/keypress/double-click, never per pointermove. */
  onWidthChange: (width: number | null) => void;
  onCollapsedChange: (collapsed: boolean) => void;
}

interface UseRailResizeResult {
  /** For the handle's own hover/active styling only — not the panel's width. */
  isDragging: boolean;
  separatorProps: {
    role: "separator";
    "aria-orientation": "vertical";
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

/** One instance per rail — Overflow and Backlog resize independently. */
export function useRailResize(
  label: string,
  { panelRef, storedWidth, disabled, onWidthChange, onCollapsedChange }: UseRailResizeOptions,
): UseRailResizeResult {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; result: number | null } | null>(
    null,
  );

  const measuredWidth = useCallback(() => {
    if (storedWidth != null) return storedWidth;
    const column = panelRef.current?.querySelector<HTMLElement>(":scope > section");
    return column?.getBoundingClientRect().width ?? RAIL_MIN;
  }, [storedWidth, panelRef]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const startWidth = measuredWidth();
      dragRef.current = { startX: e.clientX, startWidth, result: startWidth };
      setIsDragging(true);
    },
    [disabled, measuredWidth],
  );

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    const result = resolveDragWidth(drag.startWidth, e.clientX - drag.startX);
    drag.result = result;
    // Frozen at RAIL_MIN past the collapse threshold rather than shrinking
    // further: BoardColumn's ordinary (non-collapsed) body does not fit a
    // narrower panel, so previewing past this point would preview breakage.
    // The real collapsed rendering takes over once the drop commits it.
    panel.style.setProperty("--column-min", `${result ?? RAIL_MIN}px`);
  }, [panelRef]);

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
      setIsDragging(false);
      panelRef.current?.style.removeProperty("--column-min");
      if (drag.result === null) {
        onCollapsedChange(true);
      } else if (drag.result !== drag.startWidth) {
        onWidthChange(drag.result);
      }
    },
    [panelRef, onCollapsedChange, onWidthChange],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onWidthChange(nudgeRailWidth(measuredWidth(), -RAIL_NUDGE));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onWidthChange(nudgeRailWidth(measuredWidth(), RAIL_NUDGE));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onCollapsedChange(true);
      }
    },
    [disabled, measuredWidth, onWidthChange, onCollapsedChange],
  );

  const onDoubleClick = useCallback(() => {
    if (!disabled) onWidthChange(null);
  }, [disabled, onWidthChange]);

  return {
    isDragging,
    separatorProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": `Resize the ${label} column`,
      tabIndex: disabled ? -1 : 0,
      // storedWidth only, not measuredWidth(): reading panelRef.current
      // during render is a lint error (react-hooks/refs) and unnecessary
      // here — RAIL_DEFAULT_WIDTH is the exact value the CSS falls back to.
      "aria-valuenow": Math.round(storedWidth ?? RAIL_DEFAULT_WIDTH),
      "aria-valuemin": RAIL_MIN,
      "aria-valuemax": RAIL_MAX,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown,
      onDoubleClick,
    },
  };
}
