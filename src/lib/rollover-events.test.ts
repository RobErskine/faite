import { describe, expect, it } from "vitest";
import { describeLoop, loopExample, rollEventsFor } from "./rollover-events";
import { type PlacementContext, addDays, buildWindow } from "./scheduling";

const WORKDAYS = [1, 2, 3, 4, 5];

function ctx(overrides: Partial<PlacementContext> = {}): PlacementContext {
  const today = overrides.today ?? "2026-08-03"; // a Monday
  return {
    today,
    visibleWindow: overrides.visibleWindow ?? buildWindow(today, 7),
    workdaysOnly: overrides.workdaysOnly ?? false,
    workdays: overrides.workdays ?? WORKDAYS,
    overflowAfterDays: overrides.overflowAfterDays ?? 3,
  };
}

describe("rollEventsFor", () => {
  it("returns nothing for a todo not yet due", () => {
    const todo = { status: "open" as const, scheduledDate: "2026-08-05", recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx())).toEqual([]);
  });

  it("returns nothing for a todo due today", () => {
    const todo = { status: "open" as const, scheduledDate: "2026-08-03", recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx())).toEqual([]);
  });

  it("returns nothing for an unscheduled todo", () => {
    const todo = { status: "open" as const, scheduledDate: null, recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx())).toEqual([]);
  });

  it("returns nothing for a settled todo, however stale", () => {
    const todo = { status: "done" as const, scheduledDate: "2026-07-01", recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx())).toEqual([]);
  });

  it("returns nothing for a recurring occurrence — one miss bypasses the loop", () => {
    const todo = { status: "open" as const, scheduledDate: "2026-07-01", recurrenceParentId: "template-1" };
    expect(rollEventsFor(todo, ctx())).toEqual([]);
  });

  it("emits one rolledOver event per eligible day, up to the threshold", () => {
    // Scheduled 2026-07-31 (Fri), viewed 2026-08-03 (Mon), overflowAfterDays 3.
    const todo = { status: "open" as const, scheduledDate: "2026-07-31", recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx({ overflowAfterDays: 3 }))).toEqual([
      { kind: "rolledOver", day: "2026-08-01", from: "2026-07-31", rolls: 1, overflowsIn: 3 },
      { kind: "rolledOver", day: "2026-08-02", from: "2026-07-31", rolls: 2, overflowsIn: 2 },
      { kind: "rolledOver", day: "2026-08-03", from: "2026-07-31", rolls: 3, overflowsIn: 1 },
    ]);
  });

  it("adds a single overflowed event once past the threshold, and stops there", () => {
    // One more day than the previous case: 4 rolls, threshold 3.
    const todo = { status: "open" as const, scheduledDate: "2026-07-30", recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx({ overflowAfterDays: 3 }))).toEqual([
      { kind: "rolledOver", day: "2026-07-31", from: "2026-07-30", rolls: 1, overflowsIn: 3 },
      { kind: "rolledOver", day: "2026-08-01", from: "2026-07-30", rolls: 2, overflowsIn: 2 },
      { kind: "rolledOver", day: "2026-08-02", from: "2026-07-30", rolls: 3, overflowsIn: 1 },
      { kind: "overflowed", day: "2026-08-03", from: "2026-07-30", rolls: 4, overflowsIn: 0 },
    ]);
  });

  it("stays bounded even for a very old todo — no more events after overflow", () => {
    const todo = { status: "open" as const, scheduledDate: "2026-01-01", recurrenceParentId: null };
    const events = rollEventsFor(todo, ctx({ overflowAfterDays: 3 }));
    expect(events).toHaveLength(4);
    expect(events.at(-1)?.kind).toBe("overflowed");
  });

  it("handles the N=0 boundary: overflows the very next eligible day", () => {
    const todo = { status: "open" as const, scheduledDate: "2026-08-02", recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx({ overflowAfterDays: 0 }))).toEqual([
      { kind: "overflowed", day: "2026-08-03", from: "2026-08-02", rolls: 1, overflowsIn: 0 },
    ]);
  });

  it("counts overflowsIn down as more rolls elapse, hitting 0 exactly on overflow", () => {
    const todo = { status: "open" as const, scheduledDate: "2026-07-31", recurrenceParentId: null };
    const dayOne = rollEventsFor(todo, ctx({ today: "2026-08-01", overflowAfterDays: 3 }));
    const dayThree = rollEventsFor(todo, ctx({ today: "2026-08-03", overflowAfterDays: 3 }));
    expect(dayOne.at(-1)?.overflowsIn).toBe(3);
    expect(dayThree.at(-1)?.overflowsIn).toBe(1);
  });

  it("respects workdaysOnly when spacing roll days", () => {
    // Scheduled Fri 2026-08-07, viewed Wed 2026-08-12, workdays only.
    const todo = { status: "open" as const, scheduledDate: "2026-08-07", recurrenceParentId: null };
    const events = rollEventsFor(
      todo,
      ctx({ today: "2026-08-12", overflowAfterDays: 3, workdaysOnly: true }),
    );
    // Eligible days after Fri Aug 7: Mon 10, Tue 11, Wed 12 — weekend skipped.
    expect(events.map((e) => e.day)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("agrees with rollsElapsed's day-after-scheduled boundary", () => {
    const todo = { status: "open" as const, scheduledDate: addDays("2026-08-03", -1), recurrenceParentId: null };
    expect(rollEventsFor(todo, ctx({ overflowAfterDays: 3 }))).toEqual([
      { kind: "rolledOver", day: "2026-08-03", from: "2026-08-02", rolls: 1, overflowsIn: 3 },
    ]);
  });
});

describe("loopExample", () => {
  it("returns the structured dates describeLoop's sentence is built from", () => {
    expect(loopExample(ctx({ overflowAfterDays: 3 }))).toEqual({
      missed: "2026-08-03",
      rollDays: ["2026-08-04", "2026-08-05", "2026-08-06"],
      overflowDay: "2026-08-07",
    });
  });

  it("returns no rollDays at N=0 — straight to Overflow", () => {
    expect(loopExample(ctx({ overflowAfterDays: 0 }))).toEqual({
      missed: "2026-08-03",
      rollDays: [],
      overflowDay: "2026-08-04",
    });
  });
});

describe("describeLoop", () => {
  it("describes the roll sequence and the overflow day", () => {
    expect(describeLoop(ctx({ overflowAfterDays: 3 }))).toBe(
      "Miss Aug 3 → rolls to Aug 4, Aug 5, Aug 6 → Overflow on Aug 7",
    );
  });

  it("describes N=0 as a direct jump to Overflow", () => {
    expect(describeLoop(ctx({ overflowAfterDays: 0 }))).toBe(
      "Miss Aug 3 → Overflow on Aug 4",
    );
  });

  it("summarizes rather than lists every day once the sequence is long", () => {
    const result = describeLoop(ctx({ overflowAfterDays: 30 }));
    expect(result).toContain("(30 days)");
    expect(result).toContain("Overflow on");
  });

  it("honours workdaysOnly in the example", () => {
    // Fri Aug 7, one roll, workdays only -> skips straight to Monday.
    const result = describeLoop(
      ctx({ today: "2026-08-07", overflowAfterDays: 1, workdaysOnly: true }),
    );
    expect(result).toBe("Miss Aug 7 → rolls to Aug 10 → Overflow on Aug 11");
  });
});
