import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveDateInputs, scheduledDateInputSchema, toCivilDate } from "./date-input";

describe("scheduledDateInputSchema", () => {
  it.each([
    ["2026-09-15", true],
    ["2026-09-15T14:00:00-04:00", true],
    ["2026-09-15T18:00:00Z", true],
    [null, true],
    ["2026-13-45", false],
    ["2026-09-15T14:00:00", false], // no offset names no day
    ["tomorrow", false],
  ])("%s → %s", (value, ok) => {
    expect(scheduledDateInputSchema.safeParse(value).success).toBe(ok);
  });

  it("publishes date, date-time and null as anyOf", () => {
    const json = z.toJSONSchema(scheduledDateInputSchema) as { anyOf: Array<Record<string, string>> };
    expect(json.anyOf.map((s) => s.format ?? s.type)).toEqual(["date", "date-time", "null"]);
  });
});

describe("toCivilDate", () => {
  it("keeps a plain date and null", () => {
    expect(toCivilDate("2026-09-15", "America/New_York")).toBe("2026-09-15");
    expect(toCivilDate(null, "America/New_York")).toBeNull();
  });

  it("takes the date in the user's timezone, not the string's", () => {
    const lateEvening = "2026-09-15T23:30:00-04:00";
    expect(toCivilDate(lateEvening, "America/New_York")).toBe("2026-09-15");
    expect(toCivilDate(lateEvening, "America/Los_Angeles")).toBe("2026-09-15");
    expect(toCivilDate(lateEvening, "UTC")).toBe("2026-09-16");
    expect(toCivilDate("2026-09-15T02:00:00Z", "America/Los_Angeles")).toBe("2026-09-14");
  });
});

describe("resolveDateInputs", () => {
  it("never loads the timezone for plain dates", async () => {
    const load = vi.fn(async () => "UTC");
    const input = { title: "x", scheduledDate: "2026-09-15", deadline: null };
    expect(await resolveDateInputs(input, load)).toBe(input);
    expect(load).not.toHaveBeenCalled();
  });

  it("converts both fields once, and adds no absent key", async () => {
    const load = vi.fn(async () => "UTC");
    const resolved = await resolveDateInputs({ scheduledDate: "2026-09-15T23:30:00-04:00" }, load);
    expect(resolved).toEqual({ scheduledDate: "2026-09-16" });
    expect("deadline" in resolved).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
