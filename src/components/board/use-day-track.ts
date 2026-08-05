"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/**
 * Pure scroll math for the day track, exported separately so it is testable
 * without a DOM — see use-day-track.test.ts.
 *
 * All day columns are the same width by construction (BoardColumn gives every
 * unpinned day column the same `min-w`/`max-w`), so "which day sits at the
 * left edge" is exact integer division, not a measurement of any one column.
 */

/** The index of the day column currently at the track's left edge. */
export function computeAnchorIndex(scrollLeft: number, pitch: number): number {
  if (pitch <= 0) return 0;
  return Math.round(scrollLeft / pitch);
}

/** How many day columns fit in the visible track width. */
export function computeVisibleCount(trackWidth: number, pitch: number): number {
  if (pitch <= 0) return 1;
  return Math.max(1, Math.round(trackWidth / pitch));
}

/** Where a jump of `delta` days from `anchorIndex` lands, clamped to `[0, cap - 1]`. */
export function clampJumpTarget(anchorIndex: number, delta: number, cap: number): number {
  return Math.min(Math.max(anchorIndex + delta, 0), Math.max(cap - 1, 0));
}

/** True when a `delta`-day jump backward would land at or after day 0. */
export function canJumpBack(anchorIndex: number, delta: number): boolean {
  return anchorIndex >= delta;
}

/** True when a `delta`-day jump forward stays inside the cap. */
export function canJumpForward(anchorIndex: number, delta: number, cap: number): boolean {
  return anchorIndex + delta < cap;
}

/**
 * `smooth` reads as an affordance for a short hop; gliding a 90-column jump
 * would take seconds and read as broken rather than smooth. Always `auto`
 * under reduced motion.
 */
function scrollBehaviorFor(distanceDays: number): ScrollBehavior {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return "auto";
  }
  return Math.abs(distanceDays) <= 14 ? "smooth" : "auto";
}

interface UseDayTrackOptions {
  trackRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Ceiling for `jumpBy`/`canJumpForward` (the Week/Month/Quarter buttons) —
   * NOT a hard limit on the track as a whole. `jumpToIndex` deliberately
   * ignores it: a date-picker pick past the current ceiling should grow the
   * ceiling to reach it, not be refused, so the caller is expected to raise
   * `cap` itself in `onExtend` when that happens (see board.tsx).
   */
  cap: number;
  /**
   * Called before scrolling to a target past what is currently rendered, so
   * the column exists to scroll to. Safe to call with a value at or below the
   * current horizon — the caller is expected to clamp, not this hook.
   */
  onExtend: (days: number) => void;
}

interface UseDayTrackResult {
  /** Index of the day column at the track's left edge (0 = today). */
  anchorIndex: number;
  /** How many day columns currently fit in the track's visible width. */
  visibleCount: number;
  canJumpBack: (delta: number) => boolean;
  canJumpForward: (delta: number) => boolean;
  /** Scrolls so the day `delta` days from the anchor sits at the left edge, clamped to `cap`. */
  jumpBy: (delta: number) => void;
  /**
   * Scrolls so day `target` (an absolute index, floored at 0) sits at the
   * left edge. Deliberately UNCLAMPED by `cap` — this is how a date picker
   * reaches a day arbitrarily far out; `onExtend` is expected to raise `cap`
   * to match rather than have this silently refuse the jump.
   */
  jumpToIndex: (target: number) => void;
  jumpToToday: () => void;
}

export function useDayTrack({ trackRef, cap, onExtend }: UseDayTrackOptions): UseDayTrackResult {
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(1);
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);

  const measurePitch = useCallback(() => {
    const track = trackRef.current;
    const first = track?.firstElementChild as HTMLElement | null | undefined;
    if (!track || !first) return 0;
    const gap = parseFloat(getComputedStyle(track).columnGap || "0");
    return first.getBoundingClientRect().width + gap;
  }, [trackRef]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const pitch = measurePitch();
        if (pitch > 0) setAnchorIndex(computeAnchorIndex(track.scrollLeft, pitch));
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [trackRef, measurePitch]);

  /** Recomputes `visibleCount` whenever the track's own width changes. */
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const pitch = measurePitch();
      if (pitch > 0) setVisibleCount(computeVisibleCount(track.clientWidth, pitch));
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [trackRef, measurePitch]);

  /**
   * Runs after every commit that sets a pending target — including one where
   * `onExtend` grew the rendered day count in the SAME commit (both state
   * updates are queued from the same click handler and batch together), so
   * the pitch below is measured against the final column widths, not the
   * pre-extension ones. Measuring inside `jumpBy` itself would read stale
   * widths whenever growing the horizon flips columns from flex-filled to
   * min-width.
   */
  useLayoutEffect(() => {
    if (pendingTarget === null) return;
    const track = trackRef.current;
    const pitch = measurePitch();
    if (track && pitch > 0) {
      track.scrollTo({
        left: pendingTarget * pitch,
        behavior: scrollBehaviorFor(pendingTarget - anchorIndex),
      });
    }
    setPendingTarget(null);
    // `anchorIndex` deliberately excluded: it changes as a RESULT of this
    // scroll (via the scroll listener above), which would re-fire this effect
    // and scroll again to the same place. Only a new `pendingTarget` should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget, trackRef, measurePitch]);

  /**
   * The one place that actually moves the track: floors at day 0, extends the
   * rendered horizon (and, per `onExtend`'s contract above, `cap` itself if
   * needed) so the target exists to scroll to, then hands off to the layout
   * effect above once that extension has landed.
   */
  const jumpToIndex = useCallback(
    (target: number) => {
      const clamped = Math.max(target, 0);
      onExtend(clamped + 1);
      setPendingTarget(clamped);
    },
    [onExtend],
  );

  const jumpBy = useCallback(
    (delta: number) => jumpToIndex(clampJumpTarget(anchorIndex, delta, cap)),
    [anchorIndex, cap, jumpToIndex],
  );

  const jumpToToday = useCallback(() => jumpToIndex(0), [jumpToIndex]);

  return {
    anchorIndex,
    visibleCount,
    canJumpBack: (delta: number) => canJumpBack(anchorIndex, delta),
    canJumpForward: (delta: number) => canJumpForward(anchorIndex, delta, cap),
    jumpBy,
    jumpToIndex,
    jumpToToday,
  };
}
