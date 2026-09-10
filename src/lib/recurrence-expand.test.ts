import { describe, expect, it } from "vitest";
import { expandRecurrences, isRecurrenceOccurrence, isRecurrenceTemplate } from "./recurrence-expand";
import { defaultRule, occurrenceId, serializeRule, type RecurrenceRule } from "./recurrence";
import type { PlacementContext } from "./scheduling";
import { buildWindow } from "./scheduling";
import type { Todo } from "./schema";

let counter = 0;
function todo(overrides: Partial<Todo> = {}): Todo {
  counter += 1;
  return {
    id: `todo-${counter}`,
    ownerId: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    title: "Untitled",
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
    source: null,
    ...overrides,
  };
}

function template(seriesStart: string, rule: RecurrenceRule, overrides: Partial<Todo> = {}): Todo {
  return todo({
    title: "Timesheets",
    scheduledDate: seriesStart,
    recurrenceRule: serializeRule(rule),
    ...overrides,
  });
}

function ctxFor(today: string, visibleDays = 7): PlacementContext {
  return {
    today,
    visibleWindow: buildWindow(today, visibleDays),
    workdaysOnly: false,
    workdays: [1, 2, 3, 4, 5],
    overflowAfterDays: 3,
  };
}

describe("expandRecurrences — basic scheduled series", () => {
  it("renders the first occurrence normally when it is today", () => {
    // 2026-08-07 is a Friday
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    const ctx = ctxFor("2026-08-07");
    const result = expandRecurrences([t], [], ctx);

    expect(result.forceOverflow).toEqual([]);
    expect(result.missedCounts.size).toBe(0);
    const live = result.todos.find((x) => x.id === occurrenceId(t.id, "2026-08-07"));
    expect(live).toBeDefined();
    expect(live?.scheduledDate).toBe("2026-08-07");
  });

  it("renders future occurrences on their own days, not just the next one", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    const ctx = ctxFor("2026-08-07", 21); // covers three Fridays
    const result = expandRecurrences([t], [], ctx);
    const dates = result.todos
      .filter((x) => x.recurrenceParentId === t.id)
      .map((x) => x.scheduledDate)
      .sort();
    expect(dates).toEqual(["2026-08-07", "2026-08-14", "2026-08-21"]);
  });

  it("never expands the template itself onto the board", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    const ctx = ctxFor("2026-08-07");
    const result = expandRecurrences([t], [], ctx);
    expect(result.todos.some((x) => x.id === t.id)).toBe(false);
  });
});

describe("expandRecurrences — one miss drops straight to Overflow", () => {
  it("forces an overdue occurrence into Overflow immediately, no grace period", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    // A week later: last Friday (08-07) is overdue by a full week, well past
    // any ordinary overflowAfterDays grace period, but even ONE day overdue
    // must already be in forceOverflow per the "one miss" rule.
    const ctx = ctxFor("2026-08-08"); // Saturday, one day after
    const result = expandRecurrences([t], [], ctx);

    expect(result.forceOverflow).toHaveLength(1);
    expect(result.forceOverflow[0].id).toBe(occurrenceId(t.id, "2026-08-07"));
    // Not also present in the main todos list — would double-render.
    expect(result.todos.some((x) => x.id === occurrenceId(t.id, "2026-08-07"))).toBe(false);
  });

  it("badges accrue while the same occurrence stays unsettled", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    // Three Fridays have passed (08-07, 08-14, 08-21) with nothing completed.
    const ctx = ctxFor("2026-08-24"); // Monday after the third Friday
    const result = expandRecurrences([t], [], ctx);

    expect(result.forceOverflow).toHaveLength(1);
    const liveId = occurrenceId(t.id, "2026-08-07");
    expect(result.forceOverflow[0].id).toBe(liveId);
    expect(result.missedCounts.get(liveId)).toBe(3);
  });

  it("completing the live occurrence advances to the next, one at a time", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    // 08-07 was materialized and completed; 08-14 and 08-21 are still misses.
    const completed = todo({
      id: occurrenceId(t.id, "2026-08-07"),
      recurrenceParentId: t.id,
      scheduledDate: "2026-08-07",
      status: "done",
      completedAt: "2026-08-07T12:00:00.000Z",
    });
    const ctx = ctxFor("2026-08-24");
    const result = expandRecurrences([t], [completed], ctx);

    const liveId = occurrenceId(t.id, "2026-08-14");
    expect(result.forceOverflow).toHaveLength(1);
    expect(result.forceOverflow[0].id).toBe(liveId);
    // Two occurrences (08-14, 08-21) are outstanding now, not three.
    expect(result.missedCounts.get(liveId)).toBe(2);
  });

  it("a tombstoned (deleted) occurrence counts as settled", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    const deleted = todo({
      id: occurrenceId(t.id, "2026-08-07"),
      recurrenceParentId: t.id,
      scheduledDate: "2026-08-07",
      deletedAt: "2026-08-08T00:00:00.000Z",
    });
    const ctx = ctxFor("2026-08-15"); // one day after the second Friday
    const result = expandRecurrences([t], [deleted], ctx);

    expect(result.forceOverflow[0].id).toBe(occurrenceId(t.id, "2026-08-14"));
  });

  it("a materialized-but-still-open live occurrence is force-overflowed too, not left in the main list", () => {
    const t = template("2026-08-07", { ...defaultRule("2026-08-07"), byDay: [5] });
    const editedButOpen = todo({
      id: occurrenceId(t.id, "2026-08-07"),
      recurrenceParentId: t.id,
      scheduledDate: "2026-08-07",
      title: "Timesheets (edited)",
      status: "open",
    });
    const ctx = ctxFor("2026-08-08");
    const result = expandRecurrences([t], [editedButOpen], ctx);

    expect(result.forceOverflow).toHaveLength(1);
    expect(result.forceOverflow[0].title).toBe("Timesheets (edited)");
    expect(result.todos.some((x) => x.id === editedButOpen.id)).toBe(false);
  });
});

describe("expandRecurrences — anchor: completed", () => {
  it("has no backlog: only ever one live occurrence, no missedCounts, no future cards", () => {
    const t = template("2026-08-07", {
      ...defaultRule("2026-08-07"),
      freq: "weekly",
      anchor: "completed",
    });
    const ctx = ctxFor("2026-08-24"); // three weeks past series start, never touched
    const result = expandRecurrences([t], [], ctx);

    expect(result.forceOverflow).toHaveLength(1);
    expect(result.forceOverflow[0].id).toBe(occurrenceId(t.id, "2026-08-07"));
    expect(result.missedCounts.size).toBe(0);
    expect(result.todos.filter((x) => x.recurrenceParentId === t.id)).toHaveLength(0);
  });

  it("advances relative to the completion date, not the calendar", () => {
    const t = template("2026-08-07", {
      ...defaultRule("2026-08-07"),
      freq: "weekly",
      interval: 1,
      anchor: "completed",
    });
    const completed = todo({
      id: occurrenceId(t.id, "2026-08-20"),
      recurrenceParentId: t.id,
      scheduledDate: "2026-08-20",
      status: "done",
    });
    const ctx = ctxFor("2026-08-24");
    const result = expandRecurrences([t], [completed], ctx);
    // Next is exactly one week after the completion, not tied to 08-07's alignment.
    const next = result.todos.find((x) => x.recurrenceParentId === t.id && x.status === "open");
    expect(next?.scheduledDate).toBe("2026-08-27");
  });
});

describe("isRecurrenceTemplate / isRecurrenceOccurrence", () => {
  it("classify correctly", () => {
    const t = template("2026-08-07", defaultRule("2026-08-07"));
    const child = todo({ recurrenceParentId: t.id });
    const plain = todo();
    expect(isRecurrenceTemplate(t)).toBe(true);
    expect(isRecurrenceTemplate(plain)).toBe(false);
    expect(isRecurrenceOccurrence(child)).toBe(true);
    expect(isRecurrenceOccurrence(plain)).toBe(false);
  });
});

/**
 * EI-318 §0 — a materialized occurrence's id records the slot it was BORN in
 * and never changes; `scheduledDate` is where the user has since moved it.
 * Slot occupancy has to follow the card, or the expansion clones a fresh
 * virtual occurrence onto a day the moved one is already sitting on.
 */
describe("expandRecurrences — a moved occurrence keeps its slot", () => {
  // Weekly on Fridays from Aug 7. Aug 7 / 14 / 21 / 28 are all Fridays.
  const RULE = (start: string) => ({ ...defaultRule(start), byDay: [5] });

  it("does not clone a duplicate onto a day a moved occurrence already occupies", () => {
    const t = template("2026-08-07", RULE("2026-08-07"));
    // The Aug 14 occurrence, materialized and then dragged forward to Aug 21 —
    // the day the NEXT occurrence is due. Its id still says Aug 14.
    const moved = todo({
      id: occurrenceId(t.id, "2026-08-14"),
      title: "Timesheets",
      scheduledDate: "2026-08-21",
      recurrenceParentId: t.id,
    });
    const ctx = ctxFor("2026-08-07", 28);

    const result = expandRecurrences([t], [moved], ctx);
    const onAug21 = result.todos.filter(
      (x) => x.recurrenceParentId === t.id && x.scheduledDate === "2026-08-21",
    );

    expect(onAug21).toHaveLength(1);
    expect(onAug21[0]?.id).toBe(moved.id);
  });

  it("still clones the days a moved occurrence vacated and the ones beyond it", () => {
    const t = template("2026-08-07", RULE("2026-08-07"));
    const moved = todo({
      id: occurrenceId(t.id, "2026-08-14"),
      scheduledDate: "2026-08-21",
      recurrenceParentId: t.id,
    });
    const ctx = ctxFor("2026-08-07", 28);

    const result = expandRecurrences([t], [moved], ctx);
    const dates = result.todos
      .filter((x) => x.recurrenceParentId === t.id)
      .map((x) => x.scheduledDate)
      .sort();

    // Aug 7 is still generated (nothing settled), Aug 21 is the moved card,
    // Aug 28 is cloned as normal. Aug 14 is gone because the card that held
    // that slot moved off it.
    expect(dates).toEqual(["2026-08-07", "2026-08-21", "2026-08-28"]);
  });

  it("a settled occurrence still consumes its ORIGINAL slot, not its moved date", () => {
    // Settlement is history: completing the Aug 14 occurrence means the
    // series has moved past Aug 14, wherever the completed card now sits.
    const t = template("2026-08-07", RULE("2026-08-07"));
    const done = todo({
      id: occurrenceId(t.id, "2026-08-14"),
      scheduledDate: "2026-08-21",
      status: "done",
      completedAt: "2026-08-14T10:00:00.000Z",
      recurrenceParentId: t.id,
    });
    const ctx = ctxFor("2026-08-07", 28);

    const result = expandRecurrences([t], [done], ctx);
    const cloned = result.todos
      .filter((x) => x.recurrenceParentId === t.id && x.id !== done.id)
      .map((x) => x.scheduledDate)
      .sort();

    expect(cloned).toEqual(["2026-08-21", "2026-08-28"]);
  });

  it("the ORIGIN todo never occupies a slot, however it is scheduled", () => {
    // `createSeriesFromTodo` links the source todo to the template via
    // `recurrenceParentId` for display only. Its id is a plain UUID, so it is
    // not an occurrence and must not suppress one.
    const t = template("2026-08-14", RULE("2026-08-14"));
    const origin = todo({
      title: "Timesheets",
      scheduledDate: "2026-08-14",
      recurrenceParentId: t.id,
    });
    const ctx = ctxFor("2026-08-14", 14);

    const result = expandRecurrences([t], [origin], ctx);
    const clonedOnAug14 = result.todos.filter(
      (x) => x.recurrenceParentId === t.id && x.id !== origin.id && x.scheduledDate === "2026-08-14",
    );

    expect(clonedOnAug14).toHaveLength(1);
  });
});
