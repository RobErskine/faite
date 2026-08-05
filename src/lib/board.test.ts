import { describe, expect, it } from "vitest";
import {
  buildBoard,
  isColumnId,
  isDropZoneId,
  listDragId,
  parseColumnId,
  parseListDragId,
  parseTabDragId,
  parseTabDropId,
  planListDrop,
  planTabDrop,
  preferPreciseTarget,
  tabDragId,
  tabDropId,
} from "./board";
import { buildWindow } from "./scheduling";
import type { List, Tab, Todo } from "./schema";
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
    archivedAt: null,
    archivedWithTabId: null,
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

function tab(id: string, name: string, position = positions[0]): Tab {
  return {
    id,
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name,
    description: null,
    isDefault: false,
    archivedAt: null,
    position,
    color: null,
    emoji: null,
    iconUrl: null,
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

  it("renders a far-out todo in its day column once the window grows to cover it", () => {
    // Same todo as above, but with a window wide enough to reach it — this is
    // what the board does as the calendar half scrolls or a todo is
    // scheduled further out than settings.visibleDays.
    const widerCtx = { ...ctx, visibleWindow: buildWindow(TODAY, 30) };
    const board = buildBoard(
      [todo({ id: "a", listId: "groceries", scheduledDate: "2026-09-01" })],
      LISTS,
      widerCtx,
    );
    const day = board.days.find((d) => d.day === "2026-09-01");
    expect(day?.todos).toHaveLength(1);
    expect(board.lists.find((c) => c.list.id === "groceries")!.todos).toHaveLength(0);
    expect(board.awayTodoIds.has("a")).toBe(false);
  });

  it("still flags a todo scheduled past the cap even with a wide window", () => {
    // 2026-09-01 is 29 days out; a 20-day window is not enough to hold it —
    // this is the safety valve past DAY_CAP in board.tsx.
    const widerCtx = { ...ctx, visibleWindow: buildWindow(TODAY, 20) };
    const board = buildBoard(
      [todo({ id: "a", listId: "groceries", scheduledDate: "2026-09-01" })],
      LISTS,
      widerCtx,
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

describe("buildBoard with hidden lists (tabs)", () => {
  const TABBED = [
    list("backlog", "Backlog", true, positions[0]),
    list("groceries", "Grocery List", false, positions[1]),
  ];
  // "work" lives on another tab, so it is absent from the columns AND hidden.
  const hidden = new Set(["work"]);

  it("keeps a scheduled todo on its day even when its list is on another tab", () => {
    // The calendar half is the week, not a tab. Switching tabs must not empty
    // Thursday. This is the regression the hiddenListIds parameter exists for:
    // filtering these todos out upstream would have taken them off the
    // calendar too.
    const board = buildBoard(
      [todo({ id: "a", listId: "work", scheduledDate: "2026-08-05" })],
      TABBED,
      ctx,
      hidden,
    );
    const day = board.days.find((d) => d.day === "2026-08-05")!;
    expect(day.todos.map((t) => t.id)).toEqual(["a"]);
  });

  it("drops an unscheduled todo from another tab instead of piling it into Backlog", () => {
    // Without the explicit check, buildBoard's "unknown list falls back to
    // Backlog" rule would collect every other tab's todos — and Backlog is
    // shared by every tab, so they would be visible from all of them.
    const board = buildBoard(
      [todo({ id: "a", listId: "work" })],
      TABBED,
      ctx,
      hidden,
    );
    expect(board.lists.every((c) => c.todos.length === 0)).toBe(true);
  });

  it("still rescues a todo whose list was deleted outright", () => {
    // The Backlog fallback must survive: an unknown list is not the same thing
    // as a list on another tab.
    const board = buildBoard(
      [todo({ id: "a", listId: "deleted-list" })],
      TABBED,
      ctx,
      hidden,
    );
    expect(board.lists.find((c) => c.list.isBacklog)!.todos.map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("shows Backlog's own todos regardless of the active tab", () => {
    const board = buildBoard(
      [todo({ id: "a", listId: "backlog" })],
      TABBED,
      ctx,
      hidden,
    );
    expect(board.lists.find((c) => c.list.isBacklog)!.todos).toHaveLength(1);
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

  it("does not mistake a tab pill for a card", () => {
    // A tab is a drop zone without being a column. Treated as a card it would
    // be looked up in `todos`, found missing, and the drop would do nothing —
    // silently, which is the whole hazard.
    const collisions = [{ id: tabDropId("work") }];
    expect(preferPreciseTarget(collisions)?.id).toBe(tabDropId("work"));
  });
});

describe("isDropZoneId", () => {
  it("covers columns and tab pills but not cards", () => {
    expect(isDropZoneId("day:2026-08-03")).toBe(true);
    expect(isDropZoneId("list:abc")).toBe(true);
    expect(isDropZoneId(tabDropId("abc"))).toBe(true);
    expect(isDropZoneId("0192f3a1-7c2e-7000-8000-abcdef123456")).toBe(false);
  });
});

describe("tab id namespaces", () => {
  it("round-trips both tab id spaces", () => {
    expect(parseTabDropId(tabDropId("abc"))).toBe("abc");
    expect(parseTabDragId(tabDragId("abc"))).toBe("abc");
  });

  /**
   * The full non-collision matrix. Four namespaces now share one DndContext,
   * and a prefix that accidentally matches another routes a gesture into the
   * wrong handler with no error — the failure is a drop that does nothing.
   */
  it("keeps all four id spaces disjoint", () => {
    const ids = {
      column: "list:abc",
      day: "day:2026-08-03",
      listDrag: listDragId("abc"),
      tabDrop: tabDropId("abc"),
      tabDrag: tabDragId("abc"),
      card: "0192f3a1-7c2e-7000-8000-abcdef123456",
    };

    // Each parser accepts only its own.
    expect(parseColumnId(ids.tabDrop)).toBeNull();
    expect(parseColumnId(ids.tabDrag)).toBeNull();
    expect(parseListDragId(ids.tabDrag)).toBeNull();
    expect(parseListDragId(ids.tabDrop)).toBeNull();

    // `tabdrag:` starts with "tab", which is exactly the trap.
    expect(parseTabDropId(ids.tabDrag)).toBeNull();
    expect(parseTabDragId(ids.tabDrop)).toBeNull();

    expect(parseTabDropId(ids.column)).toBeNull();
    expect(parseTabDropId(ids.day)).toBeNull();
    expect(parseTabDropId(ids.listDrag)).toBeNull();
    expect(parseTabDragId(ids.listDrag)).toBeNull();
    expect(parseTabDropId(ids.card)).toBeNull();
    expect(parseTabDragId(ids.card)).toBeNull();
  });
});

describe("planTabDrop", () => {
  const ordered = [
    tab("personal", "Personal", positions[0]),
    tab("work", "Work", positions[1]),
    tab("trip", "Trip", positions[2]),
  ];

  const positionOf = (id: string) => ordered.find((t) => t.id === id)!.position;

  it("lands after the target when dragging rightwards", () => {
    // Direction is what makes the last slot reachable at all.
    const plan = planTabDrop(ordered, "personal", "trip")!;
    expect(plan.side).toBe("after");
    expect(plan.position > positionOf("trip")).toBe(true);
  });

  it("lands before the target when dragging leftwards", () => {
    const plan = planTabDrop(ordered, "trip", "personal")!;
    expect(plan.side).toBe("before");
    expect(plan.position < positionOf("personal")).toBe(true);
  });

  it("moves into the middle slot", () => {
    const plan = planTabDrop(ordered, "trip", "work")!;
    expect(plan.position > positionOf("personal")).toBe(true);
    expect(plan.position < positionOf("work")).toBe(true);
  });

  it("returns null when dropped on itself", () => {
    expect(planTabDrop(ordered, "work", "work")).toBeNull();
  });

  it("returns null for an unknown tab", () => {
    expect(planTabDrop(ordered, "ghost", "work")).toBeNull();
    expect(planTabDrop(ordered, "work", "ghost")).toBeNull();
  });

  it("has no pinned member, unlike lists", () => {
    // The default tab is undeletable, not immovable — dragging it must work.
    const plan = planTabDrop(ordered, "personal", "work")!;
    expect(plan.side).toBe("after");
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
