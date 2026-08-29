/**
 * "GOOD JOB" mode — a confetti burst at the point of a completion.
 *
 * ## Why a dependency here, when `drop-animation.ts` is hand-written
 *
 * The drop animation is hand-written because it is entangled with app
 * semantics: dnd-kit's `DropAnimationFunction` dictates its shape, and it has
 * to measure a real landing rect to know where the card is flying to.
 * Overdrive's flick is Tailwind classes because the DIRECTION encodes a
 * verdict. Neither could have been a library.
 *
 * Confetti is entangled with nothing. It is decoration with no domain logic to
 * keep honest, and hand-rolling it would mean owning DPR scaling, resize,
 * canvas lifecycle, rAF teardown and particle physics — well over a hundred
 * lines, for a feature that is off by default.
 *
 * So: `canvas-confetti`, and **this file is its only importer**. Everything
 * else in the app calls `celebrate()`. Swapping the library out later, or
 * replacing it with hand-written canvas, is a one-file change.
 *
 * ## Three things that are load-bearing
 *
 * 1. **Six-digit hex only.** `canvas-confetti` parses colors with
 *    `/^#?([a-f\d]{2}){3}$/`. The tint ladder in `lib/colors.ts` produces
 *    EIGHT-digit hex (`#e54d2e20`) — `tint()`/`edge()`/`wash()` here would
 *    throw, not degrade. Hence the local `mix()` below, which lightens and
 *    darkens by blending in RGB space and stays six digits. `confettiPalette`
 *    has a test asserting every value it returns passes `isTintableColor`,
 *    precisely so that reaching for `tint()` fails loudly.
 *
 * 2. **The default `zIndex: 100` is already right, so it is not set.** Every
 *    overlay in `components/ui/*` sits at `z-50`; the app has no higher layer.
 *    Confetti therefore paints over the to-do sheet, the ⌘K palette and the
 *    Overdrive scrim — which is what "from the thing you just clicked" needs,
 *    since three of the five entry points are inside one of those.
 *
 * 3. **`disableForReducedMotion` rather than a fourth `prefersReducedMotion`.**
 *    The library reads the media query itself. Three local copies of that
 *    helper already exist (`drop-animation.ts`, `overdrive-overlay.tsx`,
 *    `use-day-track.ts`); this adds no fourth.
 */

import { isTintableColor } from "./colors";

/** A normalised viewport position: `0..1` on each axis, as canvas-confetti wants. */
export interface ConfettiOrigin {
  x: number;
  y: number;
}

/**
 * Where on screen an element is, normalised — or `null` if it is not anywhere
 * useful.
 *
 * Measured SYNCHRONOUSLY by the caller, at the moment of the click or
 * keystroke, because the completion is about to remove the card from the board
 * entirely (`buildBoard` keeps only `open`). By the time an effect ran, there
 * would be nothing left to measure.
 *
 * The three `null` cases are all real, not defensive padding:
 * - **no element** — a sub-task row that was never rendered, a ref that has not
 *   attached yet;
 * - **a zero-area rect** — a `display: none` ancestor, or a happy-dom test
 *   where `getBoundingClientRect` returns all zeros;
 * - **entirely off-viewport** — the card is scrolled out of its column, and
 *   confetti from a screen edge is worse than none.
 */
export function originOf(el: Element | null | undefined): ConfettiOrigin | null {
  if (!el || typeof window === "undefined") return null;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 0 || vh <= 0) return null;

  // Wholly outside the viewport. A rect straddling an edge is fine — the burst
  // reads as coming from off-screen, which is honest about where it happened.
  if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return null;

  return { x: (rect.left + rect.width / 2) / vw, y: (rect.top + rect.height / 2) / vh };
}

/** Neutral confetti, for a to-do that legitimately has no color. */
const NEUTRAL_PALETTE: readonly string[] = ["#8b8d98", "#b9bbc6", "#6f7178"];

/** How far `confettiPalette` lightens and darkens the base color, 0..1. */
const LIGHTEN = 0.35;
const DARKEN = 0.25;

/** `#rrggbb` → `[r, g, b]`. Only ever called behind an `isTintableColor` guard. */
function parseHex(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Blend a color toward white or black by `amount`, staying six-digit hex.
 *
 * Naive RGB interpolation, not a perceptual space, and that is fine here: the
 * output is 8px paper triangles in motion, where a couple of points of
 * lightness error is invisible. Anything more would be machinery for nothing.
 */
function mix(hex: string, toward: 0 | 255, amount: number): string {
  const channels = parseHex(hex).map((c) => Math.round(c + (toward - c) * amount));
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Three shades of the to-do's own color, so the burst has depth rather than
 * reading as a single flat swatch.
 *
 * Falls back to neutral rather than to a house color: a Backlog or unfiled
 * to-do has no color, that is a real answer (`effectiveListColor`), and
 * inventing one would tell the user their to-do lives somewhere it does not.
 */
export function confettiPalette(color: string | null | undefined): string[] {
  if (!isTintableColor(color)) return [...NEUTRAL_PALETTE];
  return [color, mix(color, 255, LIGHTEN), mix(color, 0, DARKEN)];
}

/**
 * Two shots, angled apart — the shape the burst actually needs.
 *
 * A single `angle: 90` is a fountain: everything goes straight up and rains
 * back down through itself. Firing 60° and 120° from the same origin reads as
 * a spark bursting UP AND OUT to both sides, which is the whole brief.
 *
 * `ticks: 90` (against a default of 200) keeps it under a second — this fires
 * on the most-repeated action in the app, so it has to be over before it can
 * become tiresome. `scalar: 0.8` shrinks the paper for the same reason.
 */
const SHOTS = [
  { angle: 60, spread: 55 },
  { angle: 120, spread: 55 },
] as const;

const SHARED_SHOT_OPTIONS = {
  particleCount: 18,
  startVelocity: 38,
  decay: 0.9,
  gravity: 1.1,
  ticks: 90,
  scalar: 0.8,
  disableForReducedMotion: true,
} as const;

/**
 * Fire the burst. A no-op without an origin, and off the main path entirely:
 * the import is lazy, so the ~6KB library only ever downloads for a user who
 * turned GOOD JOB mode on and then finished something.
 *
 * Fire-and-forget by design — nothing waits on confetti, and a failed chunk
 * load must not break the completion that triggered it. Same convention as the
 * status writes in `use-board-actions.ts`, which are also `void`ed.
 */
export async function celebrate(
  origin: ConfettiOrigin | null | undefined,
  color: string | null | undefined,
): Promise<void> {
  if (!origin || typeof window === "undefined") return;

  const colors = confettiPalette(color);

  try {
    const confetti = (await import("canvas-confetti")).default;
    for (const shot of SHOTS) {
      void confetti({ ...SHARED_SHOT_OPTIONS, ...shot, origin, colors });
    }
  } catch {
    // A decoration is never worth a thrown error. The only realistic cause is
    // a chunk that failed to load offline — in which case the completion
    // itself still happened, which is the part that matters.
  }
}
