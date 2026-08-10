import { describe, expect, it } from "vitest";
import type { DayColumn } from "@/lib/board";
import { dayColumnId } from "@/lib/board";
import { buildWindow } from "@/lib/scheduling";
import {
  calendarSpanFor,
  groupWeekendRuns,
  slotDayColumns,
  weekendDaysFrom,
} from "./weekend-runs";

/**
 * Reference dates, spelled out so a failure names a weekday rather than a
 * string. 2026-08-03 is a Monday, which makes the whole week readable from it.
 */
const MONDAY = "2026-08-03";
const FRIDAY = "2026-08-07";
const SATURDAY = "2026-08-08";
const SUNDAY = "2026-08-09";

const MON_FRI = weekendDaysFrom([1, 2, 3, 4, 5]);

/** Day columns for a window, with only the fields these functions read. */
function days(from: string, length: number): DayColumn[] {
  return buildWindow(from, length).map((day) => ({
    id: dayColumnId(day),
    day,
    todos: [],
    groups: [],
  }));
}

describe("weekendDaysFrom", () => {
  it("is the complement of the workdays", () => {
    expect([...MON_FRI].sort()).toEqual([0, 6]);
  });

  it("follows a non-standard week rather than assuming Sat/Sun", () => {
    // Works Sunday through Thursday — Friday and Saturday are the weekend.
    expect([...weekendDaysFrom([0, 1, 2, 3, 4])].sort()).toEqual([5, 6]);
  });

  it("treats every day as a weekend when nothing is a workday", () => {
    expect(weekendDaysFrom([]).size).toBe(7);
  });
});

describe("calendarSpanFor", () => {
  it("needs no extra days when the run never reaches a weekend", () => {
    // Mon–Fri is five working days in five calendar days.
    expect(calendarSpanFor(MONDAY, 5, MON_FRI)).toBe(5);
  });

  /** THE CASE THE FEATURE EXISTS FOR: 5 columns on a Friday spans a weekend. */
  it("stretches the span so N working days stay visible", () => {
    // Fri + [Sat, Sun] + Mon, Tue, Wed, Thu — five columns, seven days.
    expect(calendarSpanFor(FRIDAY, 5, MON_FRI)).toBe(7);
  });

  it("counts a weekend start day as part of the span", () => {
    // Sat, Sun, then Mon–Wed makes three working days by day five.
    expect(calendarSpanFor(SATURDAY, 3, MON_FRI)).toBe(5);
    expect(calendarSpanFor(SUNDAY, 3, MON_FRI)).toBe(4);
  });

  /**
   * A span ending on a weekend day would leave a trailing strip you can open
   * to find days that are only there because they were on the way somewhere.
   */
  it("always ends on a working day", () => {
    for (let n = 1; n <= 7; n++) {
      for (const start of [MONDAY, FRIDAY, SATURDAY, SUNDAY]) {
        const span = calendarSpanFor(start, n, MON_FRI);
        const window = buildWindow(start, span);
        const last = window[window.length - 1];
        expect(MON_FRI.has(new Date(`${last}T12:00:00Z`).getUTCDay())).toBe(false);
      }
    }
  });

  it("falls back instead of looping forever when no day is a workday", () => {
    expect(calendarSpanFor(MONDAY, 5, weekendDaysFrom([]))).toBe(5);
  });

  it("is zero for a zero-column request", () => {
    expect(calendarSpanFor(MONDAY, 0, MON_FRI)).toBe(0);
  });
});

describe("groupWeekendRuns", () => {
  it("folds Sat and Sun into one slot and leaves weekdays alone", () => {
    const slots = groupWeekendRuns(days(MONDAY, 9), MON_FRI);
    expect(slots.map((s) => s.kind)).toEqual([
      "day", // Mon
      "day", // Tue
      "day", // Wed
      "day", // Thu
      "day", // Fri
      "weekend", // Sat + Sun
      "day", // Mon
      "day", // Tue
    ]);
    const weekend = slots.find((s) => s.kind === "weekend");
    expect(weekend?.kind === "weekend" && weekend.columns.map((c) => c.day)).toEqual([
      SATURDAY,
      SUNDAY,
    ]);
  });

  it("keys the slot on the run's first day", () => {
    const slots = groupWeekendRuns(days(FRIDAY, 4), MON_FRI);
    const weekend = slots.find((s) => s.kind === "weekend");
    expect(weekend?.kind === "weekend" && weekend.id).toBe(`weekend:${SATURDAY}`);
  });

  /**
   * The window starts at TODAY, so it can begin or end mid-weekend. A run is
   * whatever is actually in the window, never a padded Sat+Sun pair.
   */
  it("makes a one-day run when the window opens on a Sunday", () => {
    const slots = groupWeekendRuns(days(SUNDAY, 3), MON_FRI);
    expect(slots.map((s) => s.kind)).toEqual(["weekend", "day", "day"]);
    const weekend = slots[0];
    expect(weekend.kind === "weekend" && weekend.columns.map((c) => c.day)).toEqual([
      SUNDAY,
    ]);
  });

  it("closes a run that reaches the end of the window", () => {
    // Thu, Fri, Sat — the trailing Saturday still becomes a slot.
    const slots = groupWeekendRuns(days("2026-08-06", 3), MON_FRI);
    expect(slots.map((s) => s.kind)).toEqual(["day", "day", "weekend"]);
  });

  it("groups whatever the workdays setting calls a weekend", () => {
    // Wednesday off: the run is a single midweek day.
    const midweekOff = weekendDaysFrom([0, 1, 2, 4, 5, 6]);
    const slots = groupWeekendRuns(days(MONDAY, 4), midweekOff);
    expect(slots.map((s) => s.kind)).toEqual(["day", "day", "weekend", "day"]);
  });

  it("returns every column when nothing is a weekend", () => {
    const columns = days(MONDAY, 7);
    const slots = groupWeekendRuns(columns, weekendDaysFrom([0, 1, 2, 3, 4, 5, 6]));
    expect(slots.every((s) => s.kind === "day")).toBe(true);
  });

  it("loses no day column, whatever the grouping", () => {
    const columns = days(FRIDAY, 14);
    expect(slotDayColumns(groupWeekendRuns(columns, MON_FRI)).map((c) => c.day)).toEqual(
      columns.map((c) => c.day),
    );
  });
});
