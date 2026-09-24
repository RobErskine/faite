import { describe, expect, it } from "vitest";
import {
  SEARCH_LIMIT,
  collapseRecurringSeries,
  matchesQuery,
  normalizeQuery,
  searchTodos,
} from "./search";
import type { Todo } from "./schema";

function todo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    ownerId: "u",
    createdAt: "",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    title: overrides.id,
    description: null,
    status: "open",
    priority: null,
    scheduledDate: null,
    scheduledAt: null,
    deadline: null,
    listId: null,
    projectId: null,
    labelIds: [],
    location: null,
    parentId: null,
    position: "a0",
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    reminderTime: null,
    placeId: null,
    source: null,
    ...overrides,
  };
}

describe("searchTodos", () => {
  it("returns nothing for an empty or whitespace query", () => {
    const todos = [todo({ id: "1", title: "Buy milk" })];

    expect(searchTodos("", todos)).toEqual([]);
    expect(searchTodos("   ", todos)).toEqual([]);
  });

  it("matches titles case-insensitively", () => {
    const todos = [todo({ id: "1", title: "Buy MILK" })];

    expect(searchTodos("milk", todos).map((t) => t.id)).toEqual(["1"]);
  });

  it("matches descriptions when the title does not", () => {
    const todos = [
      todo({ id: "1", title: "Errands", description: "Stop at the pharmacy" }),
    ];

    expect(searchTodos("pharmacy", todos).map((t) => t.id)).toEqual(["1"]);
  });

  it("excludes soft-deleted to-dos", () => {
    const todos = [
      todo({ id: "1", title: "Buy milk", deletedAt: "2026-08-02T00:00:00.000Z" }),
    ];

    expect(searchTodos("milk", todos)).toEqual([]);
  });

  /**
   * The tier order is the whole point of the module — a title prefix beats a
   * word prefix beats a mid-word substring beats a description hit.
   */
  it("ranks title prefixes above word prefixes, substrings, and descriptions", () => {
    const todos = [
      todo({ id: "description", title: "Errands", description: "groceries" }),
      todo({ id: "substring", title: "Regrouping notes" }),
      todo({ id: "word", title: "Buy groceries" }),
      todo({ id: "prefix", title: "Groceries for the week" }),
    ];

    expect(searchTodos("gro", todos).map((t) => t.id)).toEqual([
      "prefix",
      "word",
      "substring",
      "description",
    ]);
  });

  it("puts open to-dos ahead of finished ones at the same tier", () => {
    const todos = [
      todo({ id: "done", title: "Milk run", status: "done" }),
      todo({ id: "dropped", title: "Milk run", status: "dropped" }),
      todo({ id: "open", title: "Milk run" }),
    ];

    expect(searchTodos("milk", todos)[0].id).toBe("open");
  });

  it("breaks ties by most recently updated", () => {
    const todos = [
      todo({ id: "older", title: "Milk", updatedAt: "2026-08-01T00:00:00.000Z" }),
      todo({ id: "newer", title: "Milk", updatedAt: "2026-08-04T00:00:00.000Z" }),
    ];

    expect(searchTodos("milk", todos).map((t) => t.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("caps results at the limit", () => {
    const todos = Array.from({ length: SEARCH_LIMIT + 5 }, (_, i) =>
      todo({ id: `t${i}`, title: `Milk ${i}` }),
    );

    expect(searchTodos("milk", todos)).toHaveLength(SEARCH_LIMIT);
    expect(searchTodos("milk", todos, 3)).toHaveLength(3);
  });
});

describe("normalizeQuery", () => {
  it("trims and lower-cases", () => {
    expect(normalizeQuery("  MiLk  ")).toBe("milk");
  });
});

describe("matchesQuery", () => {
  it("matches at the title-prefix tier", () => {
    expect(matchesQuery(todo({ id: "1", title: "Groceries" }), "gro")).toBe(true);
  });

  it("matches at the word-prefix tier", () => {
    expect(matchesQuery(todo({ id: "1", title: "Buy groceries" }), "gro")).toBe(true);
  });

  it("matches at the title-substring tier", () => {
    expect(matchesQuery(todo({ id: "1", title: "Regrouping notes" }), "gro")).toBe(true);
  });

  it("matches at the description tier", () => {
    expect(
      matchesQuery(
        todo({ id: "1", title: "Errands", description: "buy groceries" }),
        "gro",
      ),
    ).toBe(true);
  });

  it("returns false for a non-match", () => {
    expect(matchesQuery(todo({ id: "1", title: "Errands" }), "gro")).toBe(false);
  });

  it("agrees with searchTodos on which to-dos match, tiers aside", () => {
    const todos = [
      todo({ id: "description", title: "Errands", description: "groceries" }),
      todo({ id: "substring", title: "Regrouping notes" }),
      todo({ id: "word", title: "Buy groceries" }),
      todo({ id: "prefix", title: "Groceries for the week" }),
      todo({ id: "none", title: "Nothing relevant" }),
    ];
    const q = normalizeQuery("gro");
    const ranked = new Set(searchTodos("gro", todos).map((t) => t.id));

    for (const t of todos) {
      expect(matchesQuery(t, q)).toBe(ranked.has(t.id));
    }
  });
});

describe("collapseRecurringSeries", () => {
  /** One settled occurrence of `series`, as `expandRecurrences` hands it over. */
  const settled = (series: string, date: string, updatedAt: string): Todo =>
    todo({
      id: `${series}@${date}`,
      title: "Take down trash",
      status: "done",
      scheduledDate: date,
      recurrenceParentId: series,
      updatedAt,
    });

  /** The live occurrence — virtual or materialized, both look like this. */
  const live = (series: string, date: string): Todo =>
    todo({
      id: `${series}@${date}`,
      title: "Take down trash",
      scheduledDate: date,
      recurrenceParentId: series,
    });

  it("keeps only the next occurrence when the rest of the series is done", () => {
    const rows = [
      settled("s1", "2026-09-02", "2026-09-02T18:00:00.000Z"),
      settled("s1", "2026-09-09", "2026-09-09T18:00:00.000Z"),
      settled("s1", "2026-09-16", "2026-09-16T18:00:00.000Z"),
      live("s1", "2026-09-23"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["s1@2026-09-23"]);
  });

  it("prefers the EARLIEST open occurrence, so an overdue one wins over a future one", () => {
    const rows = [
      live("s1", "2026-10-07"),
      live("s1", "2026-09-16"),
      live("s1", "2026-09-30"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["s1@2026-09-16"]);
  });

  it("prefers an open occurrence over a more recently updated settled one", () => {
    const rows = [
      live("s1", "2026-09-30"),
      settled("s1", "2026-09-16", "2099-01-01T00:00:00.000Z"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["s1@2026-09-30"]);
  });

  it("falls back to ONE settled row when nothing in the series is open", () => {
    // A yearly series whose next occurrence is past the rendered window: one
    // row of history beats a to-do that cannot be found at all.
    const rows = [
      settled("s1", "2024-09-16", "2024-09-16T18:00:00.000Z"),
      settled("s1", "2025-09-16", "2025-09-16T18:00:00.000Z"),
      settled("s1", "2026-09-16", "2026-09-16T18:00:00.000Z"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["s1@2026-09-16"]);
  });

  it("never lets a skipped (tombstoned) occurrence win its series", () => {
    const rows = [
      todo({
        ...live("s1", "2026-09-23"),
        id: "s1@2026-09-23",
        deletedAt: "2026-09-20T00:00:00.000Z",
      }),
      live("s1", "2026-09-30"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["s1@2026-09-30"]);
  });

  it("sorts an undated occurrence last rather than treating it as earliest", () => {
    // The ORIGIN row a series was grown from (`createSeriesFromTodo`) carries
    // the parent id without being a dated slot.
    const rows = [
      todo({ id: "origin", title: "Take down trash", recurrenceParentId: "s1" }),
      live("s1", "2026-09-30"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["s1@2026-09-30"]);
  });

  it("does not depend on the order the caller built its array in", () => {
    const rows = [
      settled("s1", "2026-09-09", "2026-09-09T18:00:00.000Z"),
      live("s1", "2026-09-23"),
      settled("s1", "2026-09-16", "2026-09-16T18:00:00.000Z"),
      live("s1", "2026-09-30"),
    ];

    const forward = collapseRecurringSeries(rows).map((t) => t.id);
    const backward = collapseRecurringSeries([...rows].reverse()).map((t) => t.id);

    expect(forward).toEqual(["s1@2026-09-23"]);
    expect(backward).toEqual(forward);
  });

  it("collapses each series independently", () => {
    const rows = [
      settled("trash", "2026-09-16", "2026-09-16T18:00:00.000Z"),
      live("trash", "2026-09-23"),
      settled("bins", "2026-09-17", "2026-09-17T18:00:00.000Z"),
      live("bins", "2026-09-24"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual([
      "trash@2026-09-23",
      "bins@2026-09-24",
    ]);
  });

  it("leaves non-recurring to-dos alone, completed ones included, in order", () => {
    const rows = [
      todo({ id: "a", title: "Buy milk" }),
      todo({ id: "b", title: "File taxes", status: "done" }),
      todo({ id: "c", title: "Call mom", status: "dropped" }),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a series in the position its first row held", () => {
    const rows = [
      todo({ id: "a", title: "Buy milk" }),
      settled("s1", "2026-09-16", "2026-09-16T18:00:00.000Z"),
      todo({ id: "b", title: "File taxes" }),
      live("s1", "2026-09-23"),
    ];

    expect(collapseRecurringSeries(rows).map((t) => t.id)).toEqual([
      "a",
      "s1@2026-09-23",
      "b",
    ]);
  });

  it("feeds searchTodos a single hit for a long-running chore", () => {
    const rows = [
      todo({ id: "x", title: "Trash bags" }),
      settled("s1", "2026-09-02", "2026-09-02T18:00:00.000Z"),
      settled("s1", "2026-09-09", "2026-09-09T18:00:00.000Z"),
      live("s1", "2026-09-23"),
    ];

    const hits = searchTodos("take down trash", collapseRecurringSeries(rows));

    expect(hits.map((t) => t.id)).toEqual(["s1@2026-09-23"]);
  });
});
