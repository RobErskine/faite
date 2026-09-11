import { describe, expect, it } from "vitest";
import {
  activeDays,
  buildDayLog,
  dayCompletions,
  dayTints,
  type DayLogTodo,
  type ListResolver,
} from "./day-log";
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

const BLUE = "#0090ff";
const RED = "#e5484d";
const LISTS: Record<string, { id: string; color: string | null; name: string }> = {
  work: { id: "work", color: BLUE, name: "Work" },
  errands: { id: "errands", color: RED, name: "Errands" },
  reading: { id: "reading", color: BLUE, name: "Reading" },
  inbox: { id: "inbox", color: null, name: "Inbox" },
};
const resolve: ListResolver = (listId) => (listId ? (LISTS[listId] ?? null) : null);
const current = new Map<string, Pick<DayLogTodo, "listId">>();

describe("dayCompletions (EI-324)", () => {
  const rows = (events: TodoEvent[], todosById = current) =>
    dayCompletions(events, todosById, resolve, TZ).get(MON)?.map((r) => `${r.count} ${r.name}`);

  it("counts each list's completions, most first", () => {
    const events = [
      event("a", "done", at(MON), { listId: "errands" }),
      event("b", "done", at(MON, 1), { listId: "work" }),
      event("c", "done", at(MON, 2), { listId: "work" }),
      event("d", "done", at(MON, 3), { listId: "reading" }),
      event("e", "done", at(MON, 4), { listId: "work" }),
    ];
    expect(rows(events)).toEqual(["3 Work", "1 Reading", "1 Errands"]);
  });

  it("keeps lists that share a color apart — the tint pools them, the card does not", () => {
    const events = [
      event("a", "done", at(MON), { listId: "work" }),
      event("b", "done", at(MON, 1), { listId: "reading" }),
    ];
    expect(rows(events)).toEqual(["1 Reading", "1 Work"]);
  });

  it("breaks a tie with the most recent completion", () => {
    const events = [
      event("a", "done", at(MON), { listId: "errands" }),
      event("b", "done", at(MON, 1), { listId: "work" }),
    ];
    expect(rows(events)).toEqual(["1 Work", "1 Errands"]);
  });

  it("keeps a list with no color, with no color", () => {
    const events = [event("a", "done", at(MON), { listId: "inbox" })];
    expect(dayCompletions(events, current, resolve, TZ).get(MON)).toEqual([
      { listId: "inbox", name: "Inbox", color: null, count: 1, lastAt: at(MON) },
    ]);
  });

  it("counts neither Won't do nor a completion reopened the same day", () => {
    const events = [
      event("a", "dropped", at(MON), { listId: "work" }),
      event("b", "done", at(MON, 1), { listId: "work" }),
      event("b", "reopened", at(MON, 2)),
    ];
    expect(dayCompletions(events, current, resolve, TZ).has(MON)).toBe(false);
  });

  it("uses the list recorded on the event, else the to-do's current list", () => {
    const events = [
      event("a", "done", at(MON), { listId: "errands" }),
      event("b", "done", at(MON, 1)),
    ];
    const now = new Map([
      ["a", { listId: "work" }],
      ["b", { listId: "errands" }],
    ]);
    expect(rows(events, now)).toEqual(["2 Errands"]);
  });

  it("files each completion under its own day", () => {
    const events = [
      event("a", "done", at(MON), { listId: "work" }),
      event("b", "done", at(WED), { listId: "errands" }),
    ];
    const byDay = dayCompletions(events, current, resolve, TZ);
    expect([...byDay.keys()].sort()).toEqual([MON, WED]);
  });
});

describe("dayTints (EI-323)", () => {
  const tints = (events: TodoEvent[], todosById = current) =>
    dayTints(dayCompletions(events, todosById, resolve, TZ));

  it("tints a day by the color with the most completions", () => {
    const events = [
      event("a", "done", at(MON), { listId: "work" }),
      event("b", "done", at(MON, 1), { listId: "work" }),
      event("c", "done", at(MON, 2), { listId: "errands" }),
    ];
    expect(tints(events).get(MON)).toEqual({ color: BLUE, listName: "Work" });
  });

  it("pools two lists that share a color, and names the bigger one", () => {
    const events = [
      event("a", "done", at(MON), { listId: "work" }),
      event("b", "done", at(MON, 1), { listId: "reading" }),
      event("c", "done", at(MON, 2), { listId: "reading" }),
      event("d", "done", at(MON, 3), { listId: "errands" }),
      event("e", "done", at(MON, 4), { listId: "errands" }),
    ];
    // Blue 3 (Work 1 + Reading 2) beats red 2.
    expect(tints(events).get(MON)).toEqual({ color: BLUE, listName: "Reading" });
  });

  it("breaks a tie with the most recent completion", () => {
    const events = [
      event("a", "done", at(MON), { listId: "work" }),
      event("b", "done", at(MON, 5), { listId: "errands" }),
    ];
    expect(tints(events).get(MON)?.color).toBe(RED);
  });

  it("never tints for Won't do", () => {
    const events = [event("a", "dropped", at(MON), { listId: "errands" })];
    expect(tints(events).size).toBe(0);
  });

  it("skips a completion that was reopened the same day", () => {
    const events = [
      event("a", "done", at(MON), { listId: "errands" }),
      event("a", "reopened", at(MON, 5)),
      event("b", "done", at(MON, 6), { listId: "work" }),
    ];
    expect(tints(events).get(MON)?.color).toBe(BLUE);
  });

  it("uses the list recorded on the event, not where the to-do is now", () => {
    // Finished in Errands on Monday, moved to Work on Wednesday: Monday stays red.
    const movedSince = new Map([["a", { listId: "work" }]]);
    const events = [event("a", "done", at(MON), { listId: "errands" })];
    expect(tints(events, movedSince).get(MON)?.color).toBe(RED);
  });

  it("falls back to the current list for an event written before lists were recorded", () => {
    const now = new Map([["a", { listId: "errands" }]]);
    const events = [event("a", "done", at(MON))];
    expect(tints(events, now).get(MON)?.color).toBe(RED);
  });

  it("leaves a day untinted when nothing it finished has a color", () => {
    const events = [event("a", "done", at(MON), { listId: "inbox" }), event("b", "done", at(MON, 1), { listId: null })];
    expect(tints(events).has(MON)).toBe(false);
  });

  it("returns a color and a name, never a count", () => {
    const events = [event("a", "done", at(MON), { listId: "work" })];
    expect(Object.keys(tints(events).get(MON)!).sort()).toEqual([
      "color",
      "listName",
    ]);
  });
});
