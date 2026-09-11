import { describe, expect, it } from "vitest";
import { activeDays, buildDayLog, type DayLogTodo } from "./day-log";
import type { TodoEvent } from "./schema";

const TZ = "America/New_York";
const MON = "2026-09-07";
const WED = "2026-09-09";

let seq = 0;
function event(
  todoId: string,
  kind: string,
  at: string,
  payload: Record<string, unknown> | null = null,
  deletedAt: string | null = null,
): TodoEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    ownerId: "u",
    createdAt: at,
    updatedAt: at,
    deletedAt,
    todoId,
    kind,
    at,
    payload: payload ? JSON.stringify({ v: 1, ...payload }) : null,
  };
}

/** Noon in New York on `day`, plus `minutes`. EDT is UTC-4 in September. */
const at = (day: string, minutes = 0) =>
  new Date(Date.parse(`${day}T16:00:00.000Z`) + minutes * 60_000).toISOString();

const todos = new Map<string, DayLogTodo>([
  ["a", { title: "Write the report", deletedAt: null, listId: "work" }],
  ["b", { title: "Call the bank", deletedAt: null, listId: null }],
  ["gone", { title: "Old idea", deletedAt: "2026-09-08T00:00:00.000Z", listId: null }],
]);

const kinds = (entries: { kind: string; todoId: string }[]) => entries.map((e) => `${e.kind}:${e.todoId}`);

describe("buildDayLog", () => {
  it("lists what got done that day", () => {
    const log = buildDayLog([event("a", "done", at(MON))], todos, MON, TZ);
    expect(kinds(log.done)).toEqual(["done:a"]);
    expect(log.done[0].title).toBe("Write the report");
  });

  it("done on Monday and reopened on Wednesday is still done on Monday", () => {
    // The limit this whole module exists to escape: the derived day timeline
    // loses Monday the moment `completedAt` is cleared.
    const events = [event("a", "done", at(MON)), event("a", "reopened", at(WED))];
    expect(kinds(buildDayLog(events, todos, MON, TZ).done)).toEqual(["done:a"]);
    expect(buildDayLog(events, todos, WED, TZ).done).toEqual([]);
  });

  it("done and reopened on the same day is not something that got done", () => {
    const events = [event("a", "done", at(MON)), event("a", "reopened", at(MON, 5))];
    const log = buildDayLog(events, todos, MON, TZ);
    expect(log.done).toEqual([]);
    expect(log.decisions).toEqual([]);
  });

  it("the last status change of the day decides", () => {
    const events = [event("a", "done", at(MON)), event("a", "dropped", at(MON, 5))];
    const log = buildDayLog(events, todos, MON, TZ);
    expect(log.done).toEqual([]);
    expect(kinds(log.decisions)).toEqual(["dropped:a"]);
  });

  it("hides an event that was undone", () => {
    const events = [event("a", "done", at(MON), null, at(MON, 1))];
    expect(buildDayLog(events, todos, MON, TZ).done).toEqual([]);
  });

  it("collapses several reschedules in one day into first-from → last-to", () => {
    const events = [
      event("a", "scheduled", at(MON), { from: "2026-09-07", to: "2026-09-08" }),
      event("a", "scheduled", at(MON, 10), { from: "2026-09-08", to: "2026-09-11" }),
    ];
    const [row] = buildDayLog(events, todos, MON, TZ).decisions;
    expect(row).toMatchObject({ kind: "scheduled", from: "2026-09-07", to: "2026-09-11" });
  });

  it("moving a to-do and moving it back is not a decision", () => {
    const events = [
      event("a", "scheduled", at(MON), { from: "2026-09-07", to: "2026-09-08" }),
      event("a", "scheduled", at(MON, 10), { from: "2026-09-08", to: "2026-09-07" }),
    ];
    expect(buildDayLog(events, todos, MON, TZ).decisions).toEqual([]);
  });

  it("a move back to a list is one row, not a move plus an unschedule", () => {
    const events = [
      event("b", "moved", at(MON), { fromListId: null, toListId: "home", toListName: "Home" }),
      event("b", "unscheduled", at(MON), { from: "2026-09-07", to: null }),
    ];
    const log = buildDayLog(events, todos, MON, TZ);
    expect(kinds(log.decisions)).toEqual(["moved:b"]);
    expect(log.decisions[0].toListName).toBe("Home");
  });

  it("marks a decision made in Overdrive", () => {
    const events = [event("a", "dropped", at(MON), { via: "overdrive" }), event("b", "done", at(MON, 1))];
    const log = buildDayLog(events, todos, MON, TZ);
    expect(log.decisions[0].viaOverdrive).toBe(true);
    expect(log.done[0].viaOverdrive).toBe(false);
  });

  it("names a deleted to-do and does not link it", () => {
    const events = [event("gone", "deleted", at(MON), { title: "Old idea" })];
    const [row] = buildDayLog(events, todos, MON, TZ).decisions;
    expect(row).toMatchObject({ kind: "deleted", title: "Old idea", deleted: true });
  });

  it("falls back to the title snapshot when the row is missing entirely", () => {
    const events = [event("nowhere", "deleted", at(MON), { title: "Snapshot title" })];
    expect(buildDayLog(events, todos, MON, TZ).decisions[0].title).toBe("Snapshot title");
  });

  it("lists what was added, and leaves out edits and attachments", () => {
    const events = [
      event("a", "created", at(MON)),
      event("a", "edited", at(MON, 1), { fields: ["title"] }),
      event("a", "attached", at(MON, 2), { filename: "x.pdf" }),
    ];
    const log = buildDayLog(events, todos, MON, TZ);
    expect(kinds(log.added)).toEqual(["created:a"]);
    expect(log.decisions).toEqual([]);
    expect(log.done).toEqual([]);
  });

  it("puts each section in the order it happened", () => {
    const events = [event("b", "done", at(MON, 30)), event("a", "done", at(MON))];
    expect(kinds(buildDayLog(events, todos, MON, TZ).done)).toEqual(["done:a", "done:b"]);
  });

  it("uses the user's day, not UTC's", () => {
    // 11:30 PM in New York on Monday is already Tuesday in UTC.
    const lateMonday = "2026-09-08T03:30:00.000Z";
    const events = [event("a", "done", lateMonday)];
    expect(kinds(buildDayLog(events, todos, MON, TZ).done)).toEqual(["done:a"]);
    expect(buildDayLog(events, todos, "2026-09-08", TZ).done).toEqual([]);
  });

  it("holds its day boundary across a DST change", () => {
    // Nov 1 2026 is a 25-hour day in New York. 11:30 PM that night is
    // 04:30 UTC on Nov 2 (EST, UTC-5), not 03:30.
    const lateSunday = "2026-11-02T04:30:00.000Z";
    const events = [event("a", "done", lateSunday)];
    expect(kinds(buildDayLog(events, todos, "2026-11-01", TZ).done)).toEqual(["done:a"]);
  });
});

describe("activeDays", () => {
  it("marks days with something finished or let go", () => {
    const events = [
      event("a", "done", at(MON)),
      event("b", "dropped", at(WED)),
      event("b", "created", at("2026-09-08")),
    ];
    expect([...activeDays(events, TZ)].sort()).toEqual([MON, WED]);
  });

  it("does not mark a day whose only completion was reopened that day", () => {
    const events = [event("a", "done", at(MON)), event("a", "reopened", at(MON, 5))];
    expect(activeDays(events, TZ).size).toBe(0);
  });

  it("does not mark a day whose only completion was undone", () => {
    expect(activeDays([event("a", "done", at(MON), null, at(MON, 1))], TZ).size).toBe(0);
  });
});
