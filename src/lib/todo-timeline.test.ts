import { describe, expect, it } from "vitest";
import type { TodoEvent } from "./schema";
import { buildTodoTimeline, HISTORY_STARTS_AT } from "./todo-timeline";
import type { PlacementContext } from "./scheduling";

const TODO = {
  id: "todo-1",
  createdAt: "2020-01-01T00:00:00.000Z",
  status: "open" as const,
  scheduledDate: null,
  recurrenceParentId: null,
};

function event(overrides: Partial<TodoEvent> & Pick<TodoEvent, "kind" | "at">): TodoEvent {
  return {
    id: overrides.id ?? `event-${overrides.at}-${overrides.kind}`,
    ownerId: "local-user",
    createdAt: overrides.at,
    updatedAt: overrides.at,
    deletedAt: null,
    todoId: TODO.id,
    payload: null,
    ...overrides,
  };
}

describe("buildTodoTimeline", () => {
  it("synthesizes a `created` row + marker when no real `created` event exists", () => {
    const items = buildTodoTimeline([], TODO);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "event", event: { kind: "created", synthetic: true, at: TODO.createdAt } });
    expect(items[1]).toEqual({ type: "marker", key: "history-start" });
  });

  it(
    "REGRESSION: a post-HISTORY_STARTS_AT todo with no real `created` event (e.g. a " +
      "recurrence template, which deliberately logs none) gets the synthetic row but NOT " +
      "the marker — there is no history gap to announce",
    () => {
      const recentTodo = {
        id: "todo-2",
        createdAt: "2026-08-20T00:00:00.000Z",
        status: "open" as const,
        scheduledDate: null,
        recurrenceParentId: null,
      };
      expect(recentTodo.createdAt > HISTORY_STARTS_AT).toBe(true);

      const items = buildTodoTimeline([], recentTodo);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: "event", event: { kind: "created", synthetic: true } });
    },
  );

  it("suppresses the synthetic `created` when a real one exists", () => {
    const created = event({ kind: "created", at: "2026-08-13T01:00:00.000Z" });
    const items = buildTodoTimeline([created], TODO);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "event", event: { kind: "created" } });
    if (items[0].type === "event") expect(items[0].event.synthetic).toBeUndefined();
    expect(items.some((i) => i.type === "marker")).toBe(false);
  });

  it("orders by `at`, tiebreaking by `id` when instants are identical", () => {
    const SAME = "2026-08-13T01:00:00.000Z";
    const a = event({ id: "b-event", kind: "scheduled", at: SAME });
    const b = event({ id: "a-event", kind: "moved", at: SAME });
    const created = event({ id: "0-created", kind: "created", at: "2026-08-13T00:00:00.000Z" });

    const items = buildTodoTimeline([a, b, created], TODO);
    expect(items.map((i) => (i.type === "event" ? i.event.key : i.key))).toEqual([
      "0-created",
      "a-event",
      "b-event",
    ]);
  });

  it("passes an unrecognized `kind` through unchanged, rather than throwing", () => {
    const created = event({ kind: "created", at: "2026-08-13T00:00:00.000Z" });
    const mystery = event({ kind: "some-future-kind", at: "2026-08-13T01:00:00.000Z" });
    const items = buildTodoTimeline([created, mystery], TODO);
    const kinds = items.filter((i) => i.type === "event").map((i) => (i.type === "event" ? i.event.kind : ""));
    expect(kinds).toContain("some-future-kind");
  });

  describe("coalescing adjacent `edited` events", () => {
    it("merges two edits inside the window, unioning fields and keeping the earlier `at`", () => {
      const first = event({
        kind: "edited",
        at: "2026-08-13T00:00:00.000Z",
        payload: JSON.stringify({ v: 1, fields: ["title"] }),
      });
      const second = event({
        kind: "edited",
        at: "2026-08-13T00:01:30.000Z", // 90s later — inside the 2-minute window
        payload: JSON.stringify({ v: 1, fields: ["priority"] }),
      });

      const items = buildTodoTimeline([first, second], TODO);
      const edited = items.find((i) => i.type === "event" && i.event.kind === "edited");
      expect(edited?.type).toBe("event");
      if (edited?.type !== "event") throw new Error("expected an event");
      expect(edited.event.at).toBe(first.at);
      expect(edited.event.fields?.sort()).toEqual(["priority", "title"]);
    });

    it("does NOT merge two edits exactly at the window boundary (> 2 minutes apart)", () => {
      const first = event({
        kind: "edited",
        at: "2026-08-13T00:00:00.000Z",
        payload: JSON.stringify({ v: 1, fields: ["title"] }),
      });
      const second = event({
        kind: "edited",
        at: "2026-08-13T00:02:00.001Z", // 120.001s later — just outside
        payload: JSON.stringify({ v: 1, fields: ["priority"] }),
      });

      const items = buildTodoTimeline([first, second], TODO);
      const editedRows = items.filter((i) => i.type === "event" && i.event.kind === "edited");
      expect(editedRows).toHaveLength(2);
    });

    it("merges two edits exactly at the 2-minute boundary (inclusive)", () => {
      const first = event({
        kind: "edited",
        at: "2026-08-13T00:00:00.000Z",
        payload: JSON.stringify({ v: 1, fields: ["title"] }),
      });
      const second = event({
        kind: "edited",
        at: "2026-08-13T00:02:00.000Z", // exactly 120s later
        payload: JSON.stringify({ v: 1, fields: ["priority"] }),
      });

      const items = buildTodoTimeline([first, second], TODO);
      const editedRows = items.filter((i) => i.type === "event" && i.event.kind === "edited");
      expect(editedRows).toHaveLength(1);
    });

    it("does not coalesce across a non-`edited` event in between", () => {
      const first = event({
        kind: "edited",
        at: "2026-08-13T00:00:00.000Z",
        payload: JSON.stringify({ v: 1, fields: ["title"] }),
      });
      const between = event({ kind: "done", at: "2026-08-13T00:00:30.000Z" });
      const second = event({
        kind: "edited",
        at: "2026-08-13T00:01:00.000Z",
        payload: JSON.stringify({ v: 1, fields: ["priority"] }),
      });

      const items = buildTodoTimeline([first, between, second], TODO);
      const editedRows = items.filter((i) => i.type === "event" && i.event.kind === "edited");
      expect(editedRows).toHaveLength(2);
    });
  });

  it("HISTORY_STARTS_AT is a fixed ISO instant", () => {
    expect(new Date(HISTORY_STARTS_AT).toString()).not.toBe("Invalid Date");
  });

  describe("the Faite Loop (EI-96)", () => {
    const ctx: PlacementContext = {
      today: "2026-08-13",
      visibleWindow: ["2026-08-13"],
      workdaysOnly: false,
      workdays: [1, 2, 3, 4, 5],
      overflowAfterDays: 3,
    };

    it("shows no roll rows without a ctx — same output as before EI-96", () => {
      const todo = { ...TODO, scheduledDate: "2026-08-09" }; // would overflow under ctx
      const items = buildTodoTimeline([], todo);
      const kinds = items.filter((i) => i.type === "event").map((i) => (i.type === "event" ? i.event.kind : ""));
      expect(kinds).not.toContain("rolledOver");
      expect(kinds).not.toContain("overflowed");
    });

    it("collapses a run of rolls into ONE row, keeping the last roll's count", () => {
      const todo = { ...TODO, scheduledDate: "2026-08-10" }; // 3 rolls as of ctx.today
      const items = buildTodoTimeline([], todo, ctx, "UTC");
      const rolled = items.find((i) => i.type === "event" && i.event.kind === "rolledOver");
      expect(rolled?.type).toBe("event");
      if (rolled?.type !== "event") throw new Error("expected an event");
      expect(rolled.event.payload).toMatchObject({ from: "2026-08-10", rolls: 3 });
      // Only one rolledOver row, not three.
      const rolledRows = items.filter((i) => i.type === "event" && i.event.kind === "rolledOver");
      expect(rolledRows).toHaveLength(1);
    });

    it("keeps overflowed as its own row, separate from the collapsed rolledOver run", () => {
      const todo = { ...TODO, scheduledDate: "2026-08-09" }; // 4 rolls as of ctx.today — overflowed
      const items = buildTodoTimeline([], todo, ctx, "UTC");
      const kinds = items.filter((i) => i.type === "event").map((i) => (i.type === "event" ? i.event.kind : ""));
      expect(kinds.filter((k) => k === "rolledOver")).toHaveLength(1);
      expect(kinds.filter((k) => k === "overflowed")).toHaveLength(1);

      const overflowed = items.find((i) => i.type === "event" && i.event.kind === "overflowed");
      if (overflowed?.type !== "event") throw new Error("expected an event");
      expect(overflowed.event.payload).toMatchObject({ from: "2026-08-09", rolls: 4 });
    });

    it("interleaves roll rows with real events by instant", () => {
      const todo = { ...TODO, scheduledDate: "2026-08-10" }; // rolls 08-11, 08-12, 08-13
      const created = event({ kind: "created", at: "2026-08-11T12:00:00.000Z" });
      const items = buildTodoTimeline([created], todo, ctx, "UTC");
      const kinds = items.filter((i) => i.type === "event").map((i) => (i.type === "event" ? i.event.kind : ""));
      // The collapsed rolledOver row is timestamped at the FIRST roll
      // (2026-08-11T00:00Z), which precedes the created event the same day.
      expect(kinds).toEqual(["rolledOver", "created"]);
    });

    it("shows no roll rows for a recurring occurrence — one miss bypasses the loop", () => {
      const todo = { ...TODO, scheduledDate: "2026-08-09", recurrenceParentId: "template-1" };
      const items = buildTodoTimeline([], todo, ctx, "UTC");
      const kinds = items.filter((i) => i.type === "event").map((i) => (i.type === "event" ? i.event.kind : ""));
      expect(kinds).not.toContain("rolledOver");
      expect(kinds).not.toContain("overflowed");
    });

    it("shows no roll rows for a settled todo, however stale", () => {
      const todo = { ...TODO, scheduledDate: "2026-08-01", status: "done" as const };
      const items = buildTodoTimeline([], todo, ctx, "UTC");
      const kinds = items.filter((i) => i.type === "event").map((i) => (i.type === "event" ? i.event.kind : ""));
      expect(kinds).not.toContain("rolledOver");
      expect(kinds).not.toContain("overflowed");
    });
  });
});
