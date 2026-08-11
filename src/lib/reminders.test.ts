import { describe, expect, it } from "vitest";
import { dueReminders, reminderFireKey } from "./reminders";
import type { Todo } from "./schema";

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    ownerId: "owner",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    title: "Stand up",
    description: null,
    status: "open",
    priority: null,
    scheduledDate: "2026-08-07",
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
    reminderTime: "09:00",
    ...overrides,
  };
}

const TZ = "UTC";
const TODAY = "2026-08-07";

describe("dueReminders", () => {
  it("fires once the reminder instant has passed", () => {
    const t = todo();
    const due = dueReminders([t], TODAY, "2026-08-07T09:00:00.000Z", TZ, new Set());
    expect(due.map((d) => d.id)).toEqual(["t1"]);
  });

  it("does not fire before the reminder instant", () => {
    const t = todo();
    const due = dueReminders([t], TODAY, "2026-08-07T08:59:59.000Z", TZ, new Set());
    expect(due).toEqual([]);
  });

  it("does not fire twice for the same key", () => {
    const t = todo();
    const fired = new Set([reminderFireKey(t)]);
    const due = dueReminders([t], TODAY, "2026-08-07T09:30:00.000Z", TZ, fired);
    expect(due).toEqual([]);
  });

  it("re-arms when the reminder time changes (new fire key)", () => {
    const t = todo({ reminderTime: "10:00" });
    const fired = new Set([reminderFireKey(todo({ reminderTime: "09:00" }))]);
    const due = dueReminders([t], TODAY, "2026-08-07T10:00:00.000Z", TZ, fired);
    expect(due.map((d) => d.id)).toEqual(["t1"]);
  });

  it("ignores a todo scheduled for a different day (rolled-over case)", () => {
    // Documented limitation: this rolled-over todo renders in today's column
    // but keeps yesterday's scheduledDate, so it gets no reminder in v1.
    const t = todo({ scheduledDate: "2026-08-06" });
    const due = dueReminders([t], TODAY, "2026-08-07T09:00:00.000Z", TZ, new Set());
    expect(due).toEqual([]);
  });

  it("ignores a todo with no reminderTime", () => {
    const t = todo({ reminderTime: null });
    const due = dueReminders([t], TODAY, "2026-08-07T09:00:00.000Z", TZ, new Set());
    expect(due).toEqual([]);
  });

  it("ignores a settled todo", () => {
    const t = todo({ status: "done" });
    const due = dueReminders([t], TODAY, "2026-08-07T09:00:00.000Z", TZ, new Set());
    expect(due).toEqual([]);
  });

  it("resolves against the todo's own timezone-relative instant, not UTC wall time", () => {
    const t = todo({ reminderTime: "09:00" });
    // 09:00 in America/New_York (EDT, -4) is 13:00 UTC.
    const notYet = dueReminders([t], TODAY, "2026-08-07T12:59:00.000Z", "America/New_York", new Set());
    expect(notYet).toEqual([]);
    const due = dueReminders([t], TODAY, "2026-08-07T13:00:00.000Z", "America/New_York", new Set());
    expect(due.map((d) => d.id)).toEqual(["t1"]);
  });
});

describe("reminderFireKey", () => {
  it("is unique per todo, date, and time", () => {
    const a = reminderFireKey(todo());
    const b = reminderFireKey(todo({ reminderTime: "10:00" }));
    const c = reminderFireKey(todo({ scheduledDate: "2026-08-08" }));
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
