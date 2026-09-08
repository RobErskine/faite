import { describe, expect, it } from "vitest";
import { listSchema, settingsSchema, todoSchema, type List, type Todo } from "@/lib/schema";
import { settingsOrDefault } from "../mcp/settings-defaults";
import { backlogTodos, overflowTodos, profileFromSettings, profileSchema } from "./derived";

const NOW = new Date("2026-09-08T12:00:00.000Z");

const todo = (overrides: Partial<Todo>): Todo =>
  todoSchema.parse({
    id: "t1",
    ownerId: "u1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    title: "Task",
    position: "a0",
    ...overrides,
  });

const list = (overrides: Partial<List>): List =>
  listSchema.parse({
    id: "l1",
    ownerId: "u1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    name: "List",
    position: "a0",
    ...overrides,
  });

const settings = (overrides: Record<string, unknown> = {}) =>
  settingsSchema.parse({ ownerId: "u1", updatedAt: NOW.toISOString(), timezone: "UTC", ...overrides });

describe("overflowTodos", () => {
  /** Overflow is the Faite Loop. A to-do slips into it once it has been
   * missed for longer than `overflowAfterDays` allows. */
  it("returns to-dos that slipped past the window, and nothing else", () => {
    const todos = [
      todo({ id: "old", scheduledDate: "2026-08-01" }),
      todo({ id: "today", scheduledDate: "2026-09-08" }),
      todo({ id: "future", scheduledDate: "2026-12-01" }),
      todo({ id: "unscheduled", scheduledDate: null }),
    ];

    const result = overflowTodos(todos, settings({ overflowAfterDays: 3 }), NOW);

    expect(result.map((t) => t.id)).toEqual(["old"]);
  });

  it("honours a non-default overflowAfterDays", () => {
    const todos = [todo({ id: "slipped", scheduledDate: "2026-09-06" })];

    // Two days late: inside a 3-day grace, outside a 0-day one.
    expect(overflowTodos(todos, settings({ overflowAfterDays: 3 }), NOW)).toHaveLength(0);
    expect(overflowTodos(todos, settings({ overflowAfterDays: 0 }), NOW)).toHaveLength(1);
  });

  /**
   * PLACEMENT, not a view. `deriveColumn` reads `status` only for the
   * deadline badge, never to decide a column, so a completed-but-overdue
   * to-do is genuinely in Overflow — and the board hides it via
   * `visibleStatuses`, not via placement.
   *
   * Asserted rather than "fixed" so this endpoint keeps answering the same
   * question `deriveColumn` and MCP's `get_overflow` answer. A caller that
   * wants only open work filters on `status`.
   */
  it("reports placement, not visibility — a completed overdue to-do is still in Overflow", () => {
    const todos = [
      todo({ id: "done", scheduledDate: "2026-08-01", status: "done", completedAt: NOW.toISOString() }),
    ];

    expect(overflowTodos(todos, settings({ overflowAfterDays: 0 }), NOW).map((t) => t.id)).toEqual([
      "done",
    ]);
  });

  it("works for an account that never wrote a Settings row", () => {
    const todos = [todo({ id: "old", scheduledDate: "2026-01-01" })];

    const result = overflowTodos(todos, settingsOrDefault(null, "u1"), NOW);

    expect(result.map((t) => t.id)).toEqual(["old"]);
  });
});

describe("backlogTodos", () => {
  const lists = [list({ id: "backlog", isBacklog: true }), list({ id: "other" })];

  it("returns only the to-dos filed in the Backlog list", () => {
    const todos = [
      todo({ id: "a", listId: "backlog" }),
      todo({ id: "b", listId: "other" }),
      todo({ id: "c", listId: null }),
    ];

    expect(backlogTodos(todos, lists).map((t) => t.id)).toEqual(["a"]);
  });

  /** Should be impossible, but a read endpoint is the wrong place to discover
   * it — and "nothing is in Backlog" is true either way. */
  it("returns empty rather than throwing when no Backlog list exists", () => {
    expect(backlogTodos([todo({ id: "a", listId: "x" })], [list({ id: "other" })])).toEqual([]);
  });
});

describe("profileFromSettings", () => {
  it("exposes identity plus the Faite Loop config a client needs", () => {
    expect(Object.keys(profileFromSettings(settings())).sort()).toEqual([
      "avatarEmoji",
      "avatarImage",
      "avatarInitials",
      "avatarKind",
      "displayName",
      "overflowAfterDays",
      "timezone",
      "visibleDays",
      "workdays",
    ]);
  });

  /**
   * REGRESSION. These live in the same Settings row but describe ONE
   * DEVICE'S SCREEN, not the account — handing them to a launcher on another
   * machine is meaningless at best. MCP's `get_profile` reads this same
   * schema, so this assertion covers both surfaces.
   */
  it("never leaks device-local board preferences", () => {
    const profile = profileFromSettings(
      settings({ backlogWidth: 320, splitRatio: 50, workdaysOnly: true }),
    );

    for (const key of ["backlogWidth", "splitRatio", "workdaysOnly"]) {
      expect(profile).not.toHaveProperty(key);
    }
    for (const key of Object.keys(profile)) {
      expect(key.startsWith("overdrive")).toBe(false);
    }
  });

  it("is the single source of the field list, shared with MCP get_profile", () => {
    // If this ever diverges from `profileFromSettings`, one of the two
    // surfaces is hand-picking again.
    expect(Object.keys(profileSchema.shape).sort()).toEqual(
      Object.keys(profileFromSettings(settings())).sort(),
    );
  });
});
