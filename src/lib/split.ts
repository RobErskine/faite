/**
 * Sizing for the vertical split between the calendar half and the planning
 * half — see board.tsx's two `flex` halves and `use-split-resize.ts`. Lives
 * here, not in a component file, so `schema.ts` can bound the stored ratio
 * against the same numbers without importing from `components/`. Mirrors
 * `lib/rail.ts`, rotated 90°: a percent of the split instead of a pixel
 * width, because the two things it measures against (a half's rendered
 * height, not a fixed column) only exist once the board has laid out.
 */

/** Percent of the split the calendar half gets — mirrors --split-top in globals.css. */
export const SPLIT_DEFAULT = 56;
/** A half must still fit a column header and a card or two while expanded. */
export const SPLIT_MIN = 200;
/**
 * Dragging a half shorter than this snaps it to collapsed instead of
 * clamping at `SPLIT_MIN` — the VS Code gesture `lib/rail.ts` already uses,
 * so collapsing needs no separate affordance to discover.
 */
export const SPLIT_COLLAPSE_THRESHOLD = SPLIT_MIN - 60;
/** Height of a collapsed half — just enough for a label and a count. */
export const SPLIT_COLLAPSED_HEIGHT = 40;
/**
 * Schema sanity bounds on the stored percent. `SPLIT_MIN` (a pixel floor) is
 * the real runtime protection — these just keep a corrupt or hand-edited
 * value from being an unusable 0 or 100.
 */
export const SPLIT_MIN_PERCENT = 10;
export const SPLIT_MAX_PERCENT = 90;
/** Arrow-key resize step, in pixels. */
export const SPLIT_NUDGE = 16;
