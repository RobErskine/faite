import { describe, expect, it } from "vitest";
import {
  OVERDRIVE_MIN_TODOS,
  RAMP_MAX,
  WEEK_STEP,
  applyDecision,
  buildQueue,
  createSession,
  currentTodoId,
  isComplete,
  overdriveBase,
  rampDate,
  rampLabel,
  reduce,
  stageDate,
  stagedDate,
  summarize,
  type Decision,
  type ListContext,
  type OverdriveSession,
} from "./overdrive";
import { buildWindow, OVERFLOW, type PlacementContext } from "./scheduling";

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

const lists: ListContext = { currentListId: "list-brain-dump", backlogListId: "list-backlog" };

function session(overrides: Partial<OverdriveSession> = {}): OverdriveSession {
  return {
    source: overrides.source ?? OVERFLOW,
    queue: overrides.queue ?? ["t1", "t2", "t3"],
    index: overrides.index ?? 0,
    ramp: overrides.ramp ?? null,
    picked: overrides.picked ?? null,
    decided: overrides.decided ?? [],
  };
}

describe("buildQueue / createSession", () => {
  it("preserves the given order", () => {
    expect(buildQueue([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual(["a", "b", "c"]);
  });

  it("createSession starts at index 0 with nothing staged or decided", () => {
    const s = createSession([{ id: "a" }, { id: "b" }]);
    expect(s).toEqual({
      source: OVERFLOW,
      queue: ["a", "b"],
      index: 0,
      ramp: null,
      picked: null,
      decided: [],
    });
  });

  it("defaults source to OVERFLOW but accepts an explicit day", () => {
    expect(createSession([{ id: "a" }]).source).toBe(OVERFLOW);
    expect(createSession([{ id: "a" }], "2026-08-14").source).toBe("2026-08-14");
  });
});

describe("currentTodoId / isComplete", () => {
  it("returns the id at the current index", () => {
    expect(currentTodoId(session({ index: 1 }))).toBe("t2");
  });

  it("is null once the queue is spent", () => {
    const s = session({ index: 3 });
    expect(currentTodoId(s)).toBeNull();
    expect(isComplete(s)).toBe(true);
  });

  it("is not complete while a card remains", () => {
    expect(isComplete(session({ index: 2 }))).toBe(false);
  });
});

describe("rampDate", () => {
  it("offset 0 is always today, never advanced by workdaysOnly", () => {
    // 2026-08-08 is a Saturday.
    const saturday = ctx({ today: "2026-08-08", workdaysOnly: true });
    expect(rampDate(0, saturday)).toBe("2026-08-08");
  });

  it("without workdaysOnly, each offset is one calendar day", () => {
    const c = ctx({ today: "2026-08-03" });
    expect(rampDate(1, c)).toBe("2026-08-04");
    expect(rampDate(2, c)).toBe("2026-08-05");
  });

  it("with workdaysOnly, offset 1 from a Friday lands on Monday", () => {
    // 2026-08-07 is a Friday.
    const c = ctx({ today: "2026-08-07", workdaysOnly: true });
    expect(rampDate(1, c)).toBe("2026-08-10");
  });

  it("skips a weekend entirely when ramping several eligible days", () => {
    const c = ctx({ today: "2026-08-07", workdaysOnly: true }); // Friday
    expect(rampDate(2, c)).toBe("2026-08-11"); // Mon, Tue — Sat/Sun never counted
  });
});

describe("rampLabel", () => {
  it("names today and tomorrow", () => {
    expect(rampLabel("2026-08-03", "2026-08-03")).toBe("Today");
    expect(rampLabel("2026-08-04", "2026-08-03")).toBe("Tomorrow");
  });

  it("falls back to a short weekday + date beyond tomorrow", () => {
    // 2026-08-07 is a Friday.
    expect(rampLabel("2026-08-07", "2026-08-03")).toBe("Fri, Aug 7");
  });
});

describe("stagedDate", () => {
  it("is null when nothing is staged", () => {
    expect(stagedDate(session(), ctx())).toBeNull();
  });

  it("reads through a ramp offset", () => {
    expect(stagedDate(session({ ramp: 1 }), ctx({ today: "2026-08-03" }))).toBe("2026-08-04");
  });

  it("prefers an explicit picked date over a ramp offset", () => {
    const s = session({ ramp: 5, picked: "2026-09-01" });
    expect(stagedDate(s, ctx())).toBe("2026-09-01");
  });
});

describe("stageDate", () => {
  it("sets picked and clears any ramp", () => {
    const s = stageDate(session({ ramp: 3 }), "2026-09-01");
    expect(s.picked).toBe("2026-09-01");
    expect(s.ramp).toBeNull();
  });
});

describe("reduce — immediate commits", () => {
  it("wontDo commits dropped without touching the session", () => {
    const s = session();
    const result = reduce(s, "wontDo", ctx(), lists);
    expect(result.commit).toEqual({ kind: "dropped" });
    expect(result.session).toBe(s);
  });

  it("wontDo with a ramp staged decrements the ramp instead of committing", () => {
    const result = reduce(session({ ramp: 2 }), "wontDo", ctx(), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBe(1);
  });

  it("wontDo at ramp 0 clears the stage entirely rather than going negative", () => {
    const result = reduce(session({ ramp: 0 }), "wontDo", ctx(), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBeNull();
  });

  it("wontDo with a picked date clears the pick instead of committing", () => {
    const result = reduce(session({ picked: "2026-09-01" }), "wontDo", ctx(), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session.picked).toBeNull();
  });

  it("a full ramp-then-back-out sequence never commits along the way", () => {
    let s = session();
    s = reduce(s, "ramp", ctx(), lists).session; // ramp: 0
    s = reduce(s, "ramp", ctx(), lists).session; // ramp: 1
    s = reduce(s, "ramp", ctx(), lists).session; // ramp: 2 (overshoot)
    let result = reduce(s, "wontDo", ctx(), lists); // back to 1
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBe(1);
    result = reduce(result.session, "wontDo", ctx(), lists); // back to 0
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBe(0);
    result = reduce(result.session, "wontDo", ctx(), lists); // back to unstaged
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBeNull();
    result = reduce(result.session, "wontDo", ctx(), lists); // now it commits
    expect(result.commit).toEqual({ kind: "dropped" });
  });

  it("done commits done", () => {
    expect(reduce(session(), "done", ctx(), lists).commit).toEqual({ kind: "done" });
  });

  it("toList commits the todo's own list", () => {
    const result = reduce(session(), "toList", ctx(), lists);
    expect(result.commit).toEqual({ kind: "listed", listId: "list-brain-dump" });
  });

  it("toList falls back to Backlog when the todo has no list", () => {
    const noList: ListContext = { currentListId: null, backlogListId: "list-backlog" };
    const result = reduce(session(), "toList", ctx(), noList);
    expect(result.commit).toEqual({ kind: "listed", listId: "list-backlog" });
  });

  it("toBacklog always targets Backlog, even with a current list", () => {
    const result = reduce(session(), "toBacklog", ctx(), lists);
    expect(result.commit).toEqual({ kind: "listed", listId: "list-backlog" });
  });
});

describe("reduce — the ramp", () => {
  it("first ramp press stages today (offset 0)", () => {
    const result = reduce(session(), "ramp", ctx(), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBe(0);
  });

  it("a second ramp press stages tomorrow", () => {
    const staged = reduce(session(), "ramp", ctx(), lists).session;
    const result = reduce(staged, "ramp", ctx(), lists);
    expect(result.session.ramp).toBe(1);
  });

  it("clamps at RAMP_MAX rather than wrapping", () => {
    let s = session({ ramp: RAMP_MAX });
    s = reduce(s, "ramp", ctx(), lists).session;
    expect(s.ramp).toBe(RAMP_MAX);
  });

  it("rampWeek jumps a week on the first press", () => {
    const result = reduce(session(), "rampWeek", ctx(), lists);
    expect(result.session.ramp).toBe(WEEK_STEP);
  });

  it("rampWeek adds a week to an existing stage", () => {
    const result = reduce(session({ ramp: 2 }), "rampWeek", ctx(), lists);
    expect(result.session.ramp).toBe(2 + WEEK_STEP);
  });

  it("ramping clears a picked date", () => {
    const result = reduce(session({ picked: "2026-09-01" }), "ramp", ctx(), lists);
    expect(result.session.picked).toBeNull();
    expect(result.session.ramp).toBe(0);
  });
});

describe("reduce — confirm", () => {
  it("is a no-op with nothing staged — Enter must never write an unchosen day", () => {
    const s = session();
    const result = reduce(s, "confirm", ctx(), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session).toBe(s);
  });

  it("a two-press ramp then confirm schedules tomorrow, not today", () => {
    let s = session();
    s = reduce(s, "ramp", ctx({ today: "2026-08-03" }), lists).session;
    s = reduce(s, "ramp", ctx({ today: "2026-08-03" }), lists).session;
    const result = reduce(s, "confirm", ctx({ today: "2026-08-03" }), lists);
    expect(result.commit).toEqual({ kind: "scheduled", date: "2026-08-04" });
  });

  it("confirms a picked date verbatim, even on a non-eligible day", () => {
    // A Saturday, picked explicitly, with workdaysOnly on.
    const s = stageDate(session(), "2026-08-08");
    const result = reduce(s, "confirm", ctx({ workdaysOnly: true }), lists);
    expect(result.commit).toEqual({ kind: "scheduled", date: "2026-08-08" });
  });
});

describe("reduce — cancel", () => {
  it("clears a staged ramp without exiting", () => {
    const staged = session({ ramp: 2 });
    const result = reduce(staged, "cancel", ctx(), lists);
    expect(result.exit).toBeUndefined();
    expect(result.session.ramp).toBeNull();
  });

  it("clears a picked date without exiting", () => {
    const staged = session({ picked: "2026-09-01" });
    const result = reduce(staged, "cancel", ctx(), lists);
    expect(result.exit).toBeUndefined();
    expect(result.session.picked).toBeNull();
  });

  it("exits when nothing is staged", () => {
    const result = reduce(session(), "cancel", ctx(), lists);
    expect(result.exit).toBe(true);
  });
});

describe("reduce — stepBack", () => {
  it("is a no-op with nothing decided", () => {
    const s = session();
    const result = reduce(s, "stepBack", ctx(), lists);
    expect(result.stepBack).toBeUndefined();
    expect(result.session).toBe(s);
  });

  it("pops the last decision, rewinds the index, and clears any stage", () => {
    const decided = [
      { todoId: "t1", verdict: { kind: "dropped" as const }, undoId: "u1", label: "Won’t do “t1”" },
    ];
    const s = session({ index: 1, ramp: 3, decided });
    const result = reduce(s, "stepBack", ctx(), lists);
    expect(result.stepBack).toEqual(decided[0]);
    expect(result.session.index).toBe(0);
    expect(result.session.ramp).toBeNull();
    expect(result.session.decided).toEqual([]);
  });
});

describe("applyDecision", () => {
  it("records the decision (and its label) against the CURRENT card and advances", () => {
    const s = session({ index: 0 });
    const next = applyDecision(s, { kind: "dropped" }, "undo-1", "Won’t do “t1”");
    expect(next.index).toBe(1);
    expect(next.decided).toEqual([
      { todoId: "t1", verdict: { kind: "dropped" }, undoId: "undo-1", label: "Won’t do “t1”" },
    ]);
  });

  it("clears any stage on advance", () => {
    const s = session({ ramp: 3, picked: null });
    const next = applyDecision(s, { kind: "scheduled", date: "2026-08-04" }, "undo-1", "Scheduled");
    expect(next.ramp).toBeNull();
    expect(next.picked).toBeNull();
  });

  it("reaching the end of the queue is reflected by isComplete", () => {
    let s = session({ queue: ["t1"], index: 0 });
    s = applyDecision(s, { kind: "done" }, "undo-1", "Completed");
    expect(isComplete(s)).toBe(true);
    expect(currentTodoId(s)).toBeNull();
  });
});

describe("OVERDRIVE_MIN_TODOS", () => {
  it("is a small positive threshold", () => {
    expect(OVERDRIVE_MIN_TODOS).toBeGreaterThan(0);
  });
});

describe("summarize", () => {
  it("is all zero for an empty session", () => {
    expect(summarize([])).toEqual({ dropped: 0, done: 0, listed: 0, scheduled: 0 });
  });

  it("tallies each verdict kind independently", () => {
    const decided: Decision[] = [
      { todoId: "t1", verdict: { kind: "dropped" }, undoId: "u1", label: "l1" },
      { todoId: "t2", verdict: { kind: "dropped" }, undoId: "u2", label: "l2" },
      { todoId: "t3", verdict: { kind: "done" }, undoId: "u3", label: "l3" },
      { todoId: "t4", verdict: { kind: "listed", listId: "l1" }, undoId: "u4", label: "l4" },
      { todoId: "t5", verdict: { kind: "scheduled", date: "2026-08-04" }, undoId: "u5", label: "l5" },
    ];
    expect(summarize(decided)).toEqual({ dropped: 2, done: 1, listed: 1, scheduled: 1 });
  });
});

describe("day sessions", () => {
  const today = "2026-08-03"; // a Monday

  it("first → on a day session stages the day AFTER the source, never the source itself", () => {
    const s = session({ source: "2026-08-10" });
    const { session: next } = reduce(s, "ramp", ctx({ today }), lists);
    expect(next.ramp).toBe(1);
    expect(stagedDate(next, ctx({ today }))).toBe("2026-08-11");
  });

  it("respects workdaysOnly: a Friday source ramps to Monday, not Saturday", () => {
    const friday = "2026-08-07";
    const s = session({ source: friday });
    const c = ctx({ today, workdaysOnly: true });
    const { session: next } = reduce(s, "ramp", c, lists);
    expect(stagedDate(next, c)).toBe("2026-08-10"); // the following Monday
  });

  it("⇧→ from unstaged on a day session ramps a full week past the source", () => {
    const s = session({ source: "2026-08-10" });
    const { session: next } = reduce(s, "rampWeek", ctx({ today }), lists);
    expect(next.ramp).toBe(WEEK_STEP);
    expect(stagedDate(next, ctx({ today }))).toBe("2026-08-17");
  });

  it("← at ramp===1 on a day session unstages — does NOT commit, does NOT resolve to the source", () => {
    const staged = session({ source: "2026-08-10", ramp: 1 });
    const result = reduce(staged, "wontDo", ctx({ today }), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBeNull();
  });

  it("← twice from ramp===1 on a day session: first unstages, second commits dropped", () => {
    const staged = session({ source: "2026-08-10", ramp: 1 });
    const first = reduce(staged, "wontDo", ctx({ today }), lists);
    expect(first.commit).toBeUndefined();
    const second = reduce(first.session, "wontDo", ctx({ today }), lists);
    expect(second.commit).toEqual({ kind: "dropped" });
  });

  it("regression: ← at ramp===0 on an OVERFLOW session still unstages to null (min=0 preserved)", () => {
    const staged = session({ source: OVERFLOW, ramp: 0 });
    const result = reduce(staged, "wontDo", ctx({ today }), lists);
    expect(result.commit).toBeUndefined();
    expect(result.session.ramp).toBeNull();
  });

  it("midnight clamp: a stale source never stages a date before today", () => {
    // Session opened days ago and never closed — `today` has moved on.
    const s = session({ source: "2026-07-25" });
    const c = ctx({ today: "2026-08-03" });
    const { session: next } = reduce(s, "ramp", c, lists);
    const staged = stagedDate(next, c);
    expect(staged).not.toBeNull();
    expect(staged! >= c.today).toBe(true);
    expect(staged).toBe("2026-08-04"); // clamped to today, then +1
  });

  it("rampDate with an explicit base chains from that base, not ctx.today", () => {
    const c = ctx({ today });
    expect(rampDate(2, c, "2026-08-20")).toBe("2026-08-22");
    expect(rampDate(0, c, "2026-08-20")).toBe("2026-08-20"); // base, not today
  });

  it("RAMP_MAX still clamps a day session's ramp", () => {
    const s = session({ source: "2026-08-10", ramp: RAMP_MAX });
    const { session: next } = reduce(s, "ramp", ctx({ today }), lists);
    expect(next.ramp).toBe(RAMP_MAX);
  });

  it("stagedDate prefers picked over the ramp on a day session, and picked MAY equal the source", () => {
    const s = session({ source: "2026-08-10", ramp: 3, picked: "2026-08-10" });
    expect(stagedDate(s, ctx({ today }))).toBe("2026-08-10");
  });

  it("overdriveBase: OVERFLOW bases at today with min 0; a future day bases at itself with min 1", () => {
    const c = ctx({ today });
    expect(overdriveBase(OVERFLOW, c)).toEqual({ base: today, min: 0 });
    expect(overdriveBase("2026-08-10", c)).toEqual({ base: "2026-08-10", min: 1 });
  });

  it("overdriveBase clamps a past-dated source forward to today", () => {
    const c = ctx({ today });
    expect(overdriveBase("2026-07-01", c)).toEqual({ base: today, min: 1 });
  });
});
