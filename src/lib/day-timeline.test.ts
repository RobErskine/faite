import { describe, expect, it } from "vitest";
import { buildDayTimeline, formatEventTime, formatEventWhen } from "./day-timeline";
import type { Todo } from "./schema";

const DAY = "2026-08-10";
const UTC = "UTC";

function todo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    ownerId: "u",
    createdAt: `${DAY}T09:00:00.000Z`,
    updatedAt: `${DAY}T09:00:00.000Z`,
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

const kinds = (todos: Todo[], day = DAY, tz = UTC) =>
  buildDayTimeline(todos, day, tz).map((event) => `${event.todo.id}:${event.kind}`);

describe("buildDayTimeline", () => {
  it("reports a todo created that day", () => {
    expect(kinds([todo({ id: "a" })])).toEqual(["a:created"]);
  });

  it("ignores a todo created on another day", () => {
    expect(kinds([todo({ id: "a", createdAt: "2026-08-09T09:00:00.000Z" })])).toEqual([]);
  });

  it("reports a settle without a create when the todo was made earlier", () => {
    const rows = [
      todo({
        id: "a",
        createdAt: "2026-08-01T09:00:00.000Z",
        status: "done",
        completedAt: `${DAY}T14:00:00.000Z`,
      }),
    ];
    expect(kinds(rows)).toEqual(["a:done"]);
  });

  it("reports BOTH events when a todo is created and finished the same day", () => {
    const rows = [
      todo({
        id: "a",
        createdAt: `${DAY}T09:00:00.000Z`,
        status: "done",
        completedAt: `${DAY}T17:00:00.000Z`,
      }),
    ];
    expect(kinds(rows)).toEqual(["a:created", "a:done"]);
  });

  it("distinguishes dropped from done", () => {
    const rows = [
      todo({
        id: "a",
        createdAt: "2026-08-01T09:00:00.000Z",
        status: "dropped",
        completedAt: `${DAY}T14:00:00.000Z`,
      }),
    ];
    expect(kinds(rows)).toEqual(["a:dropped"]);
  });

  it("emits no settle event for a reopened todo, even with a stale completedAt", () => {
    // `statusPatch` nulls `completedAt` on reopen, so this state should not
    // occur — but a stale row arriving over sync must not resurrect the event.
    const rows = [
      todo({
        id: "a",
        createdAt: "2026-08-01T09:00:00.000Z",
        status: "open",
        completedAt: `${DAY}T14:00:00.000Z`,
      }),
    ];
    expect(kinds(rows)).toEqual([]);
  });

  it("orders events oldest first across todos", () => {
    const rows = [
      todo({ id: "late", createdAt: `${DAY}T18:00:00.000Z` }),
      todo({ id: "early", createdAt: `${DAY}T06:00:00.000Z` }),
      todo({ id: "mid", createdAt: `${DAY}T12:00:00.000Z` }),
    ];
    expect(kinds(rows)).toEqual(["early:created", "mid:created", "late:created"]);
  });

  it("breaks ties deterministically so order cannot flip between renders", () => {
    const at = `${DAY}T09:00:00.000Z`;
    const rows = [todo({ id: "b", createdAt: at }), todo({ id: "a", createdAt: at })];
    expect(kinds(rows)).toEqual(["a:created", "b:created"]);
  });

  it("assigns the day using the viewer's timezone, not UTC", () => {
    // 04:00Z on the 11th is still the evening of the 10th in Los Angeles.
    const rows = [todo({ id: "a", createdAt: "2026-08-11T04:00:00.000Z" })];
    expect(kinds(rows, DAY, "America/Los_Angeles")).toEqual(["a:created"]);
    expect(kinds(rows, DAY, UTC)).toEqual([]);
  });

  it("skips an unparseable timestamp instead of throwing", () => {
    expect(() => kinds([todo({ id: "a", createdAt: "not-a-date" })])).not.toThrow();
    expect(kinds([todo({ id: "a", createdAt: "not-a-date" })])).toEqual([]);
  });

  it("carries the instant and a unique key on each event", () => {
    const events = buildDayTimeline(
      [todo({ id: "a", status: "done", completedAt: `${DAY}T17:00:00.000Z` })],
      DAY,
      UTC,
    );
    expect(events.map((e) => e.key)).toEqual(["a:created", "a:done"]);
    expect(events[1].at).toBe(`${DAY}T17:00:00.000Z`);
  });

  describe("scheduled — the todo's CURRENT day, not the move's day", () => {
    const NEXT_DAY = "2026-08-11";

    it("shows up on the day the todo is scheduled for, timestamped with the move", () => {
      // Created and scheduled onto DAY yesterday; today (DAY-1, i.e. before
      // DAY) it was dragged onto NEXT_DAY. Viewing NEXT_DAY should show the
      // move, timestamped with when it happened — not when it lands.
      const rows = [
        todo({
          id: "a",
          createdAt: "2026-08-01T09:00:00.000Z",
          scheduledDate: NEXT_DAY,
          scheduledAt: `${DAY}T15:00:00.000Z`,
        }),
      ];
      expect(kinds(rows, NEXT_DAY)).toEqual(["a:scheduled"]);
      expect(kinds(rows, DAY)).toEqual([]); // nothing on the day the move happened
    });

    it("does not appear for a todo created directly onto a day (never rescheduled)", () => {
      // createTodo() never stamps scheduledAt — see repositories.ts. A todo
      // quick-added straight onto DAY should show only "created", not a
      // redundant "scheduled" echoing the same instant.
      const rows = [todo({ id: "a", scheduledDate: DAY, scheduledAt: null })];
      expect(kinds(rows)).toEqual(["a:created"]);
    });

    it("is silent for a todo currently unscheduled, even with a stale scheduledAt", () => {
      const rows = [
        todo({
          id: "a",
          createdAt: "2026-08-01T09:00:00.000Z",
          scheduledDate: null,
          scheduledAt: `${DAY}T15:00:00.000Z`,
        }),
      ];
      expect(kinds(rows, DAY)).toEqual([]);
    });

    it("disappears once the todo is moved elsewhere (only the latest placement survives)", () => {
      // NEXT_DAY's "scheduled" event for a todo now living on a THIRD day is
      // gone — the documented limitation, not a bug.
      const rows = [
        todo({
          id: "a",
          createdAt: "2026-08-01T09:00:00.000Z",
          scheduledDate: "2026-08-12",
          scheduledAt: `${DAY}T15:00:00.000Z`,
        }),
      ];
      expect(kinds(rows, NEXT_DAY)).toEqual([]);
    });

    it("can co-occur with created/done/dropped on the same day, ordered by instant", () => {
      const rows = [
        todo({
          id: "a",
          createdAt: `${DAY}T07:00:00.000Z`,
          scheduledDate: DAY,
          scheduledAt: `${DAY}T09:00:00.000Z`,
          status: "done",
          completedAt: `${DAY}T18:00:00.000Z`,
        }),
      ];
      expect(kinds(rows)).toEqual(["a:created", "a:scheduled", "a:done"]);
    });
  });
});

describe("formatEventWhen", () => {
  it("is a bare time when the event's day matches the timeline being viewed", () => {
    expect(formatEventWhen(`${DAY}T14:30:00.000Z`, DAY, UTC)).toBe("2:30 PM");
  });

  it("prefixes the date when the event happened on a different day", () => {
    expect(formatEventWhen("2026-08-09T14:30:00.000Z", DAY, UTC)).toBe("Aug 9 · 2:30 PM");
  });

  it("falls back to a bare time when the instant is unparseable", () => {
    expect(formatEventWhen("nope", DAY, UTC)).toBe("");
  });
});

describe("formatEventTime", () => {
  it("formats an instant in the given timezone", () => {
    expect(formatEventTime(`${DAY}T14:30:00.000Z`, UTC)).toBe("2:30 PM");
  });

  it("shifts with the timezone", () => {
    expect(formatEventTime(`${DAY}T14:30:00.000Z`, "America/Los_Angeles")).toBe("7:30 AM");
  });

  it("returns an empty string for an unparseable instant", () => {
    expect(formatEventTime("nope", UTC)).toBe("");
  });

  it("falls back to UTC for an unknown timezone rather than throwing", () => {
    expect(formatEventTime(`${DAY}T14:30:00.000Z`, "Mars/Olympus")).toBe("2:30 PM");
  });
});
