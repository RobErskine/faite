/**
 * EI-272 — where everything sits, in metres.
 *
 * Placement lives here rather than baked into the GLB on purpose. The GLB is
 * produced by `scripts/scene/build-room.mjs`, which drops every prop at the
 * origin, normalised: front facing +Z, scaled to a real-world size, centred on
 * X/Z and sitting on Y=0. So a position below is a position in a real room,
 * and it can be nudged without re-running the build.
 *
 * The composition follows how an actual living room is arranged, because the
 * point of the scene is that someone lives here:
 *
 *  - The RUG ANCHORS THE SEATING ZONE. The couch's front feet land on it, the
 *    coffee table sits fully on it, and the television faces it. Furniture
 *    scattered off-rug is what made the first pass read as a showroom.
 *  - The couch and console face each other across the rug at a real viewing
 *    distance. The side table touches the couch's arm; the floor lamp stands
 *    behind the opposite arm, where a person would put a reading light.
 *  - Plants go where light is - the big one in the corner by the window, the
 *    small one on the console. Nothing stands alone in the middle of the
 *    floor; a prop with no relationship to another prop reads as clutter.
 *  - The door moved to the LEFT wall so the back wall carries a legible
 *    left-to-right sequence: swatches, then the framed pair, then the window.
 *
 * The room is an open diorama - floor and two walls, no ceiling - seen from an
 * orthographic camera off +X/+Y/+Z. Back wall at -Z, side wall at -X.
 *
 * Note the deliberate absence of `as const` on anything holding a coordinate:
 * it would make these readonly tuples, and three.js/R3F props want mutable
 * ones. The two do not unify, and the error surfaces far from here.
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

const HALF_W = ROOM.width / 2; // walls' inner faces: x = -3.0, z = -2.5
const HALF_D = ROOM.depth / 2;

/**
 * The console's top surface, in metres.
 *
 * `Shelf_Small1` measures 1.944 x 0.577 units at source, so its height is
 * 0.297 of its width; scaled to a 1.3 m console that puts the top at 0.386 m.
 * The television and the small plant both stand on this. **If the console's
 * target size changes in `build-room.mjs`, this number changes with it** — the
 * models are normalised to sit on Y=0, so nothing else corrects for it.
 */
const CONSOLE_TOP = 0.386;

/** The media wall: everything on the left wall shares this X. */
const LEFT_WALL_X = -HALF_W + 0.2;

/** Where the TV stands, whichever TV it currently is. */
const TV_SPOT: Vec3 = [-HALF_W + 0.35, CONSOLE_TOP, 0.1];

/**
 * The room. Everything is present from the first frame - the only thing that
 * changes on scroll is which television stands on the console. A room where
 * furniture pops in reads as a software demo; a room that is simply *there*
 * reads as a place.
 */
export const STATIC_PROPS: PropPlacement[] = [
  // --- the media wall (-X), facing the seating across the rug -------------
  { node: "shelf_console", position: [-HALF_W + 0.35, 0, 0.1], rotationY: Math.PI / 2 },
  { node: "plant_small", position: [-HALF_W + 0.35, CONSOLE_TOP, 0.62], rotationY: Math.PI / 2 },
  // A stacked pair directly over the console's far end - grouped with the
  // media wall, not floating in a corner. (First pass staggered them toward
  // the back corner, where they read as one detached cabinet with no
  // relationship to anything.) The lower shelf clears the upgraded TV, whose
  // top reaches ~1.16 m, because it sits over the console's plant end.
  { node: "wall_shelf_a", position: [LEFT_WALL_X + 0.04, 1.42, -0.52], rotationY: Math.PI / 2 },
  { node: "wall_shelf_b", position: [LEFT_WALL_X + 0.04, 1.84, -0.52], rotationY: Math.PI / 2 },
  // Shelf styling: the same little plant as the console, up on the lower
  // shelf's top surface (unit height 0.337, so 1.42 + 0.337).
  { node: "plant_small", position: [LEFT_WALL_X + 0.04, 1.757, -0.52], rotationY: Math.PI / 2 },
  { node: "door", position: [-HALF_W + 0.1, 0, 1.7], rotationY: Math.PI / 2 },

  // --- the seating zone: an L around the coffee table, anchored on the rug -
  { node: "rug", position: [0.2, 0.004, 0.1] },
  // Faces the television. Front feet land on the rug's right edge.
  { node: "couch", position: [1.85, 0, 0.1], rotationY: -Math.PI / 2 },
  // The second seat that turns "a sofa opposite a TV" into a conversation
  // corner. It floats on the rug's top edge with a walkway behind it -
  // furniture off the wall is how real rooms use their middle.
  { node: "loveseat", position: [0.3, 0, -1.42] },
  // Long axis parallel to the couch, like an oval coffee table actually sits.
  { node: "coffee_table", position: [0.2, 0, 0.25], rotationY: Math.PI / 2 },
  { node: "plant_table", position: [0.2, 0.347, 0.25], rotationY: Math.PI / 2 },
  // Touching the couch's front arm - a table nobody can reach is decoration.
  { node: "side_table", position: [1.88, 0, 1.42] },
  { node: "plant_side", position: [1.88, 0.416, 1.42] },
  // Reading light in the corner of the L, serving both seats.
  { node: "floor_lamp", position: [2.15, 0, -1.35] },

  // --- the back wall (-Z), left to right: sideboard+swatches, prints, window
  // The sideboard sits directly under the swatch row, so the paint decision
  // hangs over real furniture instead of floating on an empty wall.
  { node: "sideboard", position: [-1.55, 0, -HALF_D + 0.29] },
  { node: "desk_lamp", position: [-2.0, 0.654, -HALF_D + 0.31] },
  { node: "window", position: [1.5, 1.3, -HALF_D + 0.06] },
  { node: "curtains", position: [1.5, 0.32, -HALF_D + 0.14] },
  // The window cluster: the monstera and a tall cane, different heights,
  // where the light is.
  { node: "houseplant", position: [2.4, 0, -1.85] },
  { node: "plant_tall", position: [1.75, 0, -2.05] },

  // --- the doorway ---------------------------------------------------------
  // A bushy one beside the door, the first thing you'd see coming in.
  { node: "plant_bushy", position: [-2.3, 0, 2.1] },
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
 * The three paint swatches, on the back wall at eye height. Not models —
 * quads, because the asset library has no wall art of any kind and a painted
 * rectangle is a painted rectangle.
 */
export const SWATCHES = {
  /** Candidate colours the beat cycles through, then abandons. Muted,
   *  interior-paint chips rather than primaries. */
  candidates: ["#b6bfae", "#cfae94", "#a8b8c6", "#c9a9a6"],
  /**
   * `null` means "the wall's own colour" - which is a theme token now, read at
   * runtime by `RoomShell`, so it cannot be a hex here without forking from
   * dark mode.
   */
  bareWall: null as string | null,
  size: 0.42,
  gap: 0.16,
  origin: [-2.15, 1.45, -HALF_D + 0.05] as Vec3,
};

/**
 * A gallery pair over the sitting area - same size, same hanging height,
 * because matched frames are what "someone chose this" looks like. (The first
 * pass stacked two mismatched frames vertically, which read as leftovers.)
 */
export const PRINTS: { position: Vec3; size: [number, number] }[] = [
  { position: [-0.35, 1.5, -HALF_D + 0.05], size: [0.45, 0.56] },
  { position: [0.3, 1.5, -HALF_D + 0.05], size: [0.45, 0.56] },
];

/**
 * Soft contact shadows under everything with legs or mass. Flat-lit low-poly
 * furniture floats without them; this is the single cheapest thing that makes
 * the props read as standing on the floor rather than hovering over it.
 *
 * `y` varies because the couch and coffee table stand ON the rug (top surface
 * ~0.035 m) while everything else stands on the floor - a shadow under the rug
 * is a shadow nobody sees.
 */
export const CONTACT_SHADOWS: { position: Vec3; size: [number, number] }[] = [
  { position: [1.85, 0.045, 0.1], size: [1.3, 2.5] }, // couch
  { position: [0.3, 0.045, -1.42], size: [1.8, 1.1] }, // loveseat
  { position: [0.2, 0.045, 0.25], size: [0.95, 1.5] }, // coffee table
  { position: [-2.8, 0.012, 0.1], size: [0.75, 1.7] }, // console
  { position: [-1.55, 0.012, -2.21], size: [1.55, 0.75] }, // sideboard
  { position: [2.4, 0.012, -1.85], size: [1.2, 1.2] }, // houseplant
  { position: [1.75, 0.012, -2.05], size: [0.65, 0.65] }, // plant_tall
  { position: [-2.3, 0.012, 2.1], size: [1.0, 1.0] }, // plant_bushy
  { position: [1.88, 0.012, 1.42], size: [0.75, 0.75] }, // side table
  { position: [2.15, 0.012, -1.35], size: [0.6, 0.6] }, // floor lamp
];
