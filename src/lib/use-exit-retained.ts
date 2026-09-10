"use client";

import { useState } from "react";

/**
 * Keeps an overlay's content alive for as long as it takes to animate out.
 *
 * The pattern this replaces is everywhere in the board:
 *
 *     if (!todo) return null;
 *     return <Sheet open>…</Sheet>
 *
 * which cannot animate closed, because closing is not a state it passes
 * through — the parent stops passing a `todo`, this returns `null`, and the
 * whole subtree leaves the React tree in the same commit. Base UI never gets
 * to mark the popup `data-closed`, so no exit animation is ever started. The
 * overlay does not fade or slide; it ceases to exist. Measured: the popup
 * unmounts ~30ms after the close, with zero `animationstart` events.
 *
 * Overlays that already pass a real boolean (`<Sheet open={open}>`) animate
 * out correctly today and do not need this.
 *
 * So: hold the last value, and report `open` separately.
 *
 *     const { value: todo, open } = useExitRetained(props.todo);
 *     if (!todo) return null;            // never opened yet
 *     return <Sheet open={open}>…</Sheet>
 *
 * While closing, `open` is false and `value` is still the outgoing todo, so
 * the sheet has something to render on its way out. Base UI unmounts the
 * popup itself once the animation finishes.
 *
 * Derived during render rather than in an effect: an effect would land a frame
 * late, and the outgoing value is needed by the very render that is closing.
 *
 * The store is `useState` with a render-phase `set`, not a ref. React supports
 * exactly this for "adjust state when a prop changes" — it re-renders
 * immediately, before committing, so nothing is painted from the stale value.
 * A ref would be the obvious shape and is not allowed here: React Compiler's
 * `react-hooks/refs` rule fails a ref that is written or read during render,
 * and it is on for everything outside `src/components/scene/`.
 */
export function useExitRetained<T>(value: T | null | undefined): {
  /** The current value, or the outgoing one while the overlay animates away. */
  value: T | null;
  /** Whether the overlay should be open. False during the exit. */
  open: boolean;
} {
  const [retained, setRetained] = useState<T | null>(value ?? null);
  if (value != null && value !== retained) {
    setRetained(value);
  }
  return { value: value ?? retained, open: value != null };
}
