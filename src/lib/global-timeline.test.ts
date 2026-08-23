import { describe, expect, it } from "vitest";
import type { TodoEvent } from "./schema";
import { buildGlobalTimeline, type TodoTitleInfo } from "./global-timeline";
import type { DailyRollSummary } from "./rollover-events";

function event(overrides: Partial<TodoEvent> & Pick<TodoEvent, "kind" | "at" | "todoId">): TodoEvent {
  return {
    id: overrides.id ?? `event-${overrides.todoId}-${overrides.at}-${overrides.kind}`,
    ownerId: "local-user",
    createdAt: overrides.at,
    updatedAt: overrides.at,
    deletedAt: null,
    payload: null,
    ...overrides,
  };
}

const NO_TITLES: ReadonlyMap<string, TodoTitleInfo> = new Map();

describe("buildGlobalTimeline", () => {
  it("orders newest-first, tiebroken by id descending", () => {
    const titles = new Map([
      ["todo-a", { title: "A", deleted: false }],
      ["todo-b", { title: "B", deleted: false }],
    ]);
    const a = event({ id: "id-a", todoId: "todo-a", kind: "created", at: "2026-08-10T09:00:00.000Z" });
    const b = event({ id: "id-b", todoId: "todo-b", kind: "created", at: "2026-08-10T10:00:00.000Z" });

    const items = buildGlobalTimeline([a, b], [], titles, "UTC", "2026-08-10", { atCap: false });
    const eventItems = items.filter((i) => i.type === "event");
    expect(eventItems.map((i) => (i.type === "event" ? i.event.todoId : null))).toEqual(["todo-b", "todo-a"]);
  });

  it("day grouping uses the viewer's timezone, not UTC", () => {
    const titles = new Map([["todo-a", { title: "Late night task", deleted: false }]]);
    // 23:30 UTC on Aug 10 is 19:30 America/New_York on Aug 10 — same day in
    // both zones. Use 03:30 UTC on Aug 11, which is 23:30 America/New_York
    // on Aug 10 — the case that actually distinguishes the two zones.
    const e = event({ todoId: "todo-a", kind: "created", at: "2026-08-11T03:30:00.000Z" });

    const utcItems = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-11", { atCap: false });
    const nyItems = buildGlobalTimeline([e], [], titles, "America/New_York", "2026-08-11", { atCap: false });

    const utcHeader = utcItems.find((i) => i.type === "day-header");
    const nyHeader = nyItems.find((i) => i.type === "day-header");
    expect(utcHeader).toMatchObject({ type: "day-header", day: "2026-08-11" });
    expect(nyHeader).toMatchObject({ type: "day-header", day: "2026-08-10" });
  });

  it('labels the viewer\'s "today" and the day before as Today/Yesterday', () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const todayEvent = event({ id: "e-today", todoId: "todo-a", kind: "created", at: "2026-08-10T12:00:00.000Z" });
    const yesterdayEvent = event({
      id: "e-yesterday",
      todoId: "todo-a",
      kind: "done",
      at: "2026-08-09T12:00:00.000Z",
    });

    const items = buildGlobalTimeline([todayEvent, yesterdayEvent], [], titles, "UTC", "2026-08-10", {
      atCap: false,
    });
    const headers = items.filter((i) => i.type === "day-header");
    expect(headers.map((h) => (h.type === "day-header" ? h.label : null))).toEqual(["Today", "Yesterday"]);
  });

  it("pairs a relative phrase with the date for 2-13 days ago, then drops to a bare date", () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const days = [
      ["2026-08-07", "3 days ago · Aug 7"], // 3 days before 2026-08-10
      ["2026-08-01", "Last week · Aug 1"], // 9 days before
      ["2026-07-27", "Jul 27"], // 14 days before -> bare date, same year
    ] as const;

    for (const [day, expected] of days) {
      const e = event({ todoId: "todo-a", kind: "created", at: `${day}T09:00:00.000Z` });
      const items = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-10", { atCap: false });
      const header = items.find((i) => i.type === "day-header");
      expect(header).toMatchObject({ label: expected });
    }
  });

  it("includes the year once a day-header crosses into a different year", () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const e = event({ todoId: "todo-a", kind: "created", at: "2025-12-01T09:00:00.000Z" });

    const items = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-10", { atCap: false });
    const header = items.find((i) => i.type === "day-header");
    expect(header).toMatchObject({ label: "Dec 1, 2025" });
  });

  it("resolves a deleted todo's title from the tombstone map first", () => {
    const titles = new Map([["todo-a", { title: "Ghost task", deleted: true }]]);
    const e = event({ todoId: "todo-a", kind: "moved", at: "2026-08-10T09:00:00.000Z" });

    const items = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-10", { atCap: false });
    const evt = items.find((i) => i.type === "event");
    expect(evt).toMatchObject({ type: "event", event: { title: "Ghost task", deleted: true } });
  });

  it("falls back to the `deleted` payload's title snapshot when the todo row is gone entirely", () => {
    const e = event({
      todoId: "todo-a",
      kind: "deleted",
      at: "2026-08-10T09:00:00.000Z",
      payload: JSON.stringify({ v: 1, title: "Snapshot title" }),
    });

    const items = buildGlobalTimeline([e], [], NO_TITLES, "UTC", "2026-08-10", { atCap: false });
    const evt = items.find((i) => i.type === "event");
    expect(evt).toMatchObject({ type: "event", event: { title: "Snapshot title", deleted: true } });
  });

  it("falls back to a placeholder when neither the tombstone nor a payload snapshot exists", () => {
    const e = event({ todoId: "todo-a", kind: "done", at: "2026-08-10T09:00:00.000Z" });

    const items = buildGlobalTimeline([e], [], NO_TITLES, "UTC", "2026-08-10", { atCap: false });
    const evt = items.find((i) => i.type === "event");
    expect(evt).toMatchObject({ type: "event", event: { title: "(deleted to-do)", deleted: true } });
  });

  it("passes an unrecognized kind through unchanged rather than dropping the row", () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const e = event({ todoId: "todo-a", kind: "frobnicated", at: "2026-08-10T09:00:00.000Z" });

    const items = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-10", { atCap: false });
    const evt = items.find((i) => i.type === "event");
    expect(evt).toMatchObject({ type: "event", event: { kind: "frobnicated" } });
  });

  it("merges a rollup summary in by `at`, alongside real events", () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const e = event({ todoId: "todo-a", kind: "created", at: "2026-08-10T09:00:00.000Z" });
    const rollup: DailyRollSummary = {
      key: "rolledOver:2026-08-10",
      kind: "rolledOver",
      day: "2026-08-10",
      at: "2026-08-10T00:00:00.000Z",
      todos: [{ id: "todo-b", title: "Rolled task" } as never],
    };

    const items = buildGlobalTimeline([e], [rollup], titles, "UTC", "2026-08-10", { atCap: false });
    const rollupItem = items.find((i) => i.type === "rollup");
    expect(rollupItem).toMatchObject({
      type: "rollup",
      kind: "rolledOver",
      day: "2026-08-10",
      at: "2026-08-10T00:00:00.000Z",
    });
    if (rollupItem?.type === "rollup") expect(rollupItem.todos).toHaveLength(1);
  });

  it("clips a rollup older than the oldest loaded event out of the page", () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const e = event({ todoId: "todo-a", kind: "created", at: "2026-08-10T09:00:00.000Z" });
    const oldRollup: DailyRollSummary = {
      key: "rolledOver:2026-07-01",
      kind: "rolledOver",
      day: "2026-07-01",
      at: "2026-07-01T00:00:00.000Z",
      todos: [{ id: "todo-b" } as never],
    };

    const items = buildGlobalTimeline([e], [oldRollup], titles, "UTC", "2026-08-10", { atCap: false });
    expect(items.some((i) => i.type === "rollup")).toBe(false);
  });

  it("appends a `truncated` marker at cap, and omits it otherwise", () => {
    const titles = new Map([["todo-a", { title: "Task", deleted: false }]]);
    const e = event({ todoId: "todo-a", kind: "created", at: "2026-08-10T09:00:00.000Z" });

    const atCap = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-10", { atCap: true });
    const notAtCap = buildGlobalTimeline([e], [], titles, "UTC", "2026-08-10", { atCap: false });

    expect(atCap.at(-1)).toEqual({ type: "marker", key: "truncated" });
    expect(notAtCap.some((i) => i.type === "marker")).toBe(false);
  });

  it("returns an empty feed for no events and no rollups", () => {
    expect(buildGlobalTimeline([], [], NO_TITLES, "UTC", "2026-08-10", { atCap: false })).toEqual([]);
  });
});
