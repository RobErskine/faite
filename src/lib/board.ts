import type { CivilDate, List, Todo } from "@/lib/schema";
import { byPosition } from "@/lib/ordering";
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
  const card = collisions.find((c) => !isColumnId(String(c.id)));
  return card ?? collisions[0];
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
 */
export function buildBoard(
  todos: Todo[],
  lists: List[],
  ctx: PlacementContext,
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
