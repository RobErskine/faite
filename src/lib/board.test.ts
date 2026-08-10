import { describe, expect, it } from "vitest";
import {
  buildBoard,
  byListGroup,
  dayColumnId,
  dayGroupId,
  isColumnId,
  isDropZoneId,
  listColumnId,
  listDragId,
  listSortKey,
  parseColumnId,
  parseDayGroupId,
  parseListDragId,
  parseTabDragId,
  parseTabDropId,
  parseWeekendColumnId,
  planListDrop,
  planTabDrop,
  preferPreciseTarget,
  tabDragId,
  tabDropId,
  weekendColumnId,
  type TodoGroup,
} from "./board";
import { OVERFLOW, buildWindow } from "./scheduling";
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
  // Records rather than ids: a day column groups by list, so it needs the name.
  const hidden = [list("work", "Work")];

  it("keeps a scheduled todo on its day even when its list is on another tab", () => {
    // The calendar half is the week, not a tab. Switching tabs must not empty
    // Thursday. This is the regression the hiddenLists parameter exists for:
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

  /*
    The reason `hiddenLists` carries records. With ids alone the group index could
    not resolve "work", so this card would file under Backlog — indistinguishable
    from a homeless todo, and a drop on that header would rewrite its listId.
  */
  it("groups an other-tab card under its real list, not Backlog", () => {
    const board = buildBoard(
      [todo({ id: "a", listId: "work", scheduledDate: "2026-08-05" })],
      TABBED,
      ctx,
      hidden,
    );
    const day = board.days.find((d) => d.day === "2026-08-05")!;
    expect(day.groups.map((g) => g.name)).toEqual(["Work"]);
    expect(day.groups[0].key).toBe("work");
  });
});

describe("listSortKey", () => {
  it("strips a leading “To ”, so the alphabet does some work", () => {
    expect(listSortKey("To Buy")).toBe("Buy");
    expect(listSortKey("to buy")).toBe("buy");
    expect(listSortKey("TO READ")).toBe("READ");
    expect(listSortKey("To  Buy")).toBe("Buy");
    expect(listSortKey("To Buy")).toBe("Buy");
    expect(listSortKey("  To Read  ")).toBe("Read");
  });

  /*
    The regression that matters. `^to` without the whitespace boundary would file
    "Tomorrow" under M.
  */
  it("only strips the WORD “to”", () => {
    expect(listSortKey("Tomorrow")).toBe("Tomorrow");
    expect(listSortKey("Today")).toBe("Today");
    expect(listSortKey("Together")).toBe("Together");
    expect(listSortKey("Total")).toBe("Total");
  });

  it("leaves a list named exactly “To” alone", () => {
    // An empty sort key would sort before everything and pin it to the top.
    expect(listSortKey("To")).toBe("To");
    expect(listSortKey("To ")).toBe("To");
  });
});

describe("byListGroup", () => {
  const group = (key: string, name: string): TodoGroup => ({
    id: dayGroupId("2026-08-05", key),
    key,
    name,
    color: null,
    sortKey: listSortKey(name),
    todos: [],
  });

  const order = (...names: [string, string][]) =>
    names
      .map(([key, name]) => group(key, name))
      .sort(byListGroup)
      .map((g) => g.name);

  it("sorts on the stripped name", () => {
    expect(
      order(["a", "To Buy"], ["b", "Admin"], ["c", "Cook"]),
    ).toEqual(["Admin", "To Buy", "Cook"]);
  });

  it("is case- and accent-insensitive, and numeric", () => {
    expect(order(["a", "Week 10"], ["b", "Week 2"])).toEqual(["Week 2", "Week 10"]);
    expect(order(["a", "Zoo"], ["b", "Café"], ["c", "Cafe"])[2]).toBe("Zoo");
  });

  it("breaks a tie on the key, so the order is total", () => {
    // Same sort key from two different names — without the fallback the result
    // would depend on which todo was encountered first.
    const sorted = [group("z", "To Buy"), group("a", "Buy")].sort(byListGroup);
    expect(sorted.map((g) => g.key)).toEqual(["a", "z"]);
  });

  it("does not pin Backlog first the way the planning half does", () => {
    expect(order(["backlog", "Backlog"], ["a", "Admin"])).toEqual([
      "Admin",
      "Backlog",
    ]);
  });
});

describe("day group ids", () => {
  it("round-trips", () => {
    const id = dayGroupId("2026-08-05", "groceries");
    expect(parseDayGroupId(id)).toEqual({ day: "2026-08-05", key: "groceries" });
  });

  it("survives a key containing colons", () => {
    // `seed:list:backlog` is a real id, which is why the separator is `|`.
    const id = dayGroupId("2026-08-05", "seed:list:backlog");
    expect(parseDayGroupId(id)?.key).toBe("seed:list:backlog");
  });

  it("rejects every other id space", () => {
    expect(parseDayGroupId(dayColumnId("2026-08-05"))).toBeNull();
    expect(parseDayGroupId(listColumnId("groceries"))).toBeNull();
    expect(parseDayGroupId("daygroup:no-separator")).toBeNull();
    expect(parseColumnId(dayGroupId("2026-08-05", "x"))).toBeNull();
  });

  it("is a drop zone, not a card", () => {
    // Miss this and the group id gets looked up in `todos`, found to be nothing,
    // and the drop silently does nothing.
    expect(isDropZoneId(dayGroupId("2026-08-05", "x"))).toBe(true);
  });
});

describe("grouping a day column", () => {
  const LISTS_2 = [
    list("backlog", "Backlog", true),
    list("groceries", "To Buy"),
    list("admin", "Admin"),
  ];
  const scheduled = (id: string, listId: string | null, priority: 1 | 2 | 3 | 4 | null = null) =>
    todo({ id, listId, priority, scheduledDate: "2026-08-05" });

  const dayOf = (todos: ReturnType<typeof todo>[]) =>
    buildBoard(todos, LISTS_2, ctx).days.find((d) => d.day === "2026-08-05")!;

  it("partitions by list, alphabetically on the stripped name", () => {
    const day = dayOf([scheduled("a", "groceries"), scheduled("b", "admin")]);
    expect(day.groups.map((g) => g.name)).toEqual(["Admin", "To Buy"]);
  });

  it("orders each group by priority, then position", () => {
    const day = dayOf([
      scheduled("none", "admin", null),
      scheduled("p3", "admin", 3),
      scheduled("p1", "admin", 1),
    ]);
    expect(day.groups[0].todos.map((t) => t.id)).toEqual(["p1", "p3", "none"]);
  });

  it("derives the flat array from the groups, so one order exists", () => {
    const day = dayOf([scheduled("a", "groceries"), scheduled("b", "admin")]);
    expect(day.todos).toEqual(day.groups.flatMap((g) => g.todos));
  });

  it("files a listless or dangling card under Backlog", () => {
    const day = dayOf([scheduled("a", null), scheduled("b", "gone")]);
    expect(day.groups.map((g) => g.name)).toEqual(["Backlog"]);
    expect(day.groups[0].todos).toHaveLength(2);
  });

  it("emits no empty groups", () => {
    const day = dayOf([scheduled("a", "admin")]);
    expect(day.groups).toHaveLength(1);
  });

  it("groups Overflow too, under the sentinel", () => {
    const board = buildBoard(
      [todo({ id: "a", listId: "admin", scheduledDate: "2026-07-01" })],
      LISTS_2,
      ctx,
    );
    expect(board.overflow.groups.map((g) => g.id)).toEqual([
      dayGroupId(OVERFLOW, "admin"),
    ]);
  });

  it("leaves the planning half ungrouped and hand-ordered", () => {
    const board = buildBoard([todo({ id: "a", listId: "admin" })], LISTS_2, ctx);
    const column = board.lists.find((c) => c.list.id === "admin")!;
    expect(column).not.toHaveProperty("groups");
    expect(column.todos.map((t) => t.id)).toEqual(["a"]);
  });

  it("still renders every card when there are no lists at all", () => {
    // Degenerate, but it must not drop cards on the floor.
    const board = buildBoard([scheduled("a", "admin")], [], ctx);
    const day = board.days.find((d) => d.day === "2026-08-05")!;
    expect(day.groups).toHaveLength(0);
    expect(day.todos.map((t) => t.id)).toEqual(["a"]);
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

  /*
    Precedence, not geometry. `pointerWithin` sorts by mean corner distance, so a
    short group near the top of a tall column can be listed AFTER it — hence the
    deliberately reversed input here. Leaving this to the sort order would make one
    gesture mean two different things depending on where the group sits.
  */
  it("prefers a group over the column containing it, whatever the order", () => {
    const group = dayGroupId("2026-08-03", "groceries");
    expect(
      preferPreciseTarget([{ id: "day:2026-08-03" }, { id: group }])?.id,
    ).toBe(group);
    expect(
      preferPreciseTarget([{ id: group }, { id: "day:2026-08-03" }])?.id,
    ).toBe(group);
  });

  it("still prefers a card over a group", () => {
    const collisions = [
      { id: dayGroupId("2026-08-03", "groceries") },
      { id: "todo-abc" },
    ];
    expect(preferPreciseTarget(collisions)?.id).toBe("todo-abc");
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

describe("weekend strip ids", () => {
  it("round-trips", () => {
    expect(parseWeekendColumnId(weekendColumnId("2026-08-08"))).toBe("2026-08-08");
    expect(parseWeekendColumnId("day:2026-08-08")).toBeNull();
    expect(parseWeekendColumnId("nonsense")).toBeNull();
  });

  /**
   * The two halves of the contract that make the strip work, and both fail
   * SILENTLY if broken — see `weekendColumnId`'s comment.
   *
   * Out of `isDropZoneId`, a hover on the strip is classified as a card,
   * looked up in the todo list, not found, and the drag does nothing at all.
   * In `parseColumnId`, the strip becomes a drop destination and a card
   * released on it gets scheduled to a day the user never picked.
   */
  it("is a drop zone but never a drop destination", () => {
    const id = weekendColumnId("2026-08-08");
    expect(isDropZoneId(id)).toBe(true);
    expect(parseColumnId(id)).toBeNull();
    expect(isColumnId(id)).toBe(false);
  });
});

describe("buildBoard status filtering", () => {
  const settled = [
    todo({ id: "open", listId: "groceries", scheduledDate: "2026-08-05" }),
    todo({
      id: "done",
      listId: "groceries",
      scheduledDate: "2026-08-05",
      status: "done",
      completedAt: "2026-08-05T10:00:00Z",
    }),
    todo({
      id: "dropped",
      listId: "groceries",
      scheduledDate: "2026-08-05",
      status: "dropped",
    }),
  ];
  const dayIds = (board: ReturnType<typeof buildBoard>, day: string) =>
    board.days.find((d) => d.day === day)!.todos.map((t) => t.id);

  it("shows only open todos by default", () => {
    expect(dayIds(buildBoard(settled, LISTS, ctx), "2026-08-05")).toEqual(["open"]);
  });

  it("shows each settled status only when asked for", () => {
    expect(
      dayIds(buildBoard(settled, LISTS, ctx, [], { visibleStatuses: ["open", "done"] }), "2026-08-05"),
    ).toEqual(["open", "done"]);
    expect(
      dayIds(buildBoard(settled, LISTS, ctx, [], { visibleStatuses: ["dropped"] }), "2026-08-05"),
    ).toEqual(["dropped"]);
  });

  /**
   * THE REGRESSION THIS BLOCK EXISTS FOR. Overflow means "you have put this
   * off too long", which is a statement about work you still owe. Running a
   * finished todo through `deriveColumn` would file last week's completed
   * errand under an accusation, and push genuinely stale work down to fit.
   */
  it("never rolls a settled todo into Overflow, however stale", () => {
    const stale = todo({
      id: "stale",
      // 10 days before TODAY, far past `overflowAfterDays: 3`.
      scheduledDate: "2026-07-24",
      status: "done",
    });
    const board = buildBoard([stale], LISTS, ctx, [], {
      visibleStatuses: ["open", "done"],
    });
    expect(board.overflow.todos).toHaveLength(0);
    // Outside the window entirely, so it renders nowhere — and specifically
    // NOT as an away-card in its list, which is the live-work fallback.
    expect(board.days.flatMap((d) => d.todos)).toHaveLength(0);
    expect(board.lists.flatMap((c) => c.todos)).toHaveLength(0);
    expect(board.awayTodoIds.size).toBe(0);
  });

  it("keeps a settled todo on the day it was scheduled for", () => {
    const board = buildBoard(
      [todo({ id: "d", scheduledDate: "2026-08-06", status: "done" })],
      LISTS,
      ctx,
      [],
      { visibleStatuses: ["done"] },
    );
    expect(dayIds(board, "2026-08-06")).toEqual(["d"]);
  });

  it("routes an unscheduled settled todo to its list", () => {
    const board = buildBoard(
      [todo({ id: "d", listId: "groceries", status: "done" })],
      LISTS,
      ctx,
      [],
      { visibleStatuses: ["done"] },
    );
    expect(board.lists.find((c) => c.list.id === "groceries")!.todos.map((t) => t.id)).toEqual(
      ["d"],
    );
  });

  it("sinks settled todos below open ones in a day column", () => {
    const board = buildBoard(
      [
        todo({ id: "done-p1", scheduledDate: "2026-08-05", status: "done", priority: 1 }),
        todo({ id: "open-p4", scheduledDate: "2026-08-05", priority: 4 }),
      ],
      LISTS,
      ctx,
      [],
      { visibleStatuses: ["open", "done"] },
    );
    // P1 would sort first on priority alone; status wins.
    expect(dayIds(board, "2026-08-05")).toEqual(["open-p4", "done-p1"]);
  });

  it("sinks settled todos below open ones in a list column", () => {
    const board = buildBoard(
      [
        todo({ id: "done", listId: "groceries", status: "done", position: positions[0] }),
        todo({ id: "open", listId: "groceries", position: positions[5] }),
      ],
      LISTS,
      ctx,
      [],
      { visibleStatuses: ["open", "done"] },
    );
    expect(
      board.lists.find((c) => c.list.id === "groceries")!.todos.map((t) => t.id),
    ).toEqual(["open", "done"]);
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
