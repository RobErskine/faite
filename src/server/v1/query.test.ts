import { describe, expect, it } from "vitest";
import type { Todo } from "@/lib/schema";
import { filterTodos, parseTodoQuery, todoQuerySchema } from "./query";

function todo(overrides: Partial<Todo>): Todo {
  return {
    id: "t1",
    ownerId: "u1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    title: "Task",
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
    placeId: null,
    parentId: null,
    position: "a0",
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    reminderTime: null,
    source: null,
    ...overrides,
  };
}

const query = (search: string) => parseTodoQuery(new URLSearchParams(search));

describe("parseTodoQuery", () => {
  it("an empty query string is a valid no-filter query", () => {
    expect(query("")).toEqual({});
  });

  it("coerces the numeric params, which arrive as strings", () => {
    expect(query("limit=50&offset=10")).toEqual({ limit: 50, offset: 10 });
  });

  it("rejects a malformed value rather than ignoring it", () => {
    expect(query("status=nonsense")).toBeNull();
    expect(query("limit=0")).toBeNull();
    expect(query("limit=1001")).toBeNull();
    expect(query("limit=abc")).toBeNull();
    expect(query("offset=-1")).toBeNull();
    expect(query("scheduledDate=not-a-date")).toBeNull();
  });

  it("treats a present-but-empty value as malformed, not as absent", () => {
    // `?status=` means the caller tried to filter and got it wrong. A caller
    // that means "no filter" omits the key.
    expect(query("status=")).toBeNull();
  });

  it("ignores unknown params instead of failing", () => {
    expect(query("wat=1&status=done")).toEqual({ status: "done" });
  });
});

describe("filterTodos", () => {
  const todos = [
    todo({ id: "a", status: "open", listId: "L1", scheduledDate: "2026-09-08" }),
    todo({ id: "b", status: "done", listId: "L1", labelIds: ["X"] }),
    todo({ id: "c", status: "open", listId: "L2", updatedAt: "2026-09-05T00:00:00.000Z" }),
  ];
  const ids = (result: Todo[]) => result.map((t) => t.id);

  it("no filters returns everything, in input order", () => {
    expect(ids(filterTodos(todos, {}))).toEqual(["a", "b", "c"]);
  });

  it("filters by status, listId and scheduledDate", () => {
    expect(ids(filterTodos(todos, { status: "open" }))).toEqual(["a", "c"]);
    expect(ids(filterTodos(todos, { listId: "L1" }))).toEqual(["a", "b"]);
    expect(ids(filterTodos(todos, { scheduledDate: "2026-09-08" }))).toEqual(["a"]);
  });

  it("filters by labelId, which lives in a JSON column SQL can't index into", () => {
    expect(ids(filterTodos(todos, { labelId: "X" }))).toEqual(["b"]);
    expect(ids(filterTodos(todos, { labelId: "nope" }))).toEqual([]);
  });

  it("updatedSince is strictly greater-than", () => {
    expect(ids(filterTodos(todos, { updatedSince: "2026-09-01T00:00:00.000Z" }))).toEqual(["c"]);
    expect(ids(filterTodos(todos, { updatedSince: "2026-09-09T00:00:00.000Z" }))).toEqual([]);
  });

  it("combines filters with AND", () => {
    expect(ids(filterTodos(todos, { status: "open", listId: "L1" }))).toEqual(["a"]);
  });

  /**
   * REGRESSION. `GET /api/v1/todos` shipped in A2 returning EVERY non-deleted
   * todo, and `openapi/v1.json` has been published with that contract since
   * A7. A default `limit` would silently truncate every existing consumer —
   * an account with 500 todos would start seeing 200, with no error and no
   * signal. `limit` is optional on purpose; see `todoQuerySchema`.
   */
  it("omitting limit returns everything — there is no implicit page size", () => {
    expect(todoQuerySchema.parse({}).limit).toBeUndefined();
    expect(filterTodos(todos, {})).toHaveLength(3);
    expect(filterTodos(todos, { offset: 0 })).toHaveLength(3);
  });

  it("pages through the FILTERED set, not the raw one", () => {
    expect(ids(filterTodos(todos, { status: "open", limit: 1 }))).toEqual(["a"]);
    expect(ids(filterTodos(todos, { status: "open", limit: 1, offset: 1 }))).toEqual(["c"]);
    expect(ids(filterTodos(todos, { status: "open", offset: 2 }))).toEqual([]);
  });
});
