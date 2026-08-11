import { describe, expect, it } from "vitest";
import {
  addMonths,
  addYears,
  defaultRule,
  firstOccurrenceAfter,
  nextAfterCompletion,
  occurrenceId,
  occurrencesBetween,
  parseOccurrenceId,
  parseRule,
  serializeRule,
  summarizeRule,
  type RecurrenceRule,
} from "./recurrence";

const rule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  v: 1,
  freq: "daily",
  interval: 1,
  byDay: [],
  anchor: "scheduled",
  until: null,
  count: null,
  ...overrides,
});

describe("addMonths / addYears — month-end clamping", () => {
  it("clamps Jan 31 + 1 month to Feb 28 in a non-leap year", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
  });

  it("clamps Jan 31 + 1 month to Feb 29 in a leap year", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("clamps Jan 30 + 1 month to Feb 28/29 correctly across both", () => {
    expect(addMonths("2025-01-30", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-30", 1)).toBe("2024-02-29");
  });

  it("does not clamp when the target month is long enough", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
  });

  it("crosses a year boundary", () => {
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("clamps Feb 29 + 1 year to Feb 28", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
  });

  it("keeps Feb 29 across a 4-year step landing on a leap year", () => {
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });
});

describe("iterateOccurrences — daily", () => {
  it("yields every interval-th day from seriesStart", () => {
    const r = rule({ freq: "daily", interval: 2 });
    const dates = occurrencesBetween(r, "2026-08-01", "2026-08-01", "2026-08-10");
    expect(dates).toEqual(["2026-08-01", "2026-08-03", "2026-08-05", "2026-08-07", "2026-08-09"]);
  });

  it("stops at `until`, inclusive", () => {
    const r = rule({ freq: "daily", until: "2026-08-05" });
    const dates = occurrencesBetween(r, "2026-08-01", "2026-08-01", "2026-08-31");
    expect(dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("stops after `count` occurrences", () => {
    const r = rule({ freq: "daily", count: 3 });
    const dates = occurrencesBetween(r, "2026-08-01", "2026-08-01", "2026-08-31");
    expect(dates).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  it("never yields before seriesStart", () => {
    const r = rule({ freq: "daily" });
    const dates = occurrencesBetween(r, "2026-08-05", "2026-08-01", "2026-08-10");
    expect(dates[0]).toBe("2026-08-05");
  });
});

describe("iterateOccurrences — weekly", () => {
  it("defaults byDay to the series start's own weekday", () => {
    // 2026-08-07 is a Friday
    const r = rule({ freq: "weekly" });
    const dates = occurrencesBetween(r, "2026-08-07", "2026-08-07", "2026-08-28");
    expect(dates).toEqual(["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"]);
  });

  it("honours explicit byDay across a single week", () => {
    // Mon=1, Wed=3, Fri=5. Series starts Monday 2026-08-03.
    const r = rule({ freq: "weekly", byDay: [1, 3, 5] });
    const dates = occurrencesBetween(r, "2026-08-03", "2026-08-03", "2026-08-09");
    expect(dates).toEqual(["2026-08-03", "2026-08-05", "2026-08-07"]);
  });

  it("skips byDay days in week 0 that fall before seriesStart", () => {
    // Series starts Wednesday; Monday of that week must not appear.
    const r = rule({ freq: "weekly", byDay: [1, 3, 5] });
    const dates = occurrencesBetween(r, "2026-08-05", "2026-08-01", "2026-08-09");
    expect(dates).toEqual(["2026-08-05", "2026-08-07"]);
  });

  it("honours interval > 1 (every other week)", () => {
    const r = rule({ freq: "weekly", interval: 2, byDay: [5] });
    const dates = occurrencesBetween(r, "2026-08-07", "2026-08-07", "2026-09-30");
    expect(dates).toEqual(["2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18"]);
  });

  it("stops at `until` mid-week", () => {
    const r = rule({ freq: "weekly", byDay: [1, 3, 5], until: "2026-08-12" });
    const dates = occurrencesBetween(r, "2026-08-03", "2026-08-03", "2026-08-31");
    expect(dates).toEqual(["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-10", "2026-08-12"]);
  });
});

describe("iterateOccurrences — monthly / yearly", () => {
  it("monthly clamps across Jan/Feb", () => {
    const r = rule({ freq: "monthly" });
    const dates = occurrencesBetween(r, "2026-01-31", "2026-01-31", "2026-04-30");
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("yearly on a leap-day anchor", () => {
    const r = rule({ freq: "yearly" });
    const dates = occurrencesBetween(r, "2024-02-29", "2024-02-29", "2028-02-29");
    expect(dates).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });
});

describe("nextAfterCompletion", () => {
  it("steps one interval past the completion, ignoring byDay", () => {
    const r = rule({ freq: "weekly", interval: 2, byDay: [1, 3, 5] });
    expect(nextAfterCompletion(r, "2026-08-07")).toBe("2026-08-21");
  });

  it("monthly clamps like the generator", () => {
    const r = rule({ freq: "monthly" });
    expect(nextAfterCompletion(r, "2026-01-31")).toBe("2026-02-28");
  });
});

describe("firstOccurrenceAfter", () => {
  it("skips the seed date and lands on the next weekly occurrence", () => {
    const r = rule({ freq: "weekly", byDay: [5] });
    expect(firstOccurrenceAfter(r, "2026-08-07")).toBe("2026-08-14");
  });

  it("stays aligned when re-anchored to the second occurrence", () => {
    const r = rule({ freq: "weekly", byDay: [5] });
    const second = firstOccurrenceAfter(r, "2026-08-07");
    const third = firstOccurrenceAfter(r, second);
    expect(third).toBe("2026-08-21");
  });

  it("uses nextAfterCompletion for anchor: completed", () => {
    const r = rule({ freq: "daily", interval: 3, anchor: "completed" });
    expect(firstOccurrenceAfter(r, "2026-08-07")).toBe("2026-08-10");
  });

  it("throws when count is too tight to have a second occurrence", () => {
    const r = rule({ freq: "daily", count: 1 });
    expect(() => firstOccurrenceAfter(r, "2026-08-07")).toThrow();
  });
});

describe("occurrenceId / parseOccurrenceId", () => {
  it("round-trips", () => {
    const id = occurrenceId("019abc-template-id", "2026-08-07");
    expect(id).toBe("019abc-template-id@2026-08-07");
    expect(parseOccurrenceId(id)).toEqual({
      templateId: "019abc-template-id",
      date: "2026-08-07",
    });
  });

  it("returns null for a non-occurrence id", () => {
    expect(parseOccurrenceId("019abc-plain-id")).toBeNull();
  });
});

describe("parseRule / serializeRule", () => {
  it("round-trips a valid rule", () => {
    const r = defaultRule("2026-08-07");
    expect(parseRule(serializeRule(r))).toEqual(r);
  });

  it("returns null for null/undefined/garbage/wrong version", () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule(undefined)).toBeNull();
    expect(parseRule("not json")).toBeNull();
    expect(parseRule(JSON.stringify({ v: 2, freq: "daily" }))).toBeNull();
  });
});

describe("summarizeRule", () => {
  it("describes a simple weekly rule", () => {
    const r = rule({ freq: "weekly", byDay: [5] });
    expect(summarizeRule(r, "2026-08-07")).toBe("Every week on Fri");
  });

  it("describes interval, anchor, and an end condition", () => {
    const r = rule({ freq: "weekly", interval: 2, byDay: [1, 3], anchor: "completed", count: 5 });
    expect(summarizeRule(r, "2026-08-03")).toBe(
      "Every 2 weeks on Mon, Wed, based on completion date, 5 times",
    );
  });
});
