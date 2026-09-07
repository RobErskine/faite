import { describe, expect, it } from "vitest";
import { STORY_BEATS, TICK_AT } from "@/lib/story-beats";
import { SWATCHES } from "./room-layout";
import {
  beatBandFor,
  beatLocalAt,
  COMMIT_AT,
  couchStateAt,
  PAYOFF_AT,
  paintStateAt,
  plantStateAt,
  popIn,
  popOut,
  tvStateAt,
  VISIBLE_SWATCHES,
} from "./beat-animations";

/**
 * The beat animations, tested as arithmetic (EI-280).
 *
 * Same deal as `room-camera.test.ts`: what regresses is not the rendering, it
 * is the timing — an act that lands after its line ticks, a cycle that skips a
 * chip, a "done" that comes undone when the band ends. All of that is pure
 * functions of scroll progress, so all of it is testable in milliseconds.
 */

describe("the ordering rule", () => {
  it("commits every act before the sub-task ticks", () => {
    // The rule the whole strategy hangs on: a checked-off to-do whose act has
    // not happened yet is a lie told on both halves of the screen at once.
    expect(COMMIT_AT).toBeLessThan(TICK_AT);
  });

  it("lands a payoff no earlier than the tick", () => {
    /*
      The deliberate asymmetry, on the record.

      An ACT is the to-do happening, so it precedes the tick. A PAYOFF is what
      the to-do earns, so it cannot honestly precede it: the couch is not the
      measuring, it is what measuring gets you, and a couch that arrived first
      would make the task look like a formality.
    */
    expect(PAYOFF_AT).toBeGreaterThanOrEqual(TICK_AT);
  });
});

describe("beat-local time", () => {
  it("derives each band from the beat table, in order", () => {
    const n = STORY_BEATS.length;
    for (const [i, beat] of STORY_BEATS.entries()) {
      expect(beatBandFor(beat.focus)).toEqual({ start: i / n, end: (i + 1) / n });
    }
  });

  it("throws on a focus no beat has, rather than animating nothing quietly", () => {
    // @ts-expect-error — the point is exactly that this focus does not exist.
    expect(() => beatBandFor("fireplace")).toThrow(/no beat/);
  });

  it("clamps: 0 before the band, 1 after it, forever", () => {
    const { start, end } = beatBandFor("swatches");
    expect(beatLocalAt(start - 0.01, "swatches")).toBe(0);
    expect(beatLocalAt(end + 0.01, "swatches")).toBe(1);
    expect(beatLocalAt(1, "swatches")).toBe(1);
    expect(beatLocalAt((start + end) / 2, "swatches")).toBeCloseTo(0.5, 10);
  });
});

describe("the paint beat", () => {
  it("starts bare, while the camera is still arriving", () => {
    for (const u of [0, 0.04]) {
      expect(paintStateAt(u), `u=${u}`).toMatchObject({
        activeSwatch: null,
        wallColor: null,
        committed: false,
        swatchOpacity: 1,
      });
    }
  });

  it("considers every visible chip, in wall order, each previewing on the wall", () => {
    /*
      Every index 0..2 must appear, in order, before the commit — a cycle that
      skips a chip reads as the painter ignoring one, and a wall that does not
      preview the active chip breaks the cause-and-effect the beat exists to
      show.
    */
    const seen: number[] = [];
    for (let u = 0.05; u < COMMIT_AT; u += 0.001) {
      const state = paintStateAt(u);
      if (state.activeSwatch === null) continue;
      expect(state.committed).toBe(false);
      expect(state.wallColor).toBe(SWATCHES.candidates[state.activeSwatch]);
      if (seen[seen.length - 1] !== state.activeSwatch) seen.push(state.activeSwatch);
    }
    expect(seen).toEqual([...Array(VISIBLE_SWATCHES).keys()]);
  });

  it("commits to the chosen chip, and the chosen chip is one you can see", () => {
    const state = paintStateAt(COMMIT_AT);
    expect(state.committed).toBe(true);
    expect(state.activeSwatch).toBe(SWATCHES.chosen);
    expect(state.wallColor).toBe(SWATCHES.candidates[SWATCHES.chosen]);
    // A pick you cannot point at on the wall is no pick at all.
    expect(SWATCHES.chosen).toBeLessThan(VISIBLE_SWATCHES);
  });

  it("stays painted for the rest of the story — the snap-back is gone", () => {
    // The spike's ending ("the indecision IS the animation") is exactly what
    // this beat replaced. Done stays done.
    for (const u of [COMMIT_AT, 0.5, TICK_AT, 0.9, 1]) {
      expect(paintStateAt(u).wallColor, `u=${u}`).toBe(SWATCHES.candidates[SWATCHES.chosen]);
      expect(paintStateAt(u).committed, `u=${u}`).toBe(true);
    }
  });
});

describe("the sample cards coming down", () => {
  it("keeps them up through the decision and the tick", () => {
    // They are the decision being made. Removing them before the line ticks
    // would leave the beat's most legible prop gone while its copy is on
    // screen.
    for (const u of [0.1, COMMIT_AT, TICK_AT]) {
      expect(paintStateAt(u).swatchOpacity, `u=${u}`).toBe(1);
    }
  });

  it("takes them down after it, and they stay down", () => {
    // A painted wall does not need chips taped to it — leaving them up was the
    // difference between "we chose" and "we are still choosing".
    expect(paintStateAt(0.5).swatchOpacity).toBeLessThan(1);
    expect(paintStateAt(0.5).swatchOpacity).toBeGreaterThan(0);
    for (const u of [0.6, 0.8, 1]) {
      expect(paintStateAt(u).swatchOpacity, `u=${u}`).toBe(0);
    }
  });

  it("never goes outside 0..1, at any point in the band", () => {
    // It is fed straight to `material.opacity`, where out-of-range is a
    // rendering bug rather than a clamp.
    for (let u = 0; u <= 1; u += 0.005) {
      const o = paintStateAt(u).swatchOpacity;
      expect(o, `u=${u.toFixed(3)}`).toBeGreaterThanOrEqual(0);
      expect(o, `u=${u.toFixed(3)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("the watering beat", () => {
  it("arrives healthy, then browns as the copy is read", () => {
    expect(plantStateAt(0)).toEqual({ thirst: 0, watered: false });
    // Monotonically thirstier all the way to the watering.
    let previous = 0;
    for (let u = 0.01; u < COMMIT_AT; u += 0.005) {
      const { thirst, watered } = plantStateAt(u);
      expect(thirst, `u=${u.toFixed(3)}`).toBeGreaterThanOrEqual(previous);
      expect(watered, `u=${u.toFixed(3)}`).toBe(false);
      previous = thirst;
    }
    expect(previous).toBeGreaterThan(0.9);
  });

  it("peaks exactly at the watering, then recovers", () => {
    expect(plantStateAt(COMMIT_AT).thirst).toBeCloseTo(1, 5);
    expect(plantStateAt(COMMIT_AT).watered).toBe(true);

    let previous = 1;
    for (let u = COMMIT_AT; u <= 0.8; u += 0.005) {
      const { thirst, watered } = plantStateAt(u);
      expect(thirst, `u=${u.toFixed(3)}`).toBeLessThanOrEqual(previous + 1e-9);
      expect(watered, `u=${u.toFixed(3)}`).toBe(true);
      previous = thirst;
    }
  });

  it("is a round trip: green again by the end, and it stays green", () => {
    // A recurring to-do is never finished — the beat returns the plant to
    // where it started rather than leaving it in a new state, because the
    // point is that it will be brown again next Wednesday.
    for (const u of [0.8, 0.9, 1]) {
      expect(plantStateAt(u), `u=${u}`).toEqual({ thirst: 0, watered: true });
    }
  });

  it("never leaves 0..1 — it is fed straight to a colour lerp", () => {
    for (let u = -0.2; u <= 1.2; u += 0.005) {
      const { thirst } = plantStateAt(u);
      expect(thirst, `u=${u.toFixed(3)}`).toBeGreaterThanOrEqual(0);
      expect(thirst, `u=${u.toFixed(3)}`).toBeLessThanOrEqual(1);
    }
  });

  it("is continuous — no cut between browning and recovering", () => {
    // The whole ask was green → brown → green as one change, not two.
    let previous = plantStateAt(0).thirst;
    for (let u = 0.002; u <= 1; u += 0.002) {
      const next = plantStateAt(u).thirst;
      expect(Math.abs(next - previous), `jump at u=${u.toFixed(3)}`).toBeLessThan(0.05);
      previous = next;
    }
  });
});

describe("the measuring beat", () => {
  it("has no loveseat at all until the measuring is done", () => {
    // The room starts without it: the whole to-do is about a thing that does
    // not exist yet.
    for (let u = 0; u < PAYOFF_AT; u += 0.005) {
      expect(couchStateAt(u), `u=${u.toFixed(3)}`).toEqual({
        loveseatScale: 0,
        delivered: false,
      });
    }
  });

  it("pops: overshoots its real size, then settles at exactly 1", () => {
    // A fade would be wrong — furniture does not fade into a room. The
    // overshoot is the beat of a box being opened.
    const peak = Math.max(
      ...Array.from({ length: 200 }, (_, i) => couchStateAt(PAYOFF_AT + i * 0.001).loveseatScale),
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.2);

    for (const u of [0.7, 0.9, 1]) {
      expect(couchStateAt(u).loveseatScale, `u=${u}`).toBeCloseTo(1, 6);
      expect(couchStateAt(u).delivered, `u=${u}`).toBe(true);
    }
  });

  it("starts the pop from nothing, not from a visible half-couch", () => {
    // A scale that began at, say, 0.3 would flash a small couch on the first
    // frame of the delivery.
    expect(couchStateAt(PAYOFF_AT).loveseatScale).toBeCloseTo(0, 6);
  });

  it("stays delivered — done stays done", () => {
    for (const u of [PAYOFF_AT, 0.6, 1]) {
      expect(couchStateAt(u).delivered, `u=${u}`).toBe(true);
    }
  });

  it("is continuous — the couch grows, it does not cut in", () => {
    let previous = couchStateAt(0).loveseatScale;
    for (let u = 0.002; u <= 1; u += 0.002) {
      const next = couchStateAt(u).loveseatScale;
      expect(Math.abs(next - previous), `jump at u=${u.toFixed(3)}`).toBeLessThan(0.06);
      previous = next;
    }
  });
});

describe("the letting-go beat", () => {
  const u = (local: number) => beatBandFor("tv").start + local / STORY_BEATS.length;

  it("keeps the old set until the selling is done", () => {
    // The act is SELLING, so it has to land before the line ticks.
    expect(tvStateAt(0).oldScale).toBe(1);
    expect(tvStateAt(0.05).oldScale).toBe(1);
    expect(tvStateAt(COMMIT_AT).oldScale).toBeCloseTo(0, 6);
    expect(tvStateAt(COMMIT_AT).sold).toBe(true);
  });

  it("swells as it goes, then collapses — the pop in reverse", () => {
    /*
      Squash and stretch on the way out, the same accent as the arrival.

      This test is the reason `popOut`'s comment is now correct: it originally
      claimed the curve anticipated at the START and differed from
      `popIn(1 - p)`. It does not — the two expand to the same polynomial — and
      this assertion failing at 0.744 is what proved it.
    */
    expect(tvStateAt(0.18).oldScale).toBeGreaterThan(1);
    expect(tvStateAt(0.18).oldScale).toBeLessThan(1.2);
    // The collapse is late and fast, which is what "back" easing does.
    expect(tvStateAt(0.29).oldScale).toBeLessThan(0.3);
  });

  it("is exactly the arrival curve, reversed", () => {
    // Guards the simplification: if someone re-derives `popOut` as its own
    // polynomial, this says what it has to equal.
    for (let p = 0; p <= 1; p += 0.01) {
      expect(popOut(p), `p=${p.toFixed(2)}`).toBeCloseTo(popIn(1 - p), 12);
    }
  });

  it("leaves the console empty between the sale and the delivery", () => {
    /*
      The most honest frame in the beat: the thing is gone, the space is empty,
      and the room sits with that before the replacement arrives. A cross-fade
      would hide exactly the part worth showing.
    */
    for (let local = COMMIT_AT; local < PAYOFF_AT; local += 0.005) {
      const state = tvStateAt(local);
      expect(state.oldScale, `u=${local.toFixed(3)}`).toBeCloseTo(0, 6);
      expect(state.newScale, `u=${local.toFixed(3)}`).toBe(0);
    }
  });

  it("pops the new set in on the payoff, overshooting like the couch", () => {
    expect(tvStateAt(PAYOFF_AT).newScale).toBeCloseTo(0, 6);
    const peak = Math.max(
      ...Array.from({ length: 200 }, (_, i) => tvStateAt(PAYOFF_AT + i * 0.001).newScale),
    );
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.2);
  });

  it("ends with exactly one television, at its real size", () => {
    // Both visible at once, or neither, is the failure this catches.
    for (const local of [0.7, 0.9, 1]) {
      expect(tvStateAt(local).oldScale, `u=${local}`).toBeCloseTo(0, 6);
      expect(tvStateAt(local).newScale, `u=${local}`).toBeCloseTo(1, 6);
    }
  });

  it("never shows both sets at a visible size at once", () => {
    for (let local = 0; local <= 1; local += 0.002) {
      const { oldScale, newScale } = tvStateAt(local);
      const both = oldScale > 0.02 && newScale > 0.02;
      expect(both, `both visible at u=${local.toFixed(3)}`).toBe(false);
    }
  });

  it("never goes negative — it is fed straight to a scale", () => {
    for (let local = -0.2; local <= 1.2; local += 0.005) {
      expect(tvStateAt(local).oldScale, `u=${local.toFixed(3)}`).toBeGreaterThanOrEqual(0);
      expect(tvStateAt(local).newScale, `u=${local.toFixed(3)}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("still swaps where the spike hand-placed it, in global terms", () => {
    // The spike used a bare `t > 0.9`. Reassuring rather than surprising: the
    // beat-derived timing lands on the same instant.
    expect(u(COMMIT_AT)).toBeCloseTo(0.883, 3);
    expect(u(PAYOFF_AT)).toBeCloseTo(0.9, 3);
  });
});
