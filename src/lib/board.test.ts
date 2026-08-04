import { describe, expect, it } from "vitest";
import {
  buildBoard,
  isColumnId,
  listDragId,
  parseColumnId,
  parseListDragId,
  planListDrop,
  preferPreciseTarget,
} from "./board";
import { buildWindow } from "./scheduling";
import type { List, Todo } from "./schema";
import { positionsBetween } from "./ordering";

const TODAY = "2026-08-03";

const ctx = {
  today: TODAY,
  visibleWindow: buildWindow(TODAY, 7),
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

const positions = positionsBetween(null, null, 10);

function list(
  id: string,
  name: string,
  isBacklog = false,
  position = positions[0],
): List {
  return {
    id,
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name,
    isBacklog,
    position,
    tabId: null,
    color: null,
    emoji: null,
    iconUrl: null,
  };
}

function todo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    title: overrides.id,
    description: null,
    status: "open",
    priority: null,
    scheduledDate: null,
    deadline: null,
    listId: null,
    projectId: null,
    labelIds: [],
    location: null,
    parentId: null,
    position: positions[1],
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    ...overrides,
  };
}

const LISTS = [list("backlog", "Backlog", true), list("groceries", "Grocery List")];

describe("buildBoard", () => {
  it("routes unscheduled todos to their list column", () => {
    const board = buildBoard(
      [todo({ id: "a", listId: "groceries" })],
      LISTS,
      ctx,
    );
    expect(board.lists.find((c) => c.list.id === "groceries")!.todos).toHaveLength(1);
    expect(board.days.every((d) => d.todos.length === 0)).toBe(true);
  });

  it("routes scheduled todos to their day column and out of the list half", () => {
    const board = buildBoard(
      [todo({ id: "a", listId: "groceries", scheduledDate: "2026-08-05" })],
      LISTS,
      ctx,
    );
    expect(board.days.find((d) => d.day === "2026-08-05")!.todos).toHaveLength(1);
    // Keeps listId, but must not render in both halves.
    expect(board.lists.find((c) => c.list.id === "groceries")!.todos).toHaveLength(0);
  });

  it("routes long-overdue todos to Overflow", () => {
    const board = buildBoard(
      [todo({ id: "a", scheduledDate: "2026-07-01" })],
      LISTS,
      ctx,
    );
    expect(board.overflow.todos).toHaveLength(1);
  });

  it("shows off-window scheduled todos in their list, flagged as away", () => {
    const board = buildBoard(
      [todo({ id: "a", listId: "groceries", scheduledDate: "2026-09-01" })],
      LISTS,
      ctx,
    );
    expect(board.lists.find((c) => c.list.id === "groceries")!.todos).toHaveLength(1);
    expect(board.awayTodoIds.has("a")).toBe(true);
  });

  it("falls back to Backlog for todos with no list", () => {
    const board = buildBoard([todo({ id: "a", listId: null })], LISTS, ctx);
    expect(board.lists.find((c) => c.list.isBacklog)!.todos).toHaveLength(1);
  });

  it("falls back to Backlog when the list no longer exists", () => {
    const board = buildBoard([todo({ id: "a", listId: "deleted" })], LISTS, ctx);
    expect(board.lists.find((c) => c.list.isBacklog)!.todos).toHaveLength(1);
  });

  it("hides done and dropped todos", () => {
    const board = buildBoard(
      [
        todo({ id: "a", status: "done" }),
        todo({ id: "b", status: "dropped" }),
        todo({ id: "c", status: "open" }),
      ],
      LISTS,
      ctx,
    );
    const total =
      board.lists.reduce((n, c) => n + c.todos.length, 0) +
      board.days.reduce((n, d) => n + d.todos.length, 0) +
      board.overflow.todos.length;
    expect(total).toBe(1);
  });

  it("sorts each column by position", () => {
    const board = buildBoard(
      [
        todo({ id: "b", listId: "backlog", position: positions[5] }),
        todo({ id: "a", listId: "backlog", position: positions[2] }),
      ],
      LISTS,
      ctx,
    );
    expect(board.lists[0].todos.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("preferPreciseTarget", () => {
  it("returns null when nothing collides", () => {
    expect(preferPreciseTarget([])).toBeNull();
  });

  it("prefers a card over the column containing it", () => {
    // The pointer is inside both; the card gives a precise insertion point
    // while the column only means "append to the end".
    const collisions = [{ id: "day:2026-08-03" }, { id: "todo-abc" }];
    expect(preferPreciseTarget(collisions)?.id).toBe("todo-abc");
  });

  it("falls back to the column when no card is under the pointer", () => {
    // Empty space anywhere in a column must still be a valid drop.
    const collisions = [{ id: "list:groceries" }];
    expect(preferPreciseTarget(collisions)?.id).toBe("list:groceries");
  });

  it("picks the first card when several overlap", () => {
    const collisions = [{ id: "todo-a" }, { id: "todo-b" }];
    expect(preferPreciseTarget(collisions)?.id).toBe("todo-a");
  });

  it("treats overflow as a column, not a card", () => {
    const collisions = [{ id: "day:overflow" }];
    expect(preferPreciseTarget(collisions)?.id).toBe("day:overflow");
  });
});

describe("isColumnId", () => {
  it("distinguishes columns from todo ids", () => {
    expect(isColumnId("day:2026-08-03")).toBe(true);
    expect(isColumnId("day:overflow")).toBe(true);
    expect(isColumnId("list:abc")).toBe(true);
    // UUIDv7, the shape real todo ids take.
    expect(isColumnId("0192f3a1-7c2e-7000-8000-abcdef123456")).toBe(false);
  });
});

describe("parseColumnId", () => {
  it("round-trips day, overflow, and list ids", () => {
    expect(parseColumnId("day:2026-08-03")).toEqual({
      kind: "day",
      day: "2026-08-03",
    });
    expect(parseColumnId("day:overflow")).toEqual({ kind: "overflow" });
    expect(parseColumnId("list:abc")).toEqual({ kind: "list", listId: "abc" });
    expect(parseColumnId("nonsense")).toBeNull();
  });
});

describe("parseListDragId", () => {
  it("round-trips a list id", () => {
    expect(parseListDragId(listDragId("abc"))).toBe("abc");
  });

  it("does not collide with the column droppable id space", () => {
    // `list:abc` is the column's DROP target; `listdrag:abc` is its DRAG
    // source. Confusing the two would route a column reorder into the card
    // path, which fails silently.
    expect(parseListDragId("list:abc")).toBeNull();
    expect(parseColumnId(listDragId("abc"))).toBeNull();
  });

  it("returns null for a card id", () => {
    expect(parseListDragId("some-uuid")).toBeNull();
  });
});

describe("planListDrop", () => {
  // Backlog first, then three movable columns in order.
  const ordered = [
    list("backlog", "Backlog", true, positions[0]),
    list("brain", "Brain Dump", false, positions[1]),
    list("grocery", "Grocery List", false, positions[2]),
    list("buy", "To Buy", false, positions[3]),
  ];

  const positionOf = (id: string) => ordered.find((l) => l.id === id)!.position;

  it("moves the last column to first-after-Backlog", () => {
    // The reported scenario: grab "To Buy" from last place, drop it on the
    // leftmost movable column.
    const plan = planListDrop(ordered, "buy", "brain")!;
    expect(plan.side).toBe("before");
    expect(plan.position > positionOf("backlog")).toBe(true);
    expect(plan.position < positionOf("brain")).toBe(true);
  });

  it("keeps Backlog leftmost when a column is dropped onto it", () => {
    const plan = planListDrop(ordered, "buy", "backlog")!;
    expect(plan.side).toBe("after");
    expect(plan.position > positionOf("backlog")).toBe(true);
    expect(plan.position < positionOf("brain")).toBe(true);
  });

  it("lands after the target when dragging rightwards", () => {
    // Direction is what makes the last slot reachable at all.
    const plan = planListDrop(ordered, "brain", "buy")!;
    expect(plan.side).toBe("after");
    expect(plan.position > positionOf("buy")).toBe(true);
  });

  it("lands before the target when dragging leftwards", () => {
    const plan = planListDrop(ordered, "buy", "grocery")!;
    expect(plan.side).toBe("before");
    expect(plan.position > positionOf("brain")).toBe(true);
    expect(plan.position < positionOf("grocery")).toBe(true);
  });

  it("refuses to move Backlog itself", () => {
    expect(planListDrop(ordered, "backlog", "buy")).toBeNull();
  });

  it("treats a drop on itself as a no-op", () => {
    expect(planListDrop(ordered, "buy", "buy")).toBeNull();
  });

  it("returns null for an unknown column", () => {
    expect(planListDrop(ordered, "buy", "nope")).toBeNull();
    expect(planListDrop(ordered, "nope", "buy")).toBeNull();
  });

  it("works when there is no Backlog at all", () => {
    const noBacklog = ordered.slice(1);
    const plan = planListDrop(noBacklog, "buy", "brain")!;
    expect(plan.side).toBe("before");
    expect(plan.position < positionOf("brain")).toBe(true);
  });
});
