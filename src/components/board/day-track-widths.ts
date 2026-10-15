import type { CSSProperties } from "react";

/**
 * The day track's column widths (EI-384) — pure, so the rule is testable
 * without a layout engine. See docs/DESIGN.md §3 and the `--column-today-ratio`
 * comment in globals.css.
 *
 * Three kinds of day column:
 *
 *   today — `--column-today`, `--column-today-ratio` (1.5) times a near column.
 *   near  — the other days on Today's first page (days 1..N-1), `--column-near`.
 *           Today's extra width comes out of these, so today + the near days
 *           fill the track exactly, the same as N equal columns used to.
 *   far   — every day after that, `--column-min`/`--column-max` exactly as
 *           before: N equal columns filling the track. So a page jumped ahead
 *           (Week/Month/Quarter, which step in whole pages of N) shows N equal
 *           columns, and Today, out of view, is not widening anything.
 *
 * Every width keeps `--column-floor` as its floor, and Today is ALWAYS the
 * ratio times its neighbor, floor or not. When the floor binds (a 7-day view
 * on any window under ~1600px) near == far == the floor, so Today is the only
 * column that changes; the track simply scrolls a little sooner.
 *
 * `wide` is false on tablet: there the track is too narrow for a 1.5x column
 * to leave room for anything else, and docs/MOBILE.md keeps tablet as-is.
 */
export type DayColumnWidth = "today" | "near" | "far";

/** The 12px `gap-3` between day columns. Keep in step with the track's class. */
export const DAY_GAP_PX = 12;

/** Which width a day column takes. `index` is days from today (0 = today). */
export function dayColumnWidth(index: number, visibleDays: number, wide: boolean): DayColumnWidth {
  if (!wide) return "far";
  if (index === 0) return "today";
  return index > 0 && index < visibleDays ? "near" : "far";
}

/**
 * Classes that point a column's own `--column-min`/`--column-max` (which
 * BoardColumn reads for its rigid width) at the right track variable. A far
 * column needs none: it inherits the track's.
 */
export const DAY_COLUMN_WIDTH_CLASS: Record<DayColumnWidth, string | undefined> = {
  today: "[--column-min:var(--column-today)] [--column-max:var(--column-today)]",
  near: "[--column-min:var(--column-near)] [--column-max:var(--column-near)]",
  far: undefined,
};

/**
 * The track's inline variables. `100%` resolves where a column USES the
 * variable (its min-/max-width), against the track's content box — which is
 * why these are token streams on the track rather than computed pixels.
 *
 * Min == max for every kind, so columns are rigid: that is what lets
 * `pageAlignedJump` (date-nav.tsx) land a jump exactly on a page boundary.
 */
export function dayTrackStyle(visibleDays: number, wide: boolean): CSSProperties {
  const gaps = (visibleDays - 1) * DAY_GAP_PX;
  const far = `max(var(--column-floor), calc((100% - ${gaps}px) / ${visibleDays}))`;
  const style: Record<string, string> = { "--column-min": far, "--column-max": far };
  if (wide) {
    // N - 1 near columns plus one Today worth `ratio` of them share the same
    // space N equal columns did.
    style["--column-near"] =
      `max(var(--column-floor), calc((100% - ${gaps}px) / (${visibleDays - 1} + var(--column-today-ratio))))`;
    style["--column-today"] = "calc(var(--column-near) * var(--column-today-ratio))";
  }
  return style as CSSProperties;
}
