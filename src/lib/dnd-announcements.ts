import type { Announcements } from "@dnd-kit/core";
import type { List, Tab, Todo } from "@/lib/schema";
import {
  parseColumnId,
  parseDayGroupId,
  parseListDragId,
  parseTabDragId,
  type BoardModel,
  type DropTarget,
} from "@/lib/board";
import { formatDay } from "@/lib/scheduling";

/**
 * dnd-kit screen-reader announcements (EI-84), phrased in the board's own
 * vocabulary — todo title, column name, position — rather than dnd-kit's
 * generic "draggable item" / "droppable region" defaults.
 *
 * Pure and React-free on purpose (docs/KEYBOARD.md §9: "extract the pure
 * function and test that" — simulating key events tests the browser more
 * than it tests the code). `board.tsx` wraps this in a `useMemo` keyed on
 * the same data `DndContext` already reads.
 *
 * dnd-kit calls these functions as part of its OWN event dispatch, before
 * the app's `onDragEnd` handler has run and before React has re-rendered —
 * so `entities.board` here is always the board as it stood BEFORE this
 * drag's effect on it. Position/count for a move are therefore computed by
 * hand from `over`, not read back off updated state.
 */

export interface AnnounceEntities {
  /** Only the shape this module reads — `Pick` so callers don't have to
   * supply `awayTodoIds`, which is irrelevant to what gets announced. */
  board: Pick<BoardModel, "days" | "overflow" | "lists">;
  todosById: ReadonlyMap<string, Todo>;
  listsById: ReadonlyMap<string, List>;
  tabsById: ReadonlyMap<string, Tab>;
}

interface ResolvedColumn {
  /** "Tuesday", "Overflow", or a list's name. */
  label: string;
  /** That column's cards in rendered order — the same array the arrow keys walk. */
  todos: Todo[];
}

function resolveColumnFromTarget(
  target: DropTarget,
  entities: AnnounceEntities,
): ResolvedColumn | null {
  if (target.kind === "overflow") {
    return { label: "Overflow", todos: entities.board.overflow.todos };
  }
  if (target.kind === "day") {
    const column = entities.board.days.find((d) => d.day === target.day);
    if (!column) return null;
    return { label: formatDay(target.day).weekday, todos: column.todos };
  }
  const column = entities.board.lists.find((c) => c.list.id === target.listId);
  if (!column) return null;
  return { label: column.list.name, todos: column.todos };
}

/** Where a todo currently renders — mirrors `findColumn` in use-board-actions.ts. */
function findTodoColumn(
  entities: AnnounceEntities,
  todoId: string,
): ResolvedColumn | null {
  for (const day of entities.board.days) {
    if (day.todos.some((t) => t.id === todoId)) {
      return { label: formatDay(day.day).weekday, todos: day.todos };
    }
  }
  if (entities.board.overflow.todos.some((t) => t.id === todoId)) {
    return { label: "Overflow", todos: entities.board.overflow.todos };
  }
  for (const column of entities.board.lists) {
    if (column.todos.some((t) => t.id === todoId)) {
      return { label: column.list.name, todos: column.todos };
    }
  }
  return null;
}

/**
 * Decode `over.id` into the column a card is currently hovering.
 *
 * Three shapes reach here: a column id (`day:`/`list:`), a day-group id
 * (hovering a specific list's cards within a day — resolves to that day,
 * per `dayGroupPatch`'s "still scheduled for D" semantics), or another
 * card's id (only reachable in ungrouped columns — Backlog and list
 * columns — where cards are droppables in their own right; resolves to
 * wherever that card lives). Anything else (a tab pill, a weekend strip)
 * returns null — those aren't places a card can land.
 */
function resolveOverColumn(
  overId: string,
  entities: AnnounceEntities,
): ResolvedColumn | null {
  const target = parseColumnId(overId);
  if (target) return resolveColumnFromTarget(target, entities);

  const group = parseDayGroupId(overId);
  if (group) {
    const column = entities.board.days.find((d) => d.day === group.day);
    if (!column) return null;
    return { label: formatDay(group.day).weekday, todos: column.todos };
  }

  if (entities.todosById.has(overId)) {
    return findTodoColumn(entities, overId);
  }

  return null;
}

/** 1-based "position of count", after removing `activeId` from its old spot. */
function computePosition(
  column: ResolvedColumn,
  activeId: string,
  overId: string | null,
): { index: number; count: number } {
  const rest = column.todos.filter((t) => t.id !== activeId);
  const overIndex = overId ? rest.findIndex((t) => t.id === overId) : -1;
  const index = overIndex >= 0 ? overIndex : rest.length;
  return { index: index + 1, count: rest.length + 1 };
}

function todoAnnouncement(
  kind: "start" | "over" | "end" | "cancel",
  activeId: string,
  overId: string | null,
  entities: AnnounceEntities,
): string | undefined {
  const todo = entities.todosById.get(activeId);
  if (!todo) return undefined;
  const title = todo.title.trim() || "Untitled to-do";

  if (kind === "start") {
    const source = findTodoColumn(entities, activeId);
    if (!source) return `${title}. Picked up.`;
    const index = source.todos.findIndex((t) => t.id === activeId) + 1;
    return `${title}. Picked up from ${source.label}, position ${index} of ${source.todos.length}.`;
  }

  if (kind === "cancel") {
    const source = findTodoColumn(entities, activeId);
    return source
      ? `${title}. Drag cancelled, still in ${source.label}.`
      : `${title}. Drag cancelled.`;
  }

  const overColumn = overId ? resolveOverColumn(overId, entities) : null;

  if (kind === "over") {
    return overColumn
      ? `${title} is over ${overColumn.label}.`
      : `${title} is no longer over a droppable area.`;
  }

  // kind === "end"
  if (!overColumn) return `${title} was dropped outside of any droppable area.`;
  const { index, count } = computePosition(overColumn, activeId, overId);
  return `${title} was dropped in ${overColumn.label}, position ${index} of ${count}.`;
}

function reorderAnnouncement(
  kind: "start" | "over" | "end" | "cancel",
  label: string,
  noun: "list" | "tab",
): string | undefined {
  switch (kind) {
    case "start":
      return `${label} ${noun}. Picked up for reordering.`;
    case "over":
      return undefined;
    case "end":
      return `${label} ${noun} was dropped.`;
    case "cancel":
      return `${label} ${noun} reorder cancelled.`;
  }
}

function buildAnnouncement(
  kind: "start" | "over" | "end" | "cancel",
  activeId: string,
  overId: string | null,
  entities: AnnounceEntities,
): string | undefined {
  const listDragId = parseListDragId(activeId);
  if (listDragId) {
    const list = entities.listsById.get(listDragId);
    return list ? reorderAnnouncement(kind, list.name, "list") : undefined;
  }
  const tabDragId = parseTabDragId(activeId);
  if (tabDragId) {
    const tab = entities.tabsById.get(tabDragId);
    return tab ? reorderAnnouncement(kind, tab.name, "tab") : undefined;
  }
  return todoAnnouncement(kind, activeId, overId, entities);
}

/** Builds dnd-kit's `accessibility.announcements` for the board's `DndContext`. */
export function boardDragAnnouncements(entities: AnnounceEntities): Announcements {
  return {
    onDragStart({ active }) {
      return buildAnnouncement("start", String(active.id), null, entities);
    },
    onDragOver({ active, over }) {
      return buildAnnouncement("over", String(active.id), over ? String(over.id) : null, entities);
    },
    onDragEnd({ active, over }) {
      return buildAnnouncement("end", String(active.id), over ? String(over.id) : null, entities);
    },
    onDragCancel({ active }) {
      return buildAnnouncement("cancel", String(active.id), null, entities);
    },
  };
}
