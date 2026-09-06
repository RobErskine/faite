import { STORY_BEATS, type BeatFocus } from "@/lib/story-beats";
import { ROOM, SWATCHES, TV_SPOT, type Vec3 } from "./room-layout";

/**
 * Where the camera looks, beat by beat (EI-276).
 *
 * The spike's rig did one continuous push-in: zoom 93 → 128 with a few degrees
 * of orbit, aimed at the middle of the room the whole way down. That proved the
 * budget, but it meant the room did the same thing under every beat — the copy
 * talked about paint while the camera looked at the couch.
 *
 * Now each beat names an object (`focus` in `lib/story-beats.ts`) and this file
 * turns that name into a framing. Beat, object, claim and sub-task are one row
 * in one table, which is the whole point: three parallel lists kept in step by
 * hand fail silently.
 *
 * # Why it pans more than it zooms
 *
 * `room-scene.tsx`'s original comment is the constraint, and it still holds:
 * the first spike pushed 52 → 132 and cropped the walls and floor off every
 * edge. A diorama has to stay a diorama — the payoff is a finished ROOM, and
 * you cannot read that through a keyhole.
 *
 * So the zooms below stay inside a narrow band and the work of "look at this"
 * is done by moving what the camera aims at. Panning an orthographic camera
 * across a small room is unambiguous at diorama scale, and it keeps every beat
 * legible as a place rather than a close-up of a texture.
 *
 * # No three.js here
 *
 * Plain numbers, so the interpolation can be unit-tested without a canvas or a
 * WebGL context. `room-scene.tsx` is the only file that turns these into camera
 * state.
 */

export interface Framing {
  /** What the camera aims at, in metres. */
  target: Vec3;
  /** Orthographic zoom. See the band note above before widening this. */
  zoom: number;
  /** Radians around Y, off the room's default three-quarter view. */
  angle: number;
  /** Camera height in metres. Lower reads as stepping toward the object. */
  height: number;
}

const HALF_D = ROOM.depth / 2;

/** The room's default three-quarter view. Every angle below is an offset. */
const BASE_ANGLE = Math.PI / 4;

/**
 * The swatch strip's middle, not its origin.
 *
 * `SWATCHES.origin` is the left edge of the first chip; the strip runs right
 * from there. Aiming at the origin frames the wall beside the swatches rather
 * than the swatches.
 */
const SWATCH_CENTER: Vec3 = [
  SWATCHES.origin[0] + ((SWATCHES.candidates.length - 1) * (SWATCHES.size + SWATCHES.gap)) / 2,
  SWATCHES.origin[1],
  -HALF_D + 0.05,
];

export const FRAMINGS: Record<BeatFocus, Framing> = {
  /** The whole room, undecided. Where the spike started, and beat one's subject. */
  room: { target: [0, 1.0, 0], zoom: 93, angle: BASE_ANGLE, height: 9.5 },
  /** The three paint chips on the back wall, up since July. */
  swatches: { target: SWATCH_CENTER, zoom: 120, angle: BASE_ANGLE + 0.1, height: 9.0 },
  /**
   * The big monstera in the corner by the window — the recurring beat's
   * subject, because a plant that needs watering every Wednesday is the one
   * thing in this room that is never finished.
   *
   * Chosen over the three smaller plants for being legible at diorama scale:
   * the ones on the console and the coffee table are a few centimetres across
   * and read as texture rather than as a plant you could have a to-do about.
   * Position from `PROPS` in `room-layout.ts`; aimed above its base so the
   * leaves are centred rather than the pot.
   */
  plant: { target: [2.05, 0.62, -1.6], zoom: 122, angle: BASE_ANGLE - 0.06, height: 8.9 },
  /** The blue couch on the rug — the thing you measure the room for. */
  couch: { target: [1.6, 0.55, 0.2], zoom: 118, angle: BASE_ANGLE - 0.14, height: 8.8 },
  /** The wall shelf and its books: the bookcase there is a decision about. */
  shelf: { target: [-2.2, 1.45, -0.5], zoom: 124, angle: BASE_ANGLE + 0.22, height: 8.6 },
  /** The console, where the old set is finally replaced. */
  tv: { target: [TV_SPOT[0] + 0.1, TV_SPOT[1] + 0.2, TV_SPOT[2]], zoom: 130, angle: BASE_ANGLE + 0.16, height: 8.4 },
};

/**
 * Each beat's framing is held at the CENTRE of its band, not at its edge.
 *
 * A beat owns `1/n` of the scroll, and its copy is centred in that band — so
 * pinning the keyframe to the centre puts the camera on the object exactly when
 * the sentence about it is centred on screen, and spends the boundaries moving
 * between two. Keying on the edges instead would have the camera arrive at each
 * object just as its paragraph left.
 */
export const KEYFRAMES: { at: number; framing: Framing }[] = STORY_BEATS.map((beat, i) => ({
  at: (i + 0.5) / STORY_BEATS.length,
  framing: FRAMINGS[beat.focus],
}));

const clamp = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
/**
 * `(1-t)a + tb`, not `a + (b-a)t`.
 *
 * The two are equal in real arithmetic and not in floating point: the second
 * form returns `a + (b-a)` at t=1, which is a bit or two off `b`. That matters
 * here because a keyframe is hit at exactly t=1 of its own segment, and a
 * camera that lands 1e-16 short of the object it is supposed to be framing is
 * a test that cannot assert the thing the whole track exists to do.
 */
const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;

/** Smoothstep, so the camera eases out of one object and into the next. */
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * The framing at scroll progress `t`, interpolated between keyframes.
 *
 * Holds the first framing before the first keyframe and the last after the
 * last, so the camera is already settled on the opening wide shot when the
 * story scrolls into view and stays on the new television at the end rather
 * than drifting off it.
 */
export function framingAt(t: number): Framing {
  const p = clamp(t);
  const first = KEYFRAMES[0];
  const last = KEYFRAMES[KEYFRAMES.length - 1];
  if (p <= first.at) return first.framing;
  if (p >= last.at) return last.framing;

  let i = 0;
  while (i < KEYFRAMES.length - 2 && p > KEYFRAMES[i + 1].at) i++;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[i + 1];
  const span = ease((p - a.at) / (b.at - a.at));

  return {
    target: [
      lerp(a.framing.target[0], b.framing.target[0], span),
      lerp(a.framing.target[1], b.framing.target[1], span),
      lerp(a.framing.target[2], b.framing.target[2], span),
    ],
    zoom: lerp(a.framing.zoom, b.framing.zoom, span),
    angle: lerp(a.framing.angle, b.framing.angle, span),
    height: lerp(a.framing.height, b.framing.height, span),
  };
}
