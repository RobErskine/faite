import { describe, expect, it } from "vitest";
import { STORY_BEATS, TICK_AT } from "@/lib/story-beats";
import { SWATCHES } from "./room-layout";
import {
  beatBandFor,
  beatLocalAt,
  COMMIT_AT,
  paintStateAt,
  tvUpgradedAt,
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
    expect(paintStateAt(0)).toEqual({ activeSwatch: null, wallColor: null, committed: false });
    expect(paintStateAt(0.04)).toEqual({ activeSwatch: null, wallColor: null, committed: false });
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

describe("the tv beat", () => {
  it("keeps the old set until its own beat's decisive moment", () => {
    const { start } = beatBandFor("tv");
    expect(tvUpgradedAt(0)).toBe(false);
    expect(tvUpgradedAt(start)).toBe(false);
    expect(tvUpgradedAt(start + (COMMIT_AT - 0.01) / STORY_BEATS.length)).toBe(false);
  });

  it("swaps at the commit and stays swapped", () => {
    const { start } = beatBandFor("tv");
    expect(tvUpgradedAt(start + COMMIT_AT / STORY_BEATS.length)).toBe(true);
    expect(tvUpgradedAt(1)).toBe(true);
  });
});
