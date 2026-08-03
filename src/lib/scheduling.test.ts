import { describe, expect, it } from "vitest";
import {
  OVERFLOW,
  addDays,
  buildWindow,
  dayOfWeek,
  daysBetween,
  deriveColumn,
  isDeadlineMissed,
  rolloverTarget,
  rollsElapsed,
  todayIn,
  type PlacementContext,
} from "./scheduling";

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

describe("civil date arithmetic", () => {
  it("counts days across a month boundary", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetween("2026-08-01", "2026-07-31")).toBe(-1);
  });

  it("counts days across a year boundary", () => {
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("handles leap days", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // 2028 is a leap year
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("adds days across boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("is unaffected by DST transitions", () => {
    // US DST starts 2026-03-08 and ends 2026-11-01. A naive implementation
    // using local Date math drops or repeats an hour and can be off by a day.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("reports day of week with 0 = Sunday", () => {
    expect(dayOfWeek("2026-08-02")).toBe(0); // Sunday
    expect(dayOfWeek("2026-08-03")).toBe(1); // Monday
    expect(dayOfWeek("2026-08-07")).toBe(5); // Friday
    expect(dayOfWeek("2026-08-08")).toBe(6); // Saturday
  });
});

describe("todayIn", () => {
  it("resolves the civil date in the user's timezone", () => {
    // 2026-08-03T02:00Z is still Aug 2 in New York, already Aug 3 in Tokyo.
    const instant = new Date("2026-08-03T02:00:00Z");
    expect(todayIn("America/New_York", instant)).toBe("2026-08-02");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-08-03");
    expect(todayIn("UTC", instant)).toBe("2026-08-03");
  });

  it("falls back to UTC for an unknown timezone rather than throwing", () => {
    const instant = new Date("2026-08-03T02:00:00Z");
    expect(todayIn("Not/AZone", instant)).toBe("2026-08-03");
  });
});

describe("rollsElapsed", () => {
  const all = { workdaysOnly: false, workdays: WORKDAYS };
  const work = { workdaysOnly: true, workdays: WORKDAYS };

  it("is zero or negative when not yet due", () => {
    expect(rollsElapsed("2026-08-03", "2026-08-03", all)).toBe(0);
    expect(rollsElapsed("2026-08-05", "2026-08-03", all)).toBe(-2);
  });

  it("counts every calendar day when workdays are off", () => {
    // Fri Aug 7 -> Mon Aug 10 is 3 calendar days.
    expect(rollsElapsed("2026-08-07", "2026-08-10", all)).toBe(3);
  });

  it("skips weekends when workdays are on", () => {
    // Fri Aug 7 -> Mon Aug 10 is only 1 working day.
    expect(rollsElapsed("2026-08-07", "2026-08-10", work)).toBe(1);
  });
});

describe("deriveColumn", () => {
  it("puts unscheduled todos in the planning half", () => {
    expect(deriveColumn({ scheduledDate: null }, ctx())).toEqual({
      half: "planning",
      awayDate: null,
    });
  });

  it("puts a future todo on its own day", () => {
    expect(deriveColumn({ scheduledDate: "2026-08-05" }, ctx())).toEqual({
      half: "calendar",
      day: "2026-08-05",
    });
  });

  it("puts a todo due today on today", () => {
    expect(deriveColumn({ scheduledDate: "2026-08-03" }, ctx())).toEqual({
      half: "calendar",
      day: "2026-08-03",
    });
  });

  it("rolls a missed todo onto today, up to the overflow threshold", () => {
    for (const rolls of [1, 2, 3]) {
      const scheduled = addDays("2026-08-03", -rolls);
      expect(deriveColumn({ scheduledDate: scheduled }, ctx())).toEqual({
        half: "calendar",
        day: "2026-08-03",
      });
    }
  });

  it("drops into Overflow once past the threshold", () => {
    expect(deriveColumn({ scheduledDate: "2026-07-30" }, ctx())).toEqual({
      half: "calendar",
      day: OVERFLOW,
    });
  });

  it("uses the boundary exactly: 3 rolls stays, 4 overflows", () => {
    const c = ctx({ overflowAfterDays: 3 });
    expect(deriveColumn({ scheduledDate: "2026-07-31" }, c)).toEqual({
      half: "calendar",
      day: "2026-08-03",
    }); // 3 rolls
    expect(deriveColumn({ scheduledDate: "2026-07-30" }, c)).toEqual({
      half: "calendar",
      day: OVERFLOW,
    }); // 4 rolls
  });

  it("delays overflow when workdays-only is on", () => {
    // Scheduled Wed Jul 29, viewed Mon Aug 3.
    // All days: 5 rolls -> Overflow. Workdays only: 3 rolls -> still today.
    const scheduled = "2026-07-29";
    expect(deriveColumn({ scheduledDate: scheduled }, ctx())).toEqual({
      half: "calendar",
      day: OVERFLOW,
    });
    expect(
      deriveColumn({ scheduledDate: scheduled }, ctx({ workdaysOnly: true })),
    ).toEqual({ half: "calendar", day: "2026-08-03" });
  });

  it("still shows a todo explicitly scheduled on a weekend", () => {
    // The workday setting governs rollover targets only — it must never hide a
    // todo the user deliberately put on a Saturday.
    const saturday = "2026-08-08";
    expect(
      deriveColumn({ scheduledDate: saturday }, ctx({ workdaysOnly: true })),
    ).toEqual({ half: "calendar", day: saturday });
  });

  it("falls back to the planning half when scheduled outside the window", () => {
    // Three weeks out: not in the 7-day window, so it belongs to its list
    // column rather than vanishing from both halves.
    expect(deriveColumn({ scheduledDate: "2026-08-24" }, ctx())).toEqual({
      half: "planning",
      awayDate: "2026-08-24",
    });
  });

  it("moves todos between halves as the day-count toggle changes", () => {
    const todo = { scheduledDate: "2026-08-06" }; // 3 days out
    expect(deriveColumn(todo, ctx({ visibleWindow: buildWindow("2026-08-03", 7) })))
      .toEqual({ half: "calendar", day: "2026-08-06" });
    expect(deriveColumn(todo, ctx({ visibleWindow: buildWindow("2026-08-03", 1) })))
      .toEqual({ half: "planning", awayDate: "2026-08-06" });
  });

  it("keeps overflowed todos visible regardless of window size", () => {
    expect(
      deriveColumn(
        { scheduledDate: "2026-07-01" },
        ctx({ visibleWindow: buildWindow("2026-08-03", 1) }),
      ),
    ).toEqual({ half: "calendar", day: OVERFLOW });
  });
});

describe("deadlines are independent of placement", () => {
  it("never changes which column a todo lands in", () => {
    const base = { scheduledDate: "2026-07-30" };
    const withDeadline = { ...base, deadline: "2026-12-31" };
    expect(deriveColumn(base, ctx())).toEqual(deriveColumn(withDeadline, ctx()));
  });

  it("flags a passed deadline on open todos only", () => {
    const c = ctx();
    expect(
      isDeadlineMissed({ deadline: "2026-08-01", status: "open" }, c),
    ).toBe(true);
    expect(
      isDeadlineMissed({ deadline: "2026-08-05", status: "open" }, c),
    ).toBe(false);
    expect(
      isDeadlineMissed({ deadline: "2026-08-01", status: "done" }, c),
    ).toBe(false);
    expect(isDeadlineMissed({ deadline: null, status: "open" }, c)).toBe(false);
  });
});

describe("rolloverTarget", () => {
  const all = { workdaysOnly: false, workdays: WORKDAYS };
  const work = { workdaysOnly: true, workdays: WORKDAYS };

  it("moves to the next calendar day by default", () => {
    expect(rolloverTarget("2026-08-07", all)).toBe("2026-08-08"); // Fri -> Sat
  });

  it("skips the weekend when workdays-only is on", () => {
    expect(rolloverTarget("2026-08-07", work)).toBe("2026-08-10"); // Fri -> Mon
  });

  it("does not get stuck when every workday is excluded", () => {
    expect(rolloverTarget("2026-08-07", { workdaysOnly: true, workdays: [] }))
      .toBe("2026-08-08");
  });
});
