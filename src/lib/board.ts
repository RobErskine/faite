import type { CivilDate, List, Tab, Todo } from "@/lib/schema";
import { byPosition, positionForIndex, type Position } from "@/lib/ordering";
import { OVERFLOW, deriveColumn, type PlacementContext } from "@/lib/scheduling";

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
 */
export function isDropZoneId(id: string): boolean {
  return isColumnId(id) || parseTabDropId(id) !== null;
}

/**
 * Pick the most specific droppable from a set of collisions.
 *
 * The pointer is usually inside both a card and the column containing it. The
 * card is the better answer: it gives a precise insertion point, whereas the
 * column only means "append to the end". Falling back to the column when no
 * card is present is what makes empty space anywhere in a column a valid drop.
 */
export function preferPreciseTarget<T extends { id: string | number }>(
  collisions: readonly T[],
): T | null {
  if (collisions.length === 0) return null;
  const card = collisions.find((c) => !isDropZoneId(String(c.id)));
  return card ?? collisions[0];
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

export interface DayColumn {
  id: string;
  day: CivilDate;
  todos: Todo[];
}

export interface ListColumn {
  id: string;
  list: List;
  todos: Todo[];
}

export interface BoardModel {
  days: DayColumn[];
  overflow: { id: string; todos: Todo[] };
  lists: ListColumn[];
  /** Scheduled but outside the visible window — rendered dimmed in its list. */
  awayTodoIds: Set<string>;
}

/**
 * Group todos into columns.
 *
 * Completed and dropped todos are excluded from the board. History and an
 * "show completed" toggle are P6 — for now finishing something removes it from
 * view, which is the behaviour the reference UI has.
 *
 * `lists` is the columns to render: the active tab's lists plus Backlog.
 * `hiddenListIds` is the live lists on OTHER tabs. The two are separate on
 * purpose — see the planning branch below for why a hidden list cannot simply
 * be left out of `lists`.
 */
export function buildBoard(
  todos: Todo[],
  lists: List[],
  ctx: PlacementContext,
  hiddenListIds: ReadonlySet<string> = new Set(),
): BoardModel {
  const open = todos.filter((t) => t.status === "open");

  const days: DayColumn[] = ctx.visibleWindow.map((day) => ({
    id: dayColumnId(day),
    day,
    todos: [],
  }));
  const dayIndex = new Map(days.map((d) => [d.day, d]));

  const overflow: BoardModel["overflow"] = { id: overflowColumnId(), todos: [] };

  const listColumns: ListColumn[] = lists.map((list) => ({
    id: listColumnId(list.id),
    list,
    todos: [],
  }));
  const listIndex = new Map(listColumns.map((c) => [c.list.id, c]));
  const backlog = listColumns.find((c) => c.list.isBacklog) ?? listColumns[0];

  const awayTodoIds = new Set<string>();

  for (const todo of open) {
    const placement = deriveColumn(todo, ctx);

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

  for (const day of days) day.todos.sort(byPosition);
  overflow.todos.sort(byPosition);
  for (const column of listColumns) column.todos.sort(byPosition);

  return { days, overflow, lists: listColumns, awayTodoIds };
}
