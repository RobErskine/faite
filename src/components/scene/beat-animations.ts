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

/** Smoothstep. Eases both ends, so nothing in the room starts or stops abruptly. */
const smooth = (n: number) => {
  const x = clamp(n);
  return x * x * (3 - 2 * x);
};

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
  /**
   * How visible the sample cards are.
   *
   * They come down after the pick — a painted wall does not need chips taped
   * to it, and leaving them there was the difference between "we chose" and
   * "we are still choosing". Fades AFTER the line ticks, so the order reads
   * paint → done → tidy up.
   */
  swatchOpacity: number;
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
  if (u <= CYCLE_FROM) {
    return { activeSwatch: null, wallColor: null, committed: false, swatchOpacity: 1 };
  }

  const chosen = SWATCHES.chosen;
  if (u >= COMMIT_AT) {
    // 1 until the line ticks, then down to nothing over the following stretch.
    const swatchOpacity =
      1 - smooth((u - SWATCHES_LEAVE_FROM) / (SWATCHES_GONE_BY - SWATCHES_LEAVE_FROM));
    return {
      activeSwatch: chosen,
      wallColor: SWATCHES.candidates[chosen],
      committed: true,
      swatchOpacity,
    };
  }

  const span = (u - CYCLE_FROM) / (COMMIT_AT - CYCLE_FROM);
  const active = Math.min(VISIBLE_SWATCHES - 1, Math.floor(span * VISIBLE_SWATCHES));
  return {
    activeSwatch: active,
    wallColor: SWATCHES.candidates[active],
    committed: false,
    swatchOpacity: 1,
  };
}

/** After the pick, the sample cards come down: the task is done. */
const SWATCHES_LEAVE_FROM = 0.45;
const SWATCHES_GONE_BY = 0.6;

// ---------------------------------------------------------------------------
// The recurring beat — "Water the plants — every Wednesday"
// ---------------------------------------------------------------------------

export interface PlantState {
  /** 0 = healthy green, 1 = fully parched brown. Drives colour AND droop. */
  thirst: number;
  /** True from the watering onward. */
  watered: boolean;
  /**
   * How many times the card has rolled forward: 0 on Wednesday, 1 on
   * Thursday, 2 on Friday.
   *
   * This is the Faite Loop, acted out. A recurring to-do that does not get
   * done does not turn red and it does not vanish — it moves to the next day,
   * carrying a marker that says where it came from. Buehler et al. is the
   * citation for why that is the humane default (§2.4); this beat is where the
   * room shows it happening rather than the copy asserting it.
   */
  rolls: number;
  /** True on the third day: the card has crossed into Overflow. */
  inOverflow: boolean;
}

/** One roll per third of the run-up to the watering: Wed, Thu, Fri. */
const ROLLS_BEFORE_OVERFLOW = 2;

/**
 * Green → brown → green.
 *
 * The plant is already thirsty when you arrive and gets worse as you read,
 * peaking exactly when the watering happens — then it recovers over the rest
 * of the beat. A recurring to-do is the one thing in this room that is never
 * finished, so the beat is a round trip rather than a state change: the point
 * is that it will be brown again next Wednesday.
 *
 * Recovery is slower than the browning (0.3 → 0.8 of the band, against 0 →
 * 0.3) on purpose. Plants do not perk up instantly, and the asymmetry is what
 * stops the round trip reading as a flicker.
 */
export function plantStateAt(u: number): PlantState {
  const RECOVERED_BY = 0.8;

  /*
    After the watering the card is done, so it is not rolled and not in
    Overflow — the next occurrence is a fresh Wednesday. Resetting rather than
    leaving it at two is the whole point of a recurring to-do: it comes back
    clean, and it will be brown again next week.
  */
  const done = { rolls: 0, inOverflow: false };

  if (u <= 0) return { thirst: 0, watered: false, ...done };

  if (u < COMMIT_AT) {
    // Three equal days in the run-up. `min` rather than a wrapping modulo:
    // Friday is where it stops rolling and starts sitting in Overflow.
    const rolls = Math.min(ROLLS_BEFORE_OVERFLOW, Math.floor((u / COMMIT_AT) * 3));
    return {
      thirst: smooth(u / COMMIT_AT),
      watered: false,
      rolls,
      inOverflow: rolls >= ROLLS_BEFORE_OVERFLOW,
    };
  }

  if (u >= RECOVERED_BY) return { thirst: 0, watered: true, ...done };
  return {
    thirst: 1 - smooth((u - COMMIT_AT) / (RECOVERED_BY - COMMIT_AT)),
    watered: true,
    ...done,
  };
}

// ---------------------------------------------------------------------------
// The measuring beat — "Measure the room before ordering the couch"
// ---------------------------------------------------------------------------

/**
 * When a beat's PAYOFF lands, as opposed to its act.
 *
 * Rule 3 says the act comes before the tick, and that is still right for every
 * beat where the to-do IS the thing you watch happen: the wall gets painted,
 * the plant gets watered, the old set goes. This beat is the exception that
 * proves the rule rather than breaking it.
 *
 * "Measure the room before ordering the couch" is a to-do about measuring. The
 * couch is not the task — it is what the task earns, and it could not honestly
 * show up first. So the payoff sits ON the tick: you finish measuring, the line
 * checks off, and the thing you were measuring for arrives.
 *
 * Kept as its own named constant, with its own test asserting it is at or after
 * `TICK_AT`, so the asymmetry is a decision on the record instead of a number
 * that happens to be bigger than the other one.
 */
export const PAYOFF_AT = TICK_AT;

export interface CouchState {
  /**
   * Scale for the loveseat, 0 (not ordered) through a slight overshoot to 1.
   *
   * 0 rather than a hidden flag because the pop IS the scale: the scene reads
   * this straight onto the group and hides it below a threshold, so there is
   * one number to reason about instead of a number and a boolean that can
   * disagree.
   */
  loveseatScale: number;
  /** True from the delivery onward. Drives the contact shadow's opacity too. */
  delivered: boolean;
}

/** How much of the band the pop takes. Short — a delivery is an event. */
const POP_OVER = 0.18;

/**
 * The loveseat arrives.
 *
 * Nothing, then a pop with a little overshoot, then settled at its real size —
 * the beat of a box being opened rather than a fade, because furniture does not
 * fade into a room.
 *
 * The overshoot is why this returns a scale rather than a 0..1 progress: the
 * curve goes ABOVE 1 in the middle, and a caller that assumed a normalised
 * range would clamp exactly the frames that make it read as a pop.
 */
export function couchStateAt(u: number): CouchState {
  if (u < PAYOFF_AT) return { loveseatScale: 0, delivered: false };

  const p = clamp((u - PAYOFF_AT) / POP_OVER);
  return { loveseatScale: popIn(p), delivered: true };
}

/**
 * How far past its resting size a popping object travels. Shared by both
 * curves below, so a thing arriving and a thing leaving have the same accent.
 *
 * 2 peaks around 1.13. Enough to read as a thing landing; short of the cartoon
 * bounce that would make the room look like a toy.
 */
const BACK = 2;

/**
 * 0 → past 1 → settled at 1. The standard "back out" curve.
 *
 * The first attempt was `smoothstep(p) + sin(smoothstep(p)·π) · 0.12`, which
 * looks like an overshoot and provably is not: the bump is largest where the
 * base curve is small and vanishes as it reaches 1, so the sum rises
 * monotonically to exactly 1 and never above it. Its derivative
 * `1 + 0.12π·cos(mπ)` has no zero, which is the algebra saying the same thing.
 * The test caught it — "expected 1 to be greater than 1".
 */
export function popIn(p: number): number {
  const q = clamp(p) - 1;
  return 1 + (BACK + 1) * q * q * q + BACK * q * q;
}

/**
 * 1 → past 1 → 0. The pop, played backwards.
 *
 * Literally `popIn(1 - p)`, and written that way rather than as its own
 * polynomial because it IS that: expanding the "back in" form gives
 * `1 - 3p³ + 2p²`, and substituting `1 - p` into `popIn` gives `1 - 3p³ + 2p²`.
 * They are the same function. An earlier version of this comment claimed the
 * two differed — that one anticipated at the start and the other swelled
 * mid-shrink — which is simply false, and the test that disagreed with it was
 * right.
 *
 * So the exit reads as the arrival in reverse: the set swells a little as it
 * goes, then collapses. Squash and stretch, out instead of in.
 */
export function popOut(p: number): number {
  return popIn(1 - clamp(p));
}

// ---------------------------------------------------------------------------
// The ambivalence beat — "Decide which books are coming"
// ---------------------------------------------------------------------------

export interface ShelfState {
  /** How far the books are lifted off the shelf, in metres. */
  lift: number;
  /** Scale — 1 while they are still up there, 0 once the decision is made. */
  booksScale: number;
  /** True from the decision onward. */
  decided: boolean;
}

/** How many times the books are almost taken before they actually are. */
const HESITATIONS = 2;
/** How far a hesitation lifts them. Small: this is a hand reaching, not a move. */
const LIFT_MAX = 0.07;

/**
 * The books are picked up, put back, picked up, put back — and then go.
 *
 * This is the one beat where the ACT IS THE HESITATION, and that is not a
 * flourish, it is the finding. Emmons & King measured that people act least on
 * exactly the strivings they think about most, which is the item that rolls
 * three times and lands in Overflow (`docs/RESEARCH.md` §2.4). A shelf that
 * simply emptied would illustrate a decision; a shelf whose books keep almost
 * leaving illustrates the thing the study actually found.
 *
 * Then Faite's answer: Overflow forces the decision rather than letting the
 * item sit. So the hesitating stops and the books go, before the line ticks —
 * deciding is the to-do, so it is an act (rule 3), not a payoff.
 *
 * The cosine gives whole up-and-down cycles that start AND end at zero, so the
 * books are resting on the shelf at the moment they are finally taken. Starting
 * the departure mid-lift would read as fumbling rather than as choosing.
 */
export function shelfStateAt(u: number): ShelfState {
  if (u >= COMMIT_AT) return { lift: 0, booksScale: 0, decided: true };

  if (u >= DECIDE_FROM) {
    const p = (u - DECIDE_FROM) / (COMMIT_AT - DECIDE_FROM);
    return { lift: 0, booksScale: Math.max(0, popOut(p)), decided: false };
  }

  const phase = clamp(u / DECIDE_FROM);
  const lift = (LIFT_MAX * (1 - Math.cos(phase * 2 * Math.PI * HESITATIONS))) / 2;
  return { lift, booksScale: 1, decided: false };
}

/**
 * Where the hesitating stops and the books actually go.
 *
 * The departure has to FINISH by `COMMIT_AT`, not start there — the same shape
 * the old television uses. The first version ran it from `COMMIT_AT` over 0.16
 * of the band, and a test caught what that meant: `popOut` holds near 1 and
 * collapses late, so at the tick the books were still at 1.05× on the shelf
 * while the card claimed the decision was made. Rule 3 is about what is on
 * screen when the line ticks, not about when an animation was allowed to begin.
 */
const DECIDE_FROM = 0.18;

// ---------------------------------------------------------------------------
// The letting-go beat — "Sell the old TV instead of moving it"
// ---------------------------------------------------------------------------

export interface TvState {
  /** Scale for the retro set. 1 while it is still yours, 0 once it is sold. */
  oldScale: number;
  /** Scale for the flat screen. 0 until it arrives. */
  newScale: number;
  /** True once the old set has gone, whether or not the new one has landed. */
  sold: boolean;
}

/**
 * The old set leaves, the console sits empty for a moment, the new one lands.
 *
 * The two halves sit on opposite sides of the tick, and the beat's own wording
 * is why: "Sell the old TV instead of moving it". SELLING is the to-do, so the
 * old set going is the ACT and belongs before the line ticks (rule 3). The new
 * television is not the task at all — it is what selling the old one paid for
 * — so it arrives on the payoff, like the couch.
 *
 * That leaves a deliberate gap between `COMMIT_AT` and `PAYOFF_AT` where the
 * console holds nothing. It is the most honest frame in the beat: the thing is
 * gone, the space is empty, and the room has to sit with that for a moment
 * before the replacement shows up. A cross-fade would have hidden exactly the
 * part worth showing.
 *
 * (The spike swapped the sets at a bare global `t > 0.9`. The old set now
 * leaves at t ≈ 0.883 and the new one lands at t ≈ 0.9 — the same instant the
 * hand-placed constant picked, arrived at from the beat instead.)
 */
export function tvStateAt(u: number): TvState {
  const oldScale = u <= OLD_TV_LEAVES_FROM
    ? 1
    : popOut((u - OLD_TV_LEAVES_FROM) / (COMMIT_AT - OLD_TV_LEAVES_FROM));
  const newScale = u < PAYOFF_AT ? 0 : popIn((u - PAYOFF_AT) / POP_OVER);

  return { oldScale: Math.max(0, oldScale), newScale, sold: u >= COMMIT_AT };
}

/**
 * The old set is not whisked away the instant the beat opens — the camera is
 * still arriving at the console, and a television that vanishes before you have
 * looked at it vanishes for nobody. Same reasoning as the paint beat's
 * `CYCLE_FROM`.
 */
const OLD_TV_LEAVES_FROM = 0.1;
