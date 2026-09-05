/**
 * EI-272 — where everything sits, in metres.
 *
 * Placement lives here rather than baked into the GLB on purpose. The GLB is
 * produced by `scripts/scene/build-room.mjs`, which drops every prop at the
 * origin, normalised: front facing +Z, scaled to a real-world size, centred on
 * X/Z and sitting on Y=0. So a position below is a position in a real room,
 * and it can be nudged without re-running the build.
 *
 * The room is an open diorama - floor and two walls, no ceiling - seen from an
 * orthographic camera off +X/+Y/+Z. Back wall at -Z, side wall at -X.
 *
 * Note the deliberate absence of `as const` on anything holding a coordinate.
 * `as const` would make these readonly tuples, and three.js/R3F props want
 * mutable ones; the two do not unify, and the error surfaces far from here.
 */

export type Vec3 = [number, number, number];

export type PropPlacement = {
  /** Node name in the GLB, from `SCENE_MODELS` in `scripts/scene/build-room.mjs`. */
  node: string;
  position: Vec3;
  /** Y rotation in radians, applied on top of the model's normalised +Z facing. */
  rotationY?: number;
};

/** Floor extent in metres. The camera framing in `room-scene.tsx` assumes this. */
export const ROOM = {
  width: 6,
  depth: 5,
  wallHeight: 2.7,
};

const HALF_W = ROOM.width / 2;
const HALF_D = ROOM.depth / 2;

/**
 * The console's top surface, in metres.
 *
 * `Shelf_Small1` measures 1.944 x 0.577 units at source, so its height is
 * 0.297 of its width; scaled to a 1.3 m console that puts the top at 0.386 m.
 * Both televisions stand on this. **If `shelf_console`'s target size changes in
 * `build-room.mjs`, this number changes with it** — the models are normalised
 * to sit on Y=0, so nothing else corrects for it.
 */
const CONSOLE_TOP = 0.386;

/** Where the TV stands, whichever TV it currently is. */
const TV_SPOT: Vec3 = [-HALF_W + 0.35, CONSOLE_TOP, 0.2];

/**
 * The permanent room. Everything here is on screen for the whole scroll.
 *
 * The console sits against the LEFT wall so the couch can face it across the
 * rug without either one occluding the back wall — the back wall is where the
 * paint swatches live, and they are the hero of the beat this scene exists to
 * prove.
 */
export const STATIC_PROPS: PropPlacement[] = [
  // Against the left wall (-X), rotated a quarter turn to face into the room.
  { node: "shelf_console", position: [-HALF_W + 0.35, 0, 0.2], rotationY: Math.PI / 2 },

  // Seating faces the console across the rug.
  { node: "rug", position: [0.3, 0.01, 0.3], rotationY: Math.PI / 2 },
  { node: "couch", position: [1.7, 0, 0.3], rotationY: -Math.PI / 2 },
  { node: "coffee_table", position: [0.35, 0, 0.35] },

  // Corners and edges.
  { node: "houseplant", position: [HALF_W - 0.7, 0, -HALF_D + 0.7] },
  { node: "floor_lamp", position: [1.9, 0, -HALF_D + 0.6] },
  { node: "stool", position: [-0.9, 0, 1.5] },

  // Back wall (-Z). Window and curtains share a centre.
  { node: "window", position: [1.5, 1.25, -HALF_D + 0.06] },
  { node: "curtains", position: [1.5, 1.35, -HALF_D + 0.16] },
  { node: "door", position: [-1.8, 0, -HALF_D + 0.06] },
];

/**
 * Beat 5: the shelves go up, and stay up.
 *
 * X is half the shelf's post-rotation depth off the wall face (0.476 / 2 =
 * 0.238), because `build-room.mjs` centres every model on X/Z — put them at the
 * wall plane itself and half of each shelf disappears into it. They read as
 * floating at 1.5 m and 2.0 m, so these sit lower and closer together, where a
 * pair of shelves would actually go above a console.
 */
export const SHELF_PROPS: PropPlacement[] = [
  { node: "wall_shelf_a", position: [-HALF_W + 0.24, 1.15, -0.5], rotationY: Math.PI / 2 },
  { node: "wall_shelf_b", position: [-HALF_W + 0.24, 1.62, -0.5], rotationY: Math.PI / 2 },
];

/**
 * The two televisions, sharing one spot. The console never changes; the thing
 * on it does. `tv_old` is deliberately scaled small in `build-room.mjs` so it
 * looks lost up there — that empty space is the beat.
 */
export const TV_OLD: PropPlacement = {
  node: "tv_old",
  position: TV_SPOT,
  rotationY: Math.PI / 2,
};

export const TV_NEW: PropPlacement = {
  node: "tv_new",
  position: TV_SPOT,
  rotationY: Math.PI / 2,
};

/**
 * The three paint swatches, on the back wall. Not models — quads, because the
 * asset library has no wall art of any kind and a painted rectangle is a
 * painted rectangle.
 */
export const SWATCHES = {
  /** Candidate colours the beat cycles through, then abandons. */
  candidates: ["#c8ccc4", "#d8c3a5", "#a8b8c8", "#c9a9a6"],
  bareWall: "#e8e4dd",
  size: 0.42,
  gap: 0.16,
  /** Eye height on the back wall, to the left of the window. */
  origin: [-1.1, 1.5, -HALF_D + 0.05] as Vec3,
};

/**
 * The framed prints that come down in beat 5. Same reasoning as the swatches:
 * a frame is a quad with a border.
 */
export const PRINTS: { position: Vec3; size: [number, number] }[] = [
  { position: [0.1, 1.75, -HALF_D + 0.05], size: [0.5, 0.66] },
  { position: [0.1, 1.0, -HALF_D + 0.05], size: [0.5, 0.4] },
];
