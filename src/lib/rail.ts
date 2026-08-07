/**
 * Sizing for the pinned rail panels — Overflow and Backlog, see board.tsx's
 * `PINNED_PANEL` and `use-rail-resize.ts`. Lives here, not in a component
 * file, so `schema.ts` can bound the stored width against the same numbers
 * without importing from `components/`.
 */

/** Matches `--column-min`: a rail can never be narrower than a day column while expanded. */
export const RAIL_MIN = 168;
/** Matches `--column-max`. */
export const RAIL_MAX = 480;
/** Matches `--list-column-min` — the CSS default a rail renders at before it is ever resized. */
export const RAIL_DEFAULT_WIDTH = RAIL_MIN + 50;
/** Width of a collapsed rail — just enough for a vertical label and a count. */
export const RAIL_COLLAPSED_WIDTH = 40;
/**
 * Dragging narrower than this snaps to collapsed instead of clamping at
 * `RAIL_MIN` — the VS Code gesture, and it means collapsing needs no
 * separate affordance to discover.
 */
export const RAIL_COLLAPSE_THRESHOLD = RAIL_MIN - 40;
/** Arrow-key resize step, in pixels. */
export const RAIL_NUDGE = 16;
