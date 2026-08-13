import { describe, expect, it } from "vitest";
import { SEARCH_LIMIT, matchesQuery, normalizeQuery, searchTodos } from "./search";
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
