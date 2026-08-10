/**
 * Arrow-key navigation across the board, as data.
 *
 * The board is a grid: two rows of columns (the calendar half and the planning
 * half), and every column is an ordered list of *stops* running top to bottom —
 * its to-do cards, then its quick-add field. Moving focus is therefore pure
 * index arithmetic over that grid, which is what lives here. Finding the DOM
 * node and actually moving focus is `use-column-nav.ts`; see docs/KEYBOARD.md.
 *
 * Deliberately NOT rows in the hotkey registry. `hotkeys.tsx` sets
 * `preventDefault: true` unconditionally, so a global arrow binding would stomp
 * caret motion, the rail handle's nudge, dnd-kit's keyboard drag and cmdk's
 * palette list. KEYBOARD.md §2 already prescribes local handlers for this.
 */

import type { ModifierState } from "./keyboard";

/** The end-of-track "Create list" button. One stop, no cards. */
export const NAV_CREATE_LIST = "nav:create-list";
/** The end-of-track "Load N more days" tile. Present only while it renders. */
export const NAV_LOAD_MORE = "nav:load-more";

/** Stop id for a to-do card. Written onto the row as `data-nav-stop`. */
export function cardStop(todoId: string): string {
  return `todo:${todoId}`;
}

/** Stop id for a column's quick-add field, keyed by the column's droppable id. */
export function addStop(columnId: string): string {
  return `add:${columnId}`;
}

const NAV_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;

export type NavKey = (typeof NAV_KEYS)[number];

export function isNavKey(key: string): key is NavKey {
  return (NAV_KEYS as readonly string[]).includes(key);
}

/**
 * The navigation key for a bare arrow press, or null for anything else.
 *
 * Modifiers are rejected in the spirit of `hasExactModifiers` (KEYBOARD.md
 * §4.4): ⌥← is word-jump and ⌘← is line-start inside a text field, ⇧← extends a
 * selection, and swallowing any of them would be a silent regression.
 */
export function navKeyOf(event: ModifierState & { key: string }): NavKey | null {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  return isNavKey(event.key) ? event.key : null;
}

export type NavRow = "calendar" | "planning";

export interface NavColumn {
  /** The column's droppable id, or a `nav:` sentinel. Used for last-visited. */
  key: string;
  /** Cards top to bottom, then the quick-add. Empty means unreachable. */
  stops: string[];
  /** True when the LAST stop is a quick-add — the anchor `resolve` preserves. */
  hasQuickAdd: boolean;
}

export interface NavGrid {
  calendar: NavColumn[];
  planning: NavColumn[];
  /** Where a cross-row move lands when the other row has not been visited. */
  defaults: { calendar: string | null; planning: string | null };
}

/** The column focus was last in, per row. Null until that row is first visited. */
export interface LastVisited {
  calendar: string | null;
  planning: string | null;
}

export interface NavColumnInput {
  /** The column's droppable id — `day:2026-08-07`, `list:<id>`. */
  id: string;
  todoIds: string[];
}

export interface BuildNavGridInput {
  /** Null while the Overflow rail is collapsed. */
  overflow: NavColumnInput | null;
  /** Day columns in track order; index 0 is always today. */
  days: NavColumnInput[];
  hasLoadMore: boolean;
  /** Null while the Backlog rail is collapsed, or before bootstrap. */
  backlog: NavColumnInput | null;
  lists: NavColumnInput[];
}

function toColumn(input: NavColumnInput, hasQuickAdd: boolean): NavColumn {
  const stops = input.todoIds.map(cardStop);
  if (hasQuickAdd) stops.push(addStop(input.id));
  return { key: input.id, stops, hasQuickAdd };
}

function sentinel(key: string): NavColumn {
  return { key, stops: [key], hasQuickAdd: false };
}

export function buildNavGrid(input: BuildNavGridInput): NavGrid {
  const calendar: NavColumn[] = [];
  /*
    Overflow gets no quick-add — nothing can be scheduled INTO it, only out of
    it — so an empty Overflow contributes no stops at all. `←` from today then
    does nothing rather than parking focus on a field that discards what you
    type into it.
  */
  if (input.overflow) calendar.push(toColumn(input.overflow, false));
  for (const day of input.days) calendar.push(toColumn(day, true));
  if (input.hasLoadMore) calendar.push(sentinel(NAV_LOAD_MORE));

  const planning: NavColumn[] = [];
  if (input.backlog) planning.push(toColumn(input.backlog, true));
  for (const list of input.lists) planning.push(toColumn(list, true));
  planning.push(sentinel(NAV_CREATE_LIST));

  return {
    calendar,
    planning,
    /*
      Today, not Overflow: crossing halves should land somewhere you can type.
      Backlog for the same reason, falling through to the first list and then
      to Create list, the one planning stop that always exists.
    */
    defaults: {
      calendar: input.days[0]?.id ?? null,
      planning: input.backlog?.id ?? input.lists[0]?.id ?? NAV_CREATE_LIST,
    },
  };
}

interface Located {
  row: NavRow;
  col: number;
  idx: number;
}

function locate(grid: NavGrid, stop: string): Located | null {
  for (const row of ["calendar", "planning"] as const) {
    const columns = grid[row];
    for (let col = 0; col < columns.length; col++) {
      const idx = columns[col].stops.indexOf(stop);
      if (idx !== -1) return { row, col, idx };
    }
  }
  return null;
}

/** The row and column a stop belongs to — how the caller updates last-visited. */
export function stopLocation(
  grid: NavGrid,
  stop: string,
): { row: NavRow; columnKey: string } | null {
  const at = locate(grid, stop);
  return at ? { row: at.row, columnKey: grid[at.row][at.col].key } : null;
}

/**
 * The column a cross-row move lands in: the one you were last in, else the
 * row's default, else the first column with anything in it.
 *
 * Tried in that order rather than collapsing the first two — a remembered
 * column can go stale (an archived list, a day scrolled past the horizon), and
 * falling straight through to "first with stops" would land on Overflow
 * instead of today.
 */
function crossColumn(
  columns: NavColumn[],
  remembered: string | null,
  fallback: string | null,
): NavColumn | null {
  for (const key of [remembered, fallback]) {
    if (!key) continue;
    const found = columns.find((c) => c.key === key);
    if (found && found.stops.length > 0) return found;
  }
  return columns.find((c) => c.stops.length > 0) ?? null;
}

/**
 * Where `key` moves focus from `current`, or null when there is nowhere to go.
 *
 * Two rules do the work:
 *
 * - **No wrapping.** `↓` on a planning quick-add is the bottom of the board and
 *   `↑` on a calendar column's first card is the top; `←` on the leftmost
 *   column and `→` on the rightmost do nothing.
 * - **Anchor preservation.** Leaving a quick-add lands on the target's
 *   quick-add; leaving a card lands on the same card index, clamped. Without it
 *   `→` out of an empty column into a thirty-card one would dump you on card
 *   one instead of the field you were typing in.
 */
export function resolveNavTarget(
  grid: NavGrid,
  current: string,
  key: NavKey,
  lastVisited: LastVisited,
): string | null {
  const at = locate(grid, current);
  if (!at) return null;

  const columns = grid[at.row];
  const column = columns[at.col];
  const last = column.stops.length - 1;
  const onQuickAdd = column.hasQuickAdd && at.idx === last;

  if (key === "ArrowUp") {
    if (at.idx > 0) return column.stops[at.idx - 1];
    if (at.row === "calendar") return null; // Top of the board.
    const target = crossColumn(grid.calendar, lastVisited.calendar, grid.defaults.calendar);
    // Coming up from below, land on the bottom of the column above.
    return target ? target.stops[target.stops.length - 1] : null;
  }

  if (key === "ArrowDown") {
    if (at.idx < last) return column.stops[at.idx + 1];
    if (at.row === "planning") return null; // Bottom of the board.
    const target = crossColumn(grid.planning, lastVisited.planning, grid.defaults.planning);
    if (!target) return null;
    return onQuickAdd ? target.stops[target.stops.length - 1] : target.stops[0];
  }

  const next = columns[at.col + (key === "ArrowRight" ? 1 : -1)];
  // A column with no stops is a wall, not something to skip past — otherwise
  // `←` from today would silently vault over an empty Overflow into nothing.
  if (!next || next.stops.length === 0) return null;
  return onQuickAdd
    ? next.stops[next.stops.length - 1]
    : next.stops[Math.min(at.idx, next.stops.length - 1)];
}
