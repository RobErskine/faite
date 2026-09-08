import { describe, expect, it } from "vitest";
import {
  firstOfNextMonth,
  nextWeekdayAfter,
  quickRescheduleDate,
  quickRescheduleOptions,
  type QuickRescheduleKind,
} from "./quick-reschedule";

/** The anchor most cases measure from. 2026-08-03 is a Monday. */
const MONDAY = "2026-08-03";
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ALL_KINDS: QuickRescheduleKind[] = [
  "tomorrow",
  "in2days",
  "in3days",
  "nextWeek",
  "nextMonth",
];

describe("quickRescheduleDate", () => {
  it("resolves every kind from a Monday", () => {
    expect(quickRescheduleDate("tomorrow", MONDAY)).toBe("2026-08-04");
    expect(quickRescheduleDate("in2days", MONDAY)).toBe("2026-08-05");
    expect(quickRescheduleDate("in3days", MONDAY)).toBe("2026-08-06");
    // Not today, even though today IS a Monday — see `nextWeekdayAfter`.
    expect(quickRescheduleDate("nextWeek", MONDAY)).toBe("2026-08-10");
    expect(quickRescheduleDate("nextMonth", MONDAY)).toBe("2026-09-01");
  });

  it("crosses a month boundary on a plain offset", () => {
    // 2026-08-30 is a Sunday; +3 lands in September.
    expect(quickRescheduleDate("in3days", "2026-08-30")).toBe("2026-09-02");
  });

  it("crosses a year boundary", () => {
    expect(quickRescheduleDate("tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(quickRescheduleDate("nextMonth", "2026-12-15")).toBe("2027-01-01");
  });

  it("never leaks a Date — every kind returns a civil date string", () => {
    for (const kind of ALL_KINDS) {
      expect(quickRescheduleDate(kind, MONDAY)).toMatch(CIVIL_DATE);
      expect(quickRescheduleDate(kind, "2028-02-29")).toMatch(CIVIL_DATE);
    }
  });
});

describe("nextWeekdayAfter", () => {
  /**
   * The whole week, asked for Monday. The Monday row is the one that matters:
   * a `% 7` without the `|| 7` returns the same day, and "Next week" would
   * mean "today" every Monday — the exact bug this function exists to avoid.
   */
  it.each([
    ["2026-08-03", "Mon", "2026-08-10"],
    ["2026-08-04", "Tue", "2026-08-10"],
    ["2026-08-05", "Wed", "2026-08-10"],
    ["2026-08-06", "Thu", "2026-08-10"],
    ["2026-08-07", "Fri", "2026-08-10"],
    ["2026-08-08", "Sat", "2026-08-10"],
    ["2026-08-09", "Sun", "2026-08-10"],
  ])("from %s (%s) the next Monday is %s", (from, _weekday, expected) => {
    expect(nextWeekdayAfter(1, from)).toBe(expected);
  });

  it("is strict for every weekday, not just Monday", () => {
    // Asking for the day you are already on always advances a full week.
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const from = `2026-08-0${3 + weekday}`; // 08-03 Mon … 08-09 Sun
      const target = (weekday + 1) % 7; // that same date's own weekday
      expect(nextWeekdayAfter(target, from)).toBe(`2026-08-1${weekday}`);
    }
  });
});

describe("firstOfNextMonth", () => {
  it("discards the day, so month length never matters", () => {
    expect(firstOfNextMonth("2026-01-31")).toBe("2026-02-01");
    expect(firstOfNextMonth("2026-01-01")).toBe("2026-02-01");
  });

  it("rolls the year over from December", () => {
    expect(firstOfNextMonth("2026-12-15")).toBe("2027-01-01");
    expect(firstOfNextMonth("2026-12-31")).toBe("2027-01-01");
  });

  it("needs no leap-year case", () => {
    expect(firstOfNextMonth("2028-02-29")).toBe("2028-03-01");
    expect(firstOfNextMonth("2026-02-28")).toBe("2026-03-01");
  });
});

describe("quickRescheduleOptions", () => {
  it("returns every kind once, in menu order", () => {
    expect(quickRescheduleOptions(MONDAY).map((o) => o.kind)).toEqual(ALL_KINDS);
  });

  it("labels each row as prose, with the date carried separately", () => {
    expect(quickRescheduleOptions(MONDAY)).toEqual([
      { kind: "tomorrow", label: "Tomorrow", date: "2026-08-04" },
      { kind: "in2days", label: "In 2 days", date: "2026-08-05" },
      { kind: "in3days", label: "In 3 days", date: "2026-08-06" },
      { kind: "nextWeek", label: "Next week", date: "2026-08-10" },
      { kind: "nextMonth", label: "Next month", date: "2026-09-01" },
    ]);
  });

  it("agrees with quickRescheduleDate for every kind", () => {
    for (const option of quickRescheduleOptions("2026-08-07")) {
      expect(option.date).toBe(quickRescheduleDate(option.kind, "2026-08-07"));
    }
  });

  /**
   * Rule 1: the anchor is today, so the options never depend on where a card
   * currently sits. Two different anchors must produce two different sets —
   * this is the guard against someone quietly reintroducing `scheduledDate`.
   */
  it("is a pure function of its anchor", () => {
    expect(quickRescheduleOptions("2026-08-03")).not.toEqual(
      quickRescheduleOptions("2026-08-04"),
    );
  });
});
