import type { KeyAction } from "./overdrive";

/**
 * Swipe-gesture geometry for Overdrive's card (EI-104), phone layout only —
 * see `docs/OVERDRIVE.md` §10 and `docs/MOBILE.md`. Pure direction/progress
 * math lives here, with no DOM at all, matching this module's own convention
 * (`docs/KEYBOARD.md` §9) of keeping decision logic testable without
 * mounting anything. `overdrive-overlay.tsx` owns the pointer listeners and
 * the actual drag-visual state; this file only answers "given this drag,
 * which way is it going, how far along is it, and what action does that map
 * to."
 */

export type SwipeDirection = "left" | "right" | "up" | "down";

/**
 * Minimum travel, in px, before a drag commits to an axis at all — screens
 * out a tap or a jittery finger from reading as a swipe in either direction.
 * Once a direction locks (see `resolveSwipeDirection`), a caller should keep
 * passing that same direction back in rather than re-resolving it, so a drag
 * that starts diagonally can't flip from one verdict to another mid-gesture.
 */
export const SWIPE_AXIS_LOCK_PX = 12;

/**
 * Travel, in px, a locked drag needs before release fires the mapped action.
 * A fixed pixel value rather than a fraction of the card's width — the same
 * gesture should feel identical on an iPhone SE and a larger phone, and a
 * width-relative threshold would make the exact same finger motion commit on
 * one and fall short on the other.
 */
export const SWIPE_COMMIT_PX = 96;

/**
 * Which `KeyAction` (`lib/overdrive.ts`) each swipe direction fires — the
 * same four verdicts the keyboard and the on-screen buttons already drive,
 * dispatched through the identical `reduce()` case no matter which input
 * method produced it (docs/OVERDRIVE.md §3a's rule, extended to touch: a
 * swipe is never a fifth, divergent input path). `right` maps to `"ramp"`,
 * not a commit — swipe-right stages a day exactly like `→` does and needs
 * its own separate confirm tap; per the ticket note, it is deliberately not
 * symmetrical with the other three.
 */
export const SWIPE_ACTION: Record<SwipeDirection, KeyAction> = {
  left: "wontDo",
  up: "done",
  down: "toList",
  right: "ramp",
};

/**
 * Resolves the direction a drag has committed to, or `null` while it's still
 * inside the `SWIPE_AXIS_LOCK_PX` deadzone. Whichever axis has travelled
 * farther at the moment it first clears the deadzone wins.
 */
export function resolveSwipeDirection(dx: number, dy: number): SwipeDirection | null {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (Math.max(adx, ady) < SWIPE_AXIS_LOCK_PX) return null;
  if (adx > ady) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/**
 * 0–1 progress toward `SWIPE_COMMIT_PX`, measured along whichever axis
 * `direction` locked to (the other axis's travel is ignored once locked).
 * Drives the drag's visual feedback — translate distance, indicator opacity
 * — and is also what release checks against `1` to decide whether the
 * gesture commits.
 */
export function swipeProgress(dx: number, dy: number, direction: SwipeDirection): number {
  const distance = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
  return Math.min(distance / SWIPE_COMMIT_PX, 1);
}
