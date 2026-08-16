import type { CivilDate, List, Tab, Todo, TodoStatus } from "@/lib/schema";
import { byPosition, positionForIndex, type Position } from "@/lib/ordering";
import { byPriorityThenPosition, openFirst } from "@/lib/priority";
import { matchesQuery, normalizeQuery } from "@/lib/search";
import {
  OVERFLOW,
  PLANNING,
  daysBetween,
  deriveColumn,
  type Placement,
  type PlacementContext,
} from "@/lib/scheduling";

/**
 * Turns a flat todo list into the two-half board layout.
 *
 * Kept separate from the components so the grouping rules stay testable and the
 * UI stays a rendering concern.
 */

/** Stable ids for droppable columns, encoded so a drop can be decoded back. */
export const dayColumnId = (day: CivilDate) => `day:${day}`;
export const overflowColumnId = () => `day:${OVERFLOW}`;
export const listColumnId = (listId: string) => `list:${listId}`;

/**
 * Draggable id for a list column's reorder handle.
 *
 * Deliberately a different id space from the column's droppable (`list:<id>`).
 * A column is a drop *target* for cards and a drag *source* for reordering, and
 * those must stay distinguishable: `active.id` tells the handlers which of the
 * two gestures is in flight, and the card path can keep resolving `list:` ids
 * exactly as it did.
 */
export const listDragId = (listId: string) => `listdrag:${listId}`;

/** The list id behind a reorder handle, or null if this is not one. */
export function parseListDragId(id: string): string | null {
  return id.startsWith("listdrag:") ? id.slice(9) : null;
}

/**
 * Tab strip ids. A tab pill is a drop target twice over — it accepts a dragged
 * tab for reordering, and it accepts a hovering card to focus itself — but it
 * is only ever dragged by its handle, so the two id spaces stay split exactly
 * as they are for list columns above.
 *
 * `tab:` must not be confused with a card id, and `tabdrag:` must not be
 * confused with `listdrag:`. Both are pinned by tests, because a namespace
 * collision here fails silently rather than loudly.
 */
export const tabDropId = (tabId: string) => `tab:${tabId}`;
export const tabDragId = (tabId: string) => `tabdrag:${tabId}`;

/** The tab id behind a pill droppable, or null if this is not one. */
export function parseTabDropId(id: string): string | null {
  return id.startsWith("tab:") ? id.slice(4) : null;
}

/** The tab id behind a tab reorder handle, or null if this is not one. */
export function parseTabDragId(id: string): string | null {
  return id.startsWith("tabdrag:") ? id.slice(8) : null;
}

/**
 * Droppable id for a list group inside a day column.
 *
 * A fifth id space, alongside `day:`/`list:`, `listdrag:`, `tab:`, `tabdrag:`,
 * and deliberately NOT folded into `parseColumnId`. A group and its column mean
 * different writes — "belongs to list X, still scheduled for D" versus "schedule
 * for D, keep whatever list it had" — so a `DropTarget` that answered
 * `{kind:"day"}` for a group id would silently take the column path.
 *
 * `|` rather than `:` as the separator: a CivilDate is `YYYY-MM-DD` and cannot
 * contain one, while a list id can contain colons (`seed:list:backlog`). Parsed
 * at the FIRST separator either way, so the key half may contain anything.
 */
export const dayGroupId = (day: CivilDate, key: string) => `daygroup:${day}|${key}`;

/** The day and list key behind a group droppable, or null if this is not one. */
export function parseDayGroupId(
  id: string,
): { day: CivilDate; key: string } | null {
  if (!id.startsWith("daygroup:")) return null;
  const rest = id.slice(9);
  const sep = rest.indexOf("|");
  if (sep < 0) return null;
  return { day: rest.slice(0, sep), key: rest.slice(sep + 1) };
}

/**
 * Droppable id for a COLLAPSED weekend strip, keyed by the run's first day.
 *
 * A sixth id space, and the only one that is a drop target without being a
 * drop destination: nothing ever lands in the strip. It registers a droppable
 * purely so a card hovering over it can be detected and the strip opened after
 * a dwell (see `WEEKEND_EXPAND_DWELL_MS` in board.tsx), at which point the real day
 * columns underneath become the actual targets.
 *
 * Deliberately NOT folded into `parseColumnId`: that function answering
 * anything for a weekend id would give `handleDragEnd` a column to write to,
 * and "scheduled for the weekend" is not a date. It MUST, however, be in
 * `isDropZoneId` below — an id that parses as neither a column nor a drop zone
 * is treated as a CARD everywhere, so leaving it out makes the strip's hover
 * resolve to a todo lookup that silently finds nothing.
 */
export const weekendColumnId = (firstDay: CivilDate) => `weekend:${firstDay}`;

/** The first day behind a weekend strip droppable, or null if this is not one. */
export function parseWeekendColumnId(id: string): CivilDate | null {
  return id.startsWith("weekend:") ? id.slice(8) : null;
}

export type DropTarget =
  | { kind: "day"; day: CivilDate }
  | { kind: "overflow" }
  | { kind: "list"; listId: string };

/** Decode a droppable id back into a drop target. */
export function parseColumnId(id: string): DropTarget | null {
  if (id.startsWith("day:")) {
    const value = id.slice(4);
    return value === OVERFLOW ? { kind: "overflow" } : { kind: "day", day: value };
  }
  if (id.startsWith("list:")) {
    return { kind: "list", listId: id.slice(5) };
  }
  return null;
}

/** True when an id refers to a column rather than a todo card. */
export function isColumnId(id: string): boolean {
  return parseColumnId(id) !== null;
}

/**
 * True for anything a card can be dragged onto that is not another card.
 *
 * Distinct from `isColumnId` because a tab pill is a drop zone without being a
 * column: nothing lands *in* it. Everything that resolves a card's drop target
 * must use this rather than `isColumnId`, or a tab pill gets mistaken for a
 * card and looked up in the todo list, where it is silently not found.
 *
 * A day group is the third kind, and forgetting it here is the same silent
 * failure: `preferPreciseTarget` would classify the group id as a card,
 * `handleDragEnd` would look it up in `todos`, find nothing, and return — a drop
 * that does nothing at all, with no error anywhere.
 *
 * A collapsed weekend strip is the fourth kind, and the same rule applies for
 * the same reason — see `weekendColumnId` above for why it belongs here but
 * deliberately not in `parseColumnId`.
 */
export function isDropZoneId(id: string): boolean {
  return (
    isColumnId(id) ||
    parseTabDropId(id) !== null ||
    parseDayGroupId(id) !== null ||
    parseWeekendColumnId(id) !== null
  );
}

/**
 * Pick the most specific droppable from a set of collisions.
 *
 * Precedence is card, then group, then column — stated rather than left to
 * geometry, because the three mean different writes:
 *
 *   card   — a precise insertion point (planning half only; a day column's cards
 *            are not droppables at all, see board-column.tsx)
 *   group  — "belongs to this list, still scheduled for this day"
 *   column — "append here" / "schedule here, keep whatever list it had"
 *
 * `pointerWithin` sorts by mean corner distance, which puts the smaller nested
 * rect first *most* of the time — a short group near the top of a tall column can
 * lose to the column itself. Leaving that to geometry would make one gesture mean
 * two different things depending on where in the column the group happens to sit,
 * and the keyboard path has no pointer at all.
 */
export function preferPreciseTarget<T extends { id: string | number }>(
  collisions: readonly T[],
): T | null {
  if (collisions.length === 0) return null;
  const card = collisions.find((c) => !isDropZoneId(String(c.id)));
  if (card) return card;
  const group = collisions.find((c) => parseDayGroupId(String(c.id)) !== null);
  return group ?? collisions[0];
}

export interface ListDropPlan {
  /** The fractional index to write onto the dragged list. */
  position: Position;
  /** Which edge of the hovered column the insertion bar belongs on. */
  side: "before" | "after";
}

/**
 * Resolve where a dragged list column lands.
 *
 * Direction decides the side, the way every sortable list does it: dragging a
 * column *rightwards* onto another means "go after it", leftwards means "go
 * before it". Without that, hovering a column could only ever mean "insert
 * before", and the last slot would be unreachable — you could never drag a
 * column to the end.
 *
 * **Backlog is structurally pinned leftmost.** It is filtered out of the
 * movable set entirely and only ever used as the lower bound for the first
 * slot, so no arithmetic here can produce a key below it. That is stronger than
 * clamping an index: there is no path through this function that displaces it.
 *
 * `lists` must be sorted by position. Returns null for a no-op — dropping a
 * column on itself, or dragging Backlog, which has no handle to begin with.
 */
export function planListDrop(
  lists: readonly List[],
  draggedId: string,
  overListId: string,
): ListDropPlan | null {
  const dragged = lists.find((l) => l.id === draggedId);
  if (!dragged || dragged.isBacklog) return null;

  const backlog = lists.find((l) => l.isBacklog);
  const movable = lists.filter((l) => !l.isBacklog);
  const fromIndex = movable.findIndex((l) => l.id === draggedId);
  if (fromIndex < 0) return null;

  // The dragged column must not be one of its own neighbours — same rule as
  // reordering todos.
  const remaining = movable.filter((l) => l.id !== draggedId);

  let index: number;
  let side: ListDropPlan["side"];

  if (backlog && overListId === backlog.id) {
    // Dropping on Backlog means "as far left as allowed", which is just after it.
    index = 0;
    side = "after";
  } else {
    const overIndex = remaining.findIndex((l) => l.id === overListId);
    if (overIndex < 0) return null; // dropped on itself, or an unknown column
    const movingRight = fromIndex < movable.findIndex((l) => l.id === overListId);
    index = movingRight ? overIndex + 1 : overIndex;
    side = movingRight ? "after" : "before";
  }

  // Backlog rides along as the floor for the first slot, so the leftmost
  // reachable key is always above it.
  const ordered = backlog ? [backlog, ...remaining] : remaining;
  return { position: positionForIndex(ordered, index + (backlog ? 1 : 0)), side };
}

/**
 * Resolve where a dragged tab lands.
 *
 * The same direction rule as `planListDrop` — dragging rightwards onto a tab
 * means "go after it" — which is what keeps the last slot reachable. Simpler
 * than the list version because tabs have no pinned member: the default tab is
 * undeletable, not immovable.
 *
 * `tabs` must be sorted by position. Returns null for a no-op.
 */
export function planTabDrop(
  tabs: readonly Tab[],
  draggedId: string,
  overTabId: string,
): ListDropPlan | null {
  const fromIndex = tabs.findIndex((t) => t.id === draggedId);
  if (fromIndex < 0) return null;

  // The dragged tab must not be one of its own neighbours.
  const remaining = tabs.filter((t) => t.id !== draggedId);
  const overIndex = remaining.findIndex((t) => t.id === overTabId);
  if (overIndex < 0) return null; // dropped on itself, or an unknown tab

  const movingRight = fromIndex < tabs.findIndex((t) => t.id === overTabId);
  return {
    position: positionForIndex(remaining, movingRight ? overIndex + 1 : overIndex),
    side: movingRight ? "after" : "before",
  };
}

export interface ListTabMovePlan {
  /** The fractional index to write onto the dragged list. */
  position: Position;
  /** The tab id to write onto `list.tabId`. */
  tabId: string;
}

/**
 * Resolve where a list column lands when it is moved to a DIFFERENT tab —
 * dragged onto a tab pill (EI-115's dwell, mirroring §4.10b's card version),
 * or dropped among a destination tab's columns after that dwell has already
 * switched the active tab.
 *
 * `planListDrop`'s "which side of the target" direction rule assumes both
 * columns render in the same track, so it can compare their positions to see
 * which way the pointer moved. That comparison is meaningless once the two
 * columns live on different tabs — the dragged column isn't a member of the
 * destination tab's own ordering at all, so there is no "direction" to read.
 * This always lands AFTER the hovered column instead, the same convention
 * `planListDrop` already uses for "dropped on Backlog" (`§4.10`): arriving
 * content, not a neighbour changing places.
 *
 * `overListId: null` means "dropped directly on the pill", which lands at the
 * END of the destination tab's track — the only way to reach the last slot
 * cross-tab, since there is no on-screen column past it to drag rightwards
 * onto. A real list id (including Backlog's own id, meaning "as far left as
 * allowed") behaves like `planListDrop`'s Backlog case, scoped to the
 * destination tab.
 *
 * `lists` is the GLOBAL list array (every tab), matching `planListDrop`'s and
 * `planTabDrop`'s contract — this function does the tab-scoping itself via
 * `destinationTabId`, rather than requiring the caller to pre-filter.
 */
export function planListTabDrop(
  lists: readonly List[],
  draggedId: string,
  destinationTabId: string,
  overListId: string | null,
): ListTabMovePlan | null {
  const dragged = lists.find((l) => l.id === draggedId);
  if (!dragged || dragged.isBacklog) return null;

  const backlog = lists.find((l) => l.isBacklog);
  const movable = lists.filter((l) => !l.isBacklog && l.tabId === destinationTabId);
  const ordered = backlog ? [backlog, ...movable] : movable;

  if (overListId === null) {
    return { position: positionForIndex(ordered, ordered.length), tabId: destinationTabId };
  }

  if (backlog && overListId === backlog.id) {
    return { position: positionForIndex(ordered, 1), tabId: destinationTabId };
  }

  const overIndex = movable.findIndex((l) => l.id === overListId);
  if (overIndex < 0) return null; // dropped on an unknown column

  return {
    position: positionForIndex(ordered, overIndex + 1 + (backlog ? 1 : 0)),
    tabId: destinationTabId,
  };
}

/**
 * "To " is a filing artefact, not part of the name.
 *
 * "To Buy", "To Read" and "To Watch" would otherwise all sort under T and the
 * alphabet would do no work at all — the entire reason to sort group headers is
 * that the eye can find one without reading all of them.
 *
 * Only the WORD "To" followed by whitespace is stripped, which is why this is
 * `^to\s+` and not `^to`: "Tomorrow", "Today" and "Together" keep their T. `\s`
 * rather than a literal space covers a pasted non-breaking space, and `+`
 * collapses "To  Buy". A list named exactly "To" keeps its name — an empty sort
 * key would sort before every other group and pin it to the top forever.
 */
const TO_PREFIX = /^to\s+/i;

export function listSortKey(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed.replace(TO_PREFIX, "");
  return stripped.length > 0 ? stripped : trimmed;
}

/**
 * One collator, built once at module scope.
 *
 * `localeCompare` is the same algorithm with a per-call options object, and
 * constructing the collator is the expensive half. This runs once per group per
 * column and up to 365 day columns can be rendered, so the instance is hoisted.
 *
 * `sensitivity: "base"` is what lands "to buy" and "To Buy" in the same place —
 * case- and accent-insensitive, so "Café" sorts with "Cafe" rather than after
 * "Z". `numeric: true` puts "Week 2" before "Week 10", which plain lexicographic
 * ordering gets backwards. No explicit locale: the user's own is the right one,
 * and nothing here is persisted, so a locale change cannot corrupt stored order.
 */
const COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export function byListGroup(a: TodoGroup, b: TodoGroup): number {
  const byName = COLLATOR.compare(a.sortKey, b.sortKey);
  if (byName !== 0) return byName;
  /*
    Two lists can legitimately share a sort key — "To Buy" and "Buy", or two
    lists both named "Errands". Falling through to the key makes the order TOTAL
    rather than dependent on which todo happened to be encountered first, which
    would otherwise flip between renders.
  */
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * A run of cards in a computed column that share one originating list.
 *
 * Deliberately NOT `{ list: List }`. `key`, `name` and `color` are the only
 * facts a group header renders, and keeping the shape free of `List` is what
 * would make a second grouping mode — by priority, say — a matter of filling
 * these three fields rather than teaching the header a second domain. Only the
 * drop path resolves `key` back to a list, because only the drop path cares.
 */
export interface TodoGroup {
  /** Droppable id — see `dayGroupId`. */
  id: string;
  /** Stable identity for collapse state and for the drop write. A list id today. */
  key: string;
  /** Header text: the list's name, verbatim, "To " and all. */
  name: string;
  /** Accent for the header rule and the card wash. Null for an uncolored list. */
  color: string | null;
  /** What the alphabet actually sorts on. See `listSortKey`. */
  sortKey: string;
  /** P1 → P4 then unprioritised, `position` breaking ties. */
  todos: Todo[];
}

export interface DayColumn {
  id: string;
  day: CivilDate;
  /**
   * Every card in the column, in RENDERED order.
   *
   * DERIVED from `groups`, never sorted independently. One source of truth for
   * order is the whole point: the arrow keys read this, the drop path reads this,
   * the filler-row arithmetic reads this, and `findColumn` reads this. Two arrays
   * sorted by two comparators is exactly how "the eye sees one order and Tab
   * walks another" gets shipped.
   */
  todos: Todo[];
  /** Empty groups are never emitted, so `groups.length` is the header count. */
  groups: TodoGroup[];
}

/** Overflow is the same computed shape, minus a date. It refuses drops. */
export interface OverflowColumn {
  id: string;
  todos: Todo[];
  groups: TodoGroup[];
}

export interface ListColumn {
  id: string;
  list: List;
  todos: Todo[];
}

export interface BoardModel {
  days: DayColumn[];
  overflow: OverflowColumn;
  /** Unchanged: the planning half is arranged by hand — no groups, no wash. */
  lists: ListColumn[];
  /** Scheduled but outside the visible window — rendered dimmed in its list. */
  awayTodoIds: Set<string>;
}

/**
 * Narrows a grouped column (a day, or Overflow) to `query`, for the in-column
 * filter — a RENDER-ONLY view. Never feed this into a drop calculation:
 * fractional positions are computed from the true board, not from what a
 * query happens to match.
 *
 * Returns the same reference for an empty query, so an unfiltered board's
 * memos and nav grid never churn.
 */
export function filterComputedColumn<C extends { todos: Todo[]; groups: TodoGroup[] }>(
  column: C,
  query: string,
): C {
  const q = normalizeQuery(query);
  if (!q) return column;
  // `groups.length === 0` is buildBoard's degenerate no-lists fallback, where
  // the flat array is the column's real contents — see BoardColumn's `grouped`.
  if (column.groups.length === 0) {
    return { ...column, todos: column.todos.filter((t) => matchesQuery(t, q)) };
  }
  // A group emptied by the filter is dropped — a header over nothing lies
  // about the column's shape.
  const groups = column.groups
    .map((group) => ({ ...group, todos: group.todos.filter((t) => matchesQuery(t, q)) }))
    .filter((group) => group.todos.length > 0);
  // `todos` stays DERIVED from `groups`, matching DayColumn's own contract —
  // the render, the nav grid and the filler-row arithmetic all read `todos`.
  return { ...column, groups, todos: groups.flatMap((group) => group.todos) };
}

/** The flat-column sibling of `filterComputedColumn`, for Backlog and custom lists. */
export function filterListColumn(column: ListColumn, query: string): ListColumn {
  const q = normalizeQuery(query);
  if (!q) return column;
  return { ...column, todos: column.todos.filter((t) => matchesQuery(t, q)) };
}

/**
 * Partition one computed column's cards by originating list.
 *
 * `index` must cover EVERY list that can own a scheduled card — the rendered
 * tab's lists plus the hidden ones — not just the columns on screen.
 */
function groupTodosByList(
  todos: readonly Todo[],
  day: CivilDate,
  index: ReadonlyMap<string, List>,
  backlog: List | undefined,
): TodoGroup[] {
  const buckets = new Map<string, { list: List; todos: Todo[] }>();

  for (const todo of todos) {
    // The same `?? backlog` rule the planning half uses: no list, or a pointer
    // at a deleted one, files under Backlog rather than vanishing.
    const list = (todo.listId ? index.get(todo.listId) : undefined) ?? backlog;
    /*
      Degenerate only — no lists at all, which the board's loading gate makes
      unreachable in the app but which this function's other callers can produce.
      Returning no groups leaves the column's flat `todos` to render, so cards are
      never dropped on the floor.
    */
    if (!list) return [];
    const bucket = buckets.get(list.id);
    if (bucket) bucket.todos.push(todo);
    else buckets.set(list.id, { list, todos: [todo] });
  }

  return [...buckets.values()]
    .map(({ list, todos: bucket }) => ({
      id: dayGroupId(day, list.id),
      key: list.id,
      name: list.name,
      color: list.color,
      sortKey: listSortKey(list.name),
      todos: bucket.sort(openFirst(byPriorityThenPosition)),
    }))
    .sort(byListGroup);
}

/** What `buildBoard` filters to when no `visibleStatuses` is given. */
const DEFAULT_VISIBLE_STATUSES: readonly TodoStatus[] = ["open"];

/**
 * Where a settled (`done`/`dropped`) todo renders. Null means "nowhere".
 *
 * Deliberately NOT `deriveColumn`. Every rule that function applies is about
 * work you still owe — rolling a miss forward to today, dropping it into
 * Overflow once it has been put off too long, surfacing it in its list when it
 * falls outside the window. Run any of them on a finished todo and the result
 * is nonsense: a task you completed last Tuesday reappearing in "Put off too
 * long" reads as an accusation, and it would push genuinely stale work down
 * the column to make room.
 *
 * So the rule here is the simple one — a settled todo sits on the day it was
 * scheduled for, or in its list if it never was.
 *
 * Out-of-window settled work returns null rather than the planning half's
 * `awayDate` treatment. That fallback exists to keep a todo you still have to
 * do reachable; applying it here would pour months of finished cards into the
 * lists, which is the one place they would drown live work.
 */
function placeSettled(
  todo: Pick<Todo, "scheduledDate">,
  ctx: PlacementContext,
): Placement | null {
  if (!todo.scheduledDate) return { half: PLANNING, awayDate: null };
  const offset = daysBetween(ctx.today, todo.scheduledDate);
  if (offset < 0 || offset >= ctx.visibleWindow.length) return null;
  return { half: "calendar", day: todo.scheduledDate };
}

export interface BuildBoardOptions {
  /** Which statuses render. Defaults to unfinished work only. */
  visibleStatuses?: readonly TodoStatus[];
  /**
   * Rendered directly in Overflow, bypassing `deriveColumn`/`placeSettled`
   * entirely — used for a recurring occurrence that must overflow the moment
   * it is overdue, skipping the ordinary multi-day rollover grace period. See
   * `lib/recurrence-expand.ts`. Must not also appear in `todos`, or it
   * renders twice.
   */
  forceOverflow?: readonly Todo[];
}

/**
 * Group todos into columns.
 *
 * `visibleStatuses` decides which statuses reach the board at all, defaulting
 * to `["open"]` — the behaviour this had unconditionally before it was a
 * setting. Settled work (`done`/`dropped`) takes a DIFFERENT placement path:
 * see `placeSettled` below for why it must not go through `deriveColumn`.
 *
 * `lists` is the columns to render: the active tab's lists plus Backlog.
 * `hiddenLists` is the live lists on OTHER tabs. The two are separate on
 * purpose — see the planning branch below for why a hidden list cannot simply
 * be left out of `lists`.
 *
 * `hiddenLists` carries RECORDS rather than ids, and that is load bearing now
 * that day columns group by list. The calendar branch below runs before the tab
 * check, so a day column routinely holds a card whose list is not in `lists` at
 * all — grouping it needs that list's name and colour. With ids alone, every
 * other tab's scheduled work would group under Backlog, indistinguishable from a
 * genuinely homeless todo, and a drop on that header would then REWRITE its
 * `listId` to Backlog's.
 */
export function buildBoard(
  todos: Todo[],
  lists: List[],
  ctx: PlacementContext,
  hiddenLists: readonly List[] = [],
  { visibleStatuses = DEFAULT_VISIBLE_STATUSES, forceOverflow = [] }: BuildBoardOptions = {},
): BoardModel {
  const shown = new Set(visibleStatuses);
  const visible = todos.filter((t) => shown.has(t.status));
  const hiddenListIds = new Set(hiddenLists.map((l) => l.id));

  const days: DayColumn[] = ctx.visibleWindow.map((day) => ({
    id: dayColumnId(day),
    day,
    todos: [],
    groups: [],
  }));
  const dayIndex = new Map(days.map((d) => [d.day, d]));

  const overflow: OverflowColumn = {
    id: overflowColumnId(),
    todos: [],
    groups: [],
  };

  const listColumns: ListColumn[] = lists.map((list) => ({
    id: listColumnId(list.id),
    list,
    todos: [],
  }));
  const listIndex = new Map(listColumns.map((c) => [c.list.id, c]));
  const backlog = listColumns.find((c) => c.list.isBacklog) ?? listColumns[0];

  const awayTodoIds = new Set<string>();

  for (const todo of visible) {
    const placement =
      todo.status === "open" ? deriveColumn(todo, ctx) : placeSettled(todo, ctx);

    if (placement === null) continue;

    if (placement.half === "calendar") {
      if (placement.day === OVERFLOW) {
        overflow.todos.push(todo);
      } else {
        dayIndex.get(placement.day)?.todos.push(todo);
      }
      continue;
    }

    /**
     * A todo whose list lives on another tab is not on this board.
     *
     * This has to be an explicit check rather than "its column is absent",
     * because the Backlog fallback below cannot tell the two cases apart: it
     * exists to rescue orphans of a *deleted* list, and would otherwise pile
     * every other tab's todos into Backlog — the one place they must not go,
     * since Backlog is shared by every tab.
     *
     * It sits after the calendar branch above deliberately. Scheduling is not a
     * tab-level concern: a todo scheduled to Thursday shows on Thursday no
     * matter which tab is open, and only its unscheduled siblings disappear
     * with their column.
     */
    if (todo.listId && hiddenListIds.has(todo.listId)) continue;

    if (placement.awayDate) awayTodoIds.add(todo.id);

    // A todo with no list (or one pointing at a deleted list) falls back to
    // Backlog rather than disappearing from the board entirely.
    const column = (todo.listId ? listIndex.get(todo.listId) : undefined) ?? backlog;
    column?.todos.push(todo);
  }

  for (const todo of forceOverflow) {
    if (!shown.has(todo.status)) continue;
    overflow.todos.push(todo);
  }

  /*
    THE TWO HALVES ORDER DIFFERENTLY, and that is the thesis of the design:
    the planning half is arranged by hand, the calendar half is computed.

    So `position` means an ORDER below and only a TIEBREAKER above. Nothing is
    destroyed by that — a hand-arranged day column simply reshuffles into groups
    the first time this runs.
  */
  const groupIndex = new Map<string, List>([
    ...lists.map((l) => [l.id, l] as const),
    ...hiddenLists.map((l) => [l.id, l] as const),
  ]);
  // Backlog as a record rather than a column, for the grouping fallback. Same
  // lookup as the column above, and note Backlog is NOT pinned first among
  // groups the way it is pinned leftmost among columns — it sorts under B like
  // any other list, which is deliberate.
  const backlogList = lists.find((l) => l.isBacklog) ?? lists[0];

  const applyGroups = (column: DayColumn | OverflowColumn, day: CivilDate) => {
    column.groups = groupTodosByList(column.todos, day, groupIndex, backlogList);
    column.todos =
      column.groups.length > 0
        ? column.groups.flatMap((g) => g.todos)
        : column.todos.sort(openFirst(byPriorityThenPosition));
  };

  for (const day of days) applyGroups(day, day.day);
  // Overflow groups under the OVERFLOW sentinel as its "day", so its group ids
  // stay unique against every real date. Nothing drops on them.
  applyGroups(overflow, OVERFLOW);

  for (const column of listColumns) column.todos.sort(openFirst(byPosition));

  return { days, overflow, lists: listColumns, awayTodoIds };
}
