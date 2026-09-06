import { describe, expect, it } from "vitest";
import { STORY_BEATS } from "@/lib/story-beats";
import { ROOM } from "./room-layout";
import { framingAt, FRAMINGS, KEYFRAMES } from "./room-camera";

/**
 * The camera track, tested without a canvas.
 *
 * This is the half of EI-276 that can be checked at all: `framingAt()` is pure
 * arithmetic, so the thing that would actually regress — a beat pointing at the
 * wrong object, a keyframe off by half a band, a zoom widened past the point
 * where the room stops being a room — is catchable in milliseconds. What is
 * left in `room-scene.tsx` is four lines of damping toward whatever this
 * returns, and no unit test can tell you those look right; that is what
 * `docs/SCENE.md`'s "look at the room" step is for.
 */

describe("the beat framings", () => {
  it("gives every beat somewhere to look", () => {
    for (const beat of STORY_BEATS) {
      expect(FRAMINGS[beat.focus], `beat "${beat.headline}"`).toBeDefined();
    }
  });

  it("aims inside the room, never through a wall", () => {
    // The room is an open diorama with the floor at y=0; a target outside it
    // means the camera is looking at nothing, which reads as a drift rather
    // than as a framing.
    for (const [name, framing] of Object.entries(FRAMINGS)) {
      const [x, y, z] = framing.target;
      expect(Math.abs(x), `${name} x`).toBeLessThanOrEqual(ROOM.width / 2);
      expect(Math.abs(z), `${name} z`).toBeLessThanOrEqual(ROOM.depth / 2);
      expect(y, `${name} y`).toBeGreaterThanOrEqual(0);
      expect(y, `${name} y`).toBeLessThanOrEqual(ROOM.wallHeight);
    }
  });

  it("keeps every zoom inside the diorama band", () => {
    /*
      The constraint `room-scene.tsx` has carried since the spike: pushing to
      132 cropped the walls and floor off every edge and lost the room. 93 is
      the established wide shot; 135 leaves margin under the number that is
      known to break.
    */
    for (const [name, framing] of Object.entries(FRAMINGS)) {
      expect(framing.zoom, `${name} zoom`).toBeGreaterThanOrEqual(93);
      expect(framing.zoom, `${name} zoom`).toBeLessThanOrEqual(135);
    }
  });
});

describe("framingAt", () => {
  it("holds the first framing before the first beat and the last after it", () => {
    // Otherwise the camera is still gliding onto the opening shot as the story
    // scrolls into view, and drifts off the new television at the end.
    expect(framingAt(0)).toEqual(FRAMINGS[STORY_BEATS[0].focus]);
    expect(framingAt(-1)).toEqual(FRAMINGS[STORY_BEATS[0].focus]);
    expect(framingAt(1)).toEqual(FRAMINGS[STORY_BEATS[STORY_BEATS.length - 1].focus]);
    expect(framingAt(2)).toEqual(FRAMINGS[STORY_BEATS[STORY_BEATS.length - 1].focus]);
  });

  it("sits exactly on each beat's object at the centre of that beat", () => {
    // The claim the whole ticket rests on: when a beat's copy is centred on
    // screen, the camera is on the thing that beat is about.
    for (const [i, beat] of STORY_BEATS.entries()) {
      const centre = (i + 0.5) / STORY_BEATS.length;
      expect(framingAt(centre), beat.headline).toEqual(FRAMINGS[beat.focus]);
    }
  });

  it("puts one keyframe per beat, at that beat's centre", () => {
    expect(KEYFRAMES).toHaveLength(STORY_BEATS.length);
    for (const [i, key] of KEYFRAMES.entries()) {
      expect(key.at).toBeCloseTo((i + 0.5) / STORY_BEATS.length, 10);
    }
  });

  it("moves continuously — no jump between one object and the next", () => {
    /*
      A snap is the failure this replaces: materials in this scene already lerp
      rather than jump, and a camera that teleported between beats would be the
      one thing on screen that did not.

      Sampled densely and compared step to step. The bound is generous because
      it only has to catch a discontinuity, not police the easing: the largest
      honest step here is ~1/60th of the distance between two objects.
    */
    let previous = framingAt(0);
    for (let t = 0.001; t <= 1; t += 0.001) {
      const next = framingAt(t);
      const step = Math.hypot(
        next.target[0] - previous.target[0],
        next.target[1] - previous.target[1],
        next.target[2] - previous.target[2],
      );
      expect(step, `jump at t=${t.toFixed(3)}`).toBeLessThan(0.05);
      expect(Math.abs(next.zoom - previous.zoom), `zoom jump at t=${t.toFixed(3)}`).toBeLessThan(1);
      previous = next;
    }
  });

  it("actually visits every object rather than averaging them", () => {
    // Guards against an interpolation so smooth it never arrives: each beat's
    // target must be hit exactly somewhere along the track.
    const visited = new Set<string>();
    for (let t = 0; t <= 1; t += 0.001) {
      const { target } = framingAt(t);
      for (const [name, framing] of Object.entries(FRAMINGS)) {
        if (framing.target.every((v, i) => Math.abs(v - target[i]) < 1e-9)) visited.add(name);
      }
    }
    for (const beat of STORY_BEATS) {
      expect(visited, `never framed "${beat.focus}"`).toContain(beat.focus);
    }
  });
});
