import { STORY_BEATS, type BeatFocus } from "@/lib/story-beats";
import { LOVESEAT, ROOM, SWATCHES, TV_SPOT, type Vec3 } from "./room-layout";

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
  /** What the camera aims at, in meters. */
  target: Vec3;
  /** Orthographic zoom. See the band note above before widening this. */
  zoom: number;
  /**
   * Deliberately outside the diorama band — a close-up, not a room.
   *
   * The band exists so the payoff reads as a finished ROOM. One beat opts out:
   * the watering beat's whole subject is the state of some leaves, and leaves
   * at diorama scale are a few pixels of green. Marked rather than merely
   * large, so `room-camera.test.ts` can hold every OTHER framing to the band
   * and nobody widens one by accident.
   */
  closeUp?: true;
  /** Radians around Y, off the room's default three-quarter view. */
  angle: number;
  /** Camera height in meters. Lower reads as stepping toward the object. */
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
   * the ones on the console and the coffee table are a few centimeters across
   * and read as texture rather than as a plant you could have a to-do about.
   * Position from `PROPS` in `room-layout.ts`; aimed above its base so the
   * leaves are centered rather than the pot.
   */
  plant: {
    target: [2.05, 0.72, -1.55],
    // ~2.1x the diorama wide shot. The beat is about the color of leaves, and
    // at 122 the monstera was a legible plant but its foliage was still a
    // thumbnail — brown or green was a guess. This is the one framing that
    // trades the room away for its subject.
    zoom: 255,
    closeUp: true,
    angle: BASE_ANGLE - 0.06,
    height: 8.9,
  },
  /**
   * The GAP where the loveseat will go — not the couch that is already there.
   *
   * This framing pointed at the blue couch, which was wrong once the beat had
   * an act: the loveseat arrives at `LOVESEAT.position`, three meters away
   * against the back wall, so the pop was happening off screen. Aimed at the
   * empty spot instead, the beat reads as intended — you look at the space you
   * measured, and then the thing you measured for lands in it.
   *
   * Position derived from `LOVESEAT` rather than repeated, so nudging the
   * furniture cannot leave the camera looking at where it used to be. Lifted
   * to seat height so the shot is the space, not the floor.
   */
  couch: {
    target: [LOVESEAT.position[0], 0.5, LOVESEAT.position[2] + 0.35],
    zoom: 126,
    angle: BASE_ANGLE - 0.02,
    height: 8.7,
  },
  /**
   * The books on the wall shelf — the one thing in the room you are still
   * arguing with yourself about.
   *
   * There is no bookcase in this room and there never was; the sub-task used
   * to name one anyway, which is exactly the drift the beat table exists to
   * prevent. The books are real, they are already up there, and they are small
   * enough that hesitating over them reads as hesitation rather than as
   * furniture moving.
   */
  shelf: { target: [-2.2, 1.45, -0.5], zoom: 124, angle: BASE_ANGLE + 0.22, height: 8.6 },
  /** The console, where the old set is finally replaced. */
  tv: { target: [TV_SPOT[0] + 0.1, TV_SPOT[1] + 0.2, TV_SPOT[2]], zoom: 130, angle: BASE_ANGLE + 0.16, height: 8.4 },
};

/**
 * Each beat's framing is held at the CENTER of its band, not at its edge.
 *
 * A beat owns `1/n` of the scroll, and its copy is centered in that band — so
 * pinning the keyframe to the center puts the camera on the object exactly when
 * the sentence about it is centered on screen, and spends the boundaries moving
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
 * Where the camera actually is: the numbers, without the authoring intent.
 *
 * `closeUp` describes a framing someone WROTE — "I meant to leave the diorama
 * band here" — and has no meaning a third of the way between two of them. So
 * it does not survive interpolation, and the type says so rather than leaving
 * a field that is sometimes present and never trustworthy.
 */
export type CameraState = Omit<Framing, "closeUp">;

const stateOf = ({ target, zoom, angle, height }: Framing): CameraState => ({
  target,
  zoom,
  angle,
  height,
});

/**
 * The framing at scroll progress `t`, interpolated between keyframes.
 *
 * Holds the first framing before the first keyframe and the last after the
 * last, so the camera is already settled on the opening wide shot when the
 * story scrolls into view and stays on the new television at the end rather
 * than drifting off it.
 */
export function framingAt(t: number): CameraState {
  const p = clamp(t);
  const first = KEYFRAMES[0];
  const last = KEYFRAMES[KEYFRAMES.length - 1];
  if (p <= first.at) return stateOf(first.framing);
  if (p >= last.at) return stateOf(last.framing);

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
