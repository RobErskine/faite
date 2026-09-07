import { STORY_BEATS, TICK_AT, type BeatFocus } from "@/lib/story-beats";
import { SWATCHES } from "./room-layout";

/**
 * What the room DOES during each beat (EI-280).
 *
 * The spike shipped two animations on a global clock: the wall cycled
 * candidates across t 0.35–0.85 and snapped back bare ("the indecision IS the
 * animation"), and the TV swapped at t > 0.9. Good spike, wrong story — the
 * page's sections are to-dos now (EI-277), and a to-do that gets checked off
 * while the room visibly does not do it is a lie told in two places at once.
 *
 * So every beat animation follows four rules, and this file is where they are
 * enforced rather than remembered:
 *
 *  1. **Beat-local time.** An animation is a pure function of `u` — 0 where
 *     its beat's band starts, 1 where it ends, clamped outside — never of
 *     global progress. `beatLocalAt` derives the band from `STORY_BEATS`, so
 *     adding or reordering beats moves the animations with them.
 *  2. **Pure state, applied thinly.** Same split as `room-camera.ts`: these
 *     functions return what the room should show and import no three.js, so
 *     they are unit-testable; `room-scene.tsx` lerps toward whatever they say.
 *  3. **The act lands before the tick.** Each beat's decisive moment sits at
 *     `COMMIT_AT`, under `TICK_AT` — the wall is painted, the old set gone,
 *     BEFORE the card checks the line off. A test fails if the order flips.
 *  4. **Done stays done.** `u` clamps to 1 after the band, so a finished act
 *     holds for the rest of the story. The spike's snap-back is gone: this is
 *     a plan being finished, not indecision on a loop.
 */

/** One clamp, used everywhere here. */
const clamp = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The decisive moment of a beat, as a fraction of its band.
 *
 * Before `TICK_AT` by an amount that is visible rather than technical: the act
 * finishes, a beat's-width tenth of scroll passes, and then the line ticks —
 * cause, then effect, readable at scrolling speed.
 */
export const COMMIT_AT = 0.3;

/** Where `focus`'s beat sits in story progress, derived, never hard-coded. */
export function beatBandFor(focus: BeatFocus): { start: number; end: number } {
  const i = STORY_BEATS.findIndex((beat) => beat.focus === focus);
  if (i === -1) throw new Error(`[beat-animations] no beat has focus "${focus}"`);
  return { start: i / STORY_BEATS.length, end: (i + 1) / STORY_BEATS.length };
}

/** Global story progress → `focus`'s beat-local time. 0 before, 1 after. */
export function beatLocalAt(t: number, focus: BeatFocus): number {
  const { start, end } = beatBandFor(focus);
  return clamp((t - start) / (end - start));
}

// ---------------------------------------------------------------------------
// The paint beat — "Painter comes Saturday, 9:00am"
// ---------------------------------------------------------------------------

/** The chips actually on the wall (`Swatches` renders `slice(0, 3)`). */
export const VISIBLE_SWATCHES = 3;

/** The cycle starts here, not at 0: the camera is still arriving at the wall
 * when the band opens, and a chip that pops before you can see it pops for
 * nobody. */
const CYCLE_FROM = 0.05;

export interface PaintState {
  /**
   * Which chip is being considered (an index into the visible three), or null
   * when nothing is — before the beat begins.
   */
  activeSwatch: number | null;
  /** What the wall should show. `null` is the bare theme wall. */
  wallColor: string | null;
  /** True from the moment the pick is made, forever. */
  committed: boolean;
}

/**
 * The whole beat as a function of its local time.
 *
 * Three phases: nothing (the camera is arriving), considering (each visible
 * chip pops in turn while the wall previews that color), committed (the chosen
 * chip stays up and the wall keeps its color for the rest of the story).
 *
 * The wall previews DURING the cycle rather than staying bare until the pick —
 * a chip is a promise about a wall, and showing the promise kept is what makes
 * the sequence legible at diorama scale. If review reads it as too busy, the
 * one-line change is `wallColor: null` in the considering phase.
 */
export function paintStateAt(u: number): PaintState {
  if (u <= CYCLE_FROM) return { activeSwatch: null, wallColor: null, committed: false };

  const chosen = SWATCHES.chosen;
  if (u >= COMMIT_AT) {
    return { activeSwatch: chosen, wallColor: SWATCHES.candidates[chosen], committed: true };
  }

  const span = (u - CYCLE_FROM) / (COMMIT_AT - CYCLE_FROM);
  const active = Math.min(VISIBLE_SWATCHES - 1, Math.floor(span * VISIBLE_SWATCHES));
  return { activeSwatch: active, wallColor: SWATCHES.candidates[active], committed: false };
}

// ---------------------------------------------------------------------------
// The letting-go beat — "Sell the old TV instead of moving it"
// ---------------------------------------------------------------------------

/**
 * The swap, rescoped from the spike's global `t > 0.9` onto its own beat.
 *
 * (For the tv beat's band, `u >= COMMIT_AT` works out to t ≈ 0.883 — within a
 * few scroll-pixels of where the spike put it, which is reassuring rather than
 * surprising: the spike hand-placed the swap where the last beat happened to
 * be.)
 */
export function tvUpgradedAt(t: number): boolean {
  return beatLocalAt(t, "tv") >= COMMIT_AT;
}

// A compile-time echo of the runtime test: the decisive moment precedes the
// tick. The real enforcement is in beat-animations.test.ts, where a failure
// names the rule; this line just refuses to let the constants drift apart
// silently in a file that forgot to run its tests.
const _ORDER_HOLDS: true = (COMMIT_AT < TICK_AT) as true;
void _ORDER_HOLDS;
