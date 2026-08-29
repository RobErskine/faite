"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Pure scroll math for the day track, exported separately so it is testable
 * without a DOM — see use-day-track.test.ts.
 *
 * All day columns are the same width by construction (BoardColumn gives every
 * unpinned day column the same `min-w`/`max-w`), so "which day sits at the
 * left edge" is exact integer division, not a measurement of any one column.
 *
 * KNOWN APPROXIMATION, and the reason `measurePitch` below hunts for a
 * `[data-day-column]` rather than taking the first child: with weekends
 * collapsed the track also holds 40px strips, and a row of mixed widths makes
 * `scrollLeft -> day index` genuinely nonlinear. Measuring a real day column
 * keeps the pitch honest, but a jump still lands within about one column
 * rather than exactly on it. Making it exact needs cumulative per-slot offsets
 * — deliberately deferred; every consumer of `anchorIndex` (the range label,
 * the jump buttons' availability, the off-screen check in use-column-nav)
 * degrades gracefully by one column, and none of them is destructive.
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
  /**
   * False while the calendar half is collapsed (see split-strip.tsx) — the
   * track has no layout to scroll yet. A `jumpToIndex` request made in that
   * state is not dropped: the layout effect below already bails without
   * recording the request's `seq` whenever `measurePitch` reads 0, precisely
   * so a later run can still serve it. What's missing without this flag is a
   * later RUN — a ref appearing when the caller expands the half is not
   * something React re-renders for on its own, so this flag is what gives
   * the effect a reason to check again once the track exists.
   */
  trackReady?: boolean;
  /**
   * How many non-day pages sit BEFORE index 0 in the DOM, so index 0 still
   * means "today" everywhere in this hook's public surface even though it
   * isn't the first scrollable child. `1` on the phone pager (P3,
   * `phone-board.tsx`): Overflow is spliced into the SAME scroll-snap track
   * as the day columns there (there's no "pinned sibling outside the track"
   * on phone the way there is on desktop — see `board.tsx`'s comment on why
   * Overflow is pinned there), so `scrollLeft` of 0 lands on Overflow, not
   * today. Applied at exactly the two points that translate between index
   * space and scroll space — `anchorIndex`'s derivation and `jumpToIndex`'s
   * actual `scrollTo` — so every other formula in this hook (`jumpBy`,
   * `canJumpBack`/`canJumpForward`, `jumpToToday`) stays written in terms of
   * "today is 0" and needs no changes. Defaults to 0, a no-op for every
   * existing desktop caller.
   */
  indexOffset?: number;
  /**
   * Changing this re-measures the track and re-anchors the current day to
   * the left edge.
   *
   * `visibleCount` is otherwise only recomputed by a `ResizeObserver` on the
   * TRACK (below) — which does not fire when a caller changes COLUMN width
   * (`desktop-board.tsx` sizing columns off `settings.visibleDays`) without
   * changing the track's own width. Pass a value that changes exactly when
   * that happens (`settings?.visibleDays` from the caller) so the range
   * label and jump buttons, which both read `visibleCount`, don't go stale.
   */
  pitchKey?: unknown;
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

/**
 * A queued jump, as a REQUEST rather than a value.
 *
 * `seq` is what makes two jumps to the same index two distinct events. The
 * earlier shape was a bare `number | null` that the layout effect cleared on its
 * way out, so that pressing Week-forward twice in a row saw a state change both
 * times — but clearing state from inside an effect is a cascading render, and the
 * `react-hooks/set-state-in-effect` rule is right to flag it. Carrying a sequence
 * instead means the effect only ever reads.
 */
interface JumpRequest {
  target: number;
  seq: number;
}

/**
 * Retries `setup(track)` on every animation frame until `trackRef.current`
 * is attached, runs it exactly once, and returns its cleanup.
 *
 * Every effect in this hook that touches the DOM needs this: a plain object
 * ref becoming non-null is NOT something a `useEffect` dependency array can
 * observe — ref identity never changes, only `.current` does, and React
 * deliberately does not re-run effects for that. `Board`'s loading gate
 * (`!data.ready || !ctx || !board || !settings`) means the element this hook
 * measures may not exist yet on the exact render where an effect's
 * dependency array first settles — true on any load slow enough to still
 * show "Loading your board…" at that moment, which turned out to be far
 * from a rare timing accident once `PhoneBoard` (P3) started exercising it.
 * Without this, the affected effect would attach nothing for the rest of
 * the component's life: not a delayed update, a permanently stale one.
 */
function whenTrackReady(
  trackRef: React.RefObject<HTMLDivElement | null>,
  setup: (track: HTMLDivElement) => (() => void) | void,
): () => void {
  let cancelled = false;
  let raf = 0;
  let cleanup: (() => void) | void;
  const attempt = () => {
    if (cancelled) return;
    const track = trackRef.current;
    if (!track) {
      raf = requestAnimationFrame(attempt);
      return;
    }
    cleanup = setup(track);
  };
  attempt();
  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    cleanup?.();
  };
}

export function useDayTrack({
  trackRef,
  cap,
  onExtend,
  trackReady = true,
  indexOffset = 0,
  pitchKey,
}: UseDayTrackOptions): UseDayTrackResult {
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(1);
  const [jump, setJump] = useState<JumpRequest | null>(null);
  /**
   * The last `seq` actually scrolled.
   *
   * Makes the effect idempotent per request, which matters because nothing clears
   * `jump` any more: without this, any future re-run of the effect for a reason
   * other than a new request — a changed `measurePitch` identity, say — would
   * silently re-scroll to a stale target. A ref, not state, so recording the work
   * does not itself schedule a render.
   */
  const handledSeq = useRef(0);

  const measurePitch = useCallback(() => {
    const track = trackRef.current;
    // A real day column, never merely the first child: that may be a collapsed
    // weekend strip, whose 40px would deflate the pitch and send every jump
    // several days short. Falls back to the first child so a track that has
    // only ever held uniform columns behaves exactly as it always did.
    const first = (track?.querySelector<HTMLElement>("[data-day-column]") ??
      track?.firstElementChild) as HTMLElement | null | undefined;
    if (!track || !first) return 0;
    /*
      `columnGap` computes to the keyword `normal` on a flex container with no
      gap, and `parseFloat("normal")` is NaN — which would poison the pitch and
      silently disable every jump button, since `pitch > 0` is false for NaN. The
      track carries `gap-px` today so this cannot fire, but the failure would be
      invisible and the cause three steps away from the symptom.
    */
    const gap = parseFloat(getComputedStyle(track).columnGap);
    return first.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
  }, [trackRef]);

  useEffect(() => {
    return whenTrackReady(trackRef, (track) => {
      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const pitch = measurePitch();
          if (pitch > 0) {
            setAnchorIndex(computeAnchorIndex(track.scrollLeft, pitch) - indexOffset);
          }
        });
      };
      track.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        track.removeEventListener("scroll", onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    });
  }, [trackRef, measurePitch, indexOffset]);

  /**
   * Recomputes `visibleCount` whenever the track's own width changes, OR
   * `pitchKey` changes — `ResizeObserver` fires once as soon as `observe` is
   * called, so re-running this effect (by re-observing) is enough to pick up
   * a column-width change that left the track's own width untouched.
   */
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    return whenTrackReady(trackRef, (track) => {
      const observer = new ResizeObserver(() => {
        const pitch = measurePitch();
        if (pitch > 0) setVisibleCount(computeVisibleCount(track.clientWidth, pitch));
      });
      observer.observe(track);
      return () => observer.disconnect();
    });
  }, [trackRef, measurePitch, pitchKey]);

  /**
   * Keeps the current day at the left edge when `pitchKey` changes.
   *
   * `scrollLeft` is untouched by a column-width change, but PITCH is — so
   * without this, switching from a 7-day to a 3-day view silently shifts
   * which day sits at the left edge. Skips the first run: on mount there is
   * no prior anchor to preserve. Reuses the `jump` request path rather than
   * calling `track.scrollTo` directly so reduced-motion and the `handledSeq`
   * idempotency guard above still apply.
   *
   * `anchorIndex` deliberately excluded from deps: it changes as a RESULT of
   * this jump too (via the scroll listener), which would re-fire this effect
   * right back at the value it just set. Only a `pitchKey` change should.
   */
  const skipNextPitchKeyAnchor = useRef(true);
  useLayoutEffect(() => {
    if (skipNextPitchKeyAnchor.current) {
      skipNextPitchKeyAnchor.current = false;
      return;
    }
    setJump((prev) => ({ target: anchorIndex, seq: (prev?.seq ?? 0) + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchKey]);

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
    if (!jump || jump.seq === handledSeq.current) return;
    const track = trackRef.current;
    const pitch = measurePitch();
    // Bail WITHOUT recording the seq: a pitch of 0 means the columns have not
    // been laid out yet, so this request has not been served and a later run
    // should still get to serve it.
    if (!track || pitch <= 0) return;

    handledSeq.current = jump.seq;
    track.scrollTo({
      left: (jump.target + indexOffset) * pitch,
      behavior: scrollBehaviorFor(jump.target - anchorIndex),
    });
    // `anchorIndex` deliberately excluded: it changes as a RESULT of this
    // scroll (via the scroll listener above), which would re-fire this effect
    // and scroll again to the same place. Only a new request should.
    // `trackReady` included though this branch never reads it: it flipping
    // true is exactly the "later run" the pitch<=0 bail above is waiting for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, trackRef, measurePitch, trackReady, indexOffset]);

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
      // Incremented from the previous request rather than from a counter in a
      // ref, so two jumps queued in one batch cannot collide on the same seq.
      setJump((prev) => ({ target: clamped, seq: (prev?.seq ?? 0) + 1 }));
    },
    [onExtend],
  );

  const jumpBy = useCallback(
    (delta: number) => jumpToIndex(clampJumpTarget(anchorIndex, delta, cap)),
    [anchorIndex, cap, jumpToIndex],
  );

  const jumpToToday = useCallback(() => jumpToIndex(0), [jumpToIndex]);

  /**
   * Initial alignment for a track with leading non-day pages. Without this,
   * the browser's natural `scrollLeft: 0` on first paint lands on whatever
   * sits before index 0 (Overflow, on the phone pager) while `anchorIndex`'s
   * own initial state (`useState(0)` above) already correctly means "today"
   * — state and the actual scroll position would disagree until the user's
   * first manual scroll.
   *
   * Deliberately a raw DOM `scrollTo`, not a `jumpToIndex(0)` call: that
   * would set `jump` state from inside an effect, exactly the cascading-
   * render pattern the `JumpRequest`/`seq` design a few lines up exists to
   * avoid (see that comment). `anchorIndex` needs no correcting alongside
   * it — it's already 0 by construction — so there is no React state to
   * update here at all, only the DOM to bring into agreement with it.
   *
   * A no-op for every desktop/tablet caller: they never pass a nonzero
   * `indexOffset`, so `scrollLeft: 0` and index 0 already agree.
   *
   * Uses `whenTrackReady` for the track itself, then polls a second time
   * inside it for the PITCH specifically — the track can exist before any
   * `[data-day-column]` child inside it has a measurable width.
   */
  useLayoutEffect(() => {
    if (indexOffset === 0) return;
    return whenTrackReady(trackRef, (track) => {
      let raf = 0;
      const tryAlign = () => {
        const pitch = measurePitch();
        if (pitch > 0) {
          track.scrollTo({ left: indexOffset * pitch, behavior: "auto" });
          return;
        }
        raf = requestAnimationFrame(tryAlign);
      };
      tryAlign();
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    });
    // Re-runs if `indexOffset` itself changes (a live resize across the
    // phone breakpoint mid-session), always re-aligning to today rather
    // than trying to preserve a scroll position whose meaning just changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexOffset]);

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
