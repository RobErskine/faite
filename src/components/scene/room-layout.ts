/**
 * EI-272 — where everything sits, in meters.
 *
 * Placement lives here rather than baked into the GLB on purpose. The GLB is
 * produced by `scripts/scene/build-room.mjs`, which drops every prop at the
 * origin, normalized: front facing +Z, scaled to a real-world size, centered on
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
 *    distance. The side table touches the couch's arm.
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
  /** Y rotation in radians, applied on top of the model's normalized +Z facing. */
  rotationY?: number;
};

/**
 * Floor extent in meters. The camera framing in `room-scene.tsx` assumes this.
 *
 * 5.4 x 4.6, down from 6 x 5: review feedback was that the console and TV
 * looked toy-sized against the room, and they were - a 6 m wall will do that
 * to 1.3 m of furniture. Rather than inflate every prop past its real size,
 * the room lost the square footage it wasn't using. Real apartments are the
 * small thing furniture fills, not the big thing it rattles in.
 */
export const ROOM = {
  width: 5.4,
  depth: 4.6,
  wallHeight: 2.7,
};

const HALF_W = ROOM.width / 2; // walls' inner faces: x = -3.0, z = -2.5
const HALF_D = ROOM.depth / 2;

/**
 * The console's top surface, in meters.
 *
 * `Shelf_Small1` measures 1.944 x 0.577 units at source, so its height is
 * 0.297 of its width; scaled to a 1.5 m console that puts the top at 0.445 m.
 * The television and the small plant both stand on this. **If the console's
 * target size changes in `build-room.mjs`, this number changes with it** — the
 * models are normalized to sit on Y=0, so nothing else corrects for it.
 */
const CONSOLE_TOP = 0.445;

/** The media wall: everything on the left wall shares this X. */
const LEFT_WALL_X = -HALF_W + 0.2;

/** Where the TV stands, whichever TV it currently is. */
/** Exported so `room-camera.ts` can frame the console without repeating it. */
export const TV_SPOT: Vec3 = [-HALF_W + 0.38, CONSOLE_TOP, 0.1];

/**
 * The room. Everything is present from the first frame - the only thing that
 * changes on scroll is which television stands on the console. A room where
 * furniture pops in reads as a software demo; a room that is simply *there*
 * reads as a place.
 */
export const STATIC_PROPS: PropPlacement[] = [
  // --- the media wall (-X), facing the seating across the rug -------------
  { node: "shelf_console", position: [-HALF_W + 0.38, 0, 0.1], rotationY: Math.PI / 2 },
  { node: "plant_small", position: [-HALF_W + 0.38, CONSOLE_TOP, 0.7], rotationY: Math.PI / 2 },
  // ONE shelf (review: the stacked pair read as a hovering cabinet), over the
  // console's plant end, with the book stack on its top surface (unit height
  // 0.412, so 1.5 + 0.412). Books replaced the small plant's clone here —
  // review: two identical plants a meter apart read as a copy-paste.
  { node: "wall_shelf", position: [LEFT_WALL_X + 0.06, 1.5, -0.58], rotationY: Math.PI / 2 },
  { node: "books", position: [LEFT_WALL_X + 0.06, 1.912, -0.58], rotationY: Math.PI / 2 },
  { node: "door", position: [-HALF_W + 0.1, 0, 1.55], rotationY: Math.PI / 2 },

  // --- the seating zone: an L around the coffee table, anchored on the rug -
  { node: "rug", position: [0.2, 0.004, 0.1] },
  // Faces the television. Front feet land on the rug's right edge.
  { node: "couch", position: [1.72, 0, 0.1], rotationY: -Math.PI / 2 },
  // The second seat that turns "a sofa opposite a TV" into a conversation
  // corner. It floats on the rug's top edge with a walkway behind it -
  // furniture off the wall is how real rooms use their middle.
  { node: "loveseat", position: [0.25, 0, -1.28] },
  // Long axis parallel to the couch, like an oval coffee table actually sits.
  { node: "coffee_table", position: [0.15, 0, 0.3], rotationY: Math.PI / 2 },
  { node: "plant_table", position: [0.15, 0.347, 0.3], rotationY: Math.PI / 2 },
  // Touching the couch's front arm - a table nobody can reach is decoration.
  { node: "side_table", position: [1.75, 0, 1.32] },
  { node: "plant_side", position: [1.75, 0.416, 1.32] },

  // --- the back wall (-Z), left to right: sideboard+swatches, prints, window
  // The sideboard sits directly under the swatch row, so the paint decision
  // hangs over real furniture instead of floating on an empty wall.
  { node: "sideboard", position: [-1.35, 0, -HALF_D + 0.29] },
  { node: "desk_lamp", position: [-1.78, 0.654, -HALF_D + 0.31] },
  // The fish bowl balances the desk lamp on the sideboard's other end. Its
  // fish is a separate node (see FISH below) so the scene can animate it.
  // Quarter turn: the bowl's wide axis (0.297 m vs 0.211) runs along the
  // sideboard, not across it. The FISH below turns with it, or the fish
  // would swim through the glass.
  { node: "fish_bowl", position: [-0.95, 0.654, -HALF_D + 0.31], rotationY: Math.PI / 2 },
  // Review asked for a lamp in the bare back-left corner. A taller, different
  // model - matched lamps in opposite corners read as a hotel lobby.
  { node: "floor_lamp_b", position: [-2.32, 0, -HALF_D + 0.42] },
  { node: "window", position: [1.35, 1.3, -HALF_D + 0.06] },
  { node: "curtains", position: [1.35, 0.32, -HALF_D + 0.14] },
  // The monstera, where the light is. It had two companions once - a
  // white-globe floor lamp and a paddle-leaf cane - which overlapped from the
  // camera's angle into one convincing "cactus in a white pot". Review asked
  // for the cactus gone; both halves of the illusion went with it.
  { node: "houseplant", position: [2.05, 0, -1.6] },

  // --- the front-right corner ----------------------------------------------
  // The bushy one moved here from the doorway (review: a plant in front of a
  // door is a plant you water twice and then move). It fills the floor the
  // camera sees most of, beside the couch's far arm.
  { node: "plant_bushy", position: [2.1, 0, 1.85] },
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
 * The fish, split out of the bowl's GLB by `build-room.mjs` so it can swim.
 * Same coordinates as the bowl — the split preserves their shared origin, so
 * placing both at one spot nests the fish back inside the glass. The scene
 * bobs it a few millimetres on Y; everything else in the room holds still,
 * which is exactly what makes one small motion read as life.
 */
export const FISH: PropPlacement = {
  node: "fish",
  position: [-0.95, 0.654, -HALF_D + 0.31],
  // Matches the bowl's quarter turn exactly - shared origin, shared rotation
  // is what keeps the split pair nested.
  rotationY: Math.PI / 2,
};

/**
 * The three paint swatches, on the back wall at eye height. Not models —
 * quads, because the asset library has no wall art of any kind and a painted
 * rectangle is a painted rectangle.
 */
export const SWATCHES = {
  /** Candidate colors the beat cycles through, then abandons. Muted,
   *  interior-paint chips rather than primaries. */
  candidates: ["#b6bfae", "#cfae94", "#a8b8c6", "#c9a9a6"],
  /**
   * `null` means "the wall's own color" - which is a theme token now, read at
   * runtime by `RoomShell`, so it cannot be a hex here without forking from
   * dark mode.
   */
  bareWall: null as string | null,
  size: 0.42,
  gap: 0.16,
  origin: [-1.95, 1.45, -HALF_D + 0.05] as Vec3,
};

/**
 * A gallery pair over the sitting area - same size, same hanging height,
 * because matched frames are what "someone chose this" looks like. (The first
 * pass stacked two mismatched frames vertically, which read as leftovers.)
 */
export const PRINTS: { position: Vec3; size: [number, number] }[] = [
  { position: [-0.25, 1.5, -HALF_D + 0.05], size: [0.42, 0.52] },
  { position: [0.35, 1.5, -HALF_D + 0.05], size: [0.42, 0.52] },
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
  { position: [1.72, 0.045, 0.1], size: [1.3, 2.5] }, // couch
  { position: [0.25, 0.045, -1.28], size: [1.9, 1.0] }, // loveseat
  { position: [0.15, 0.045, 0.3], size: [0.95, 1.5] }, // coffee table
  { position: [-2.62, 0.012, 0.1], size: [0.8, 1.9] }, // console
  { position: [-1.35, 0.012, -2.01], size: [1.55, 0.75] }, // sideboard
  { position: [2.05, 0.012, -1.6], size: [1.2, 1.2] }, // houseplant
  { position: [2.1, 0.012, 1.85], size: [1.0, 1.0] }, // plant_bushy
  { position: [1.75, 0.012, 1.32], size: [0.75, 0.75] }, // side table
  { position: [-2.32, 0.012, -1.88], size: [0.65, 0.65] }, // floor lamp b
];
