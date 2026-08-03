import { describe, expect, it } from "vitest";
import { buildBoard, isColumnId, parseColumnId, preferPreciseTarget } from "./board";
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

function list(id: string, name: string, isBacklog = false): List {
  return {
    id,
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name,
    isBacklog,
    position: positions[0],
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
