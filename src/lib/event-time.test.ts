import { describe, expect, it } from "vitest";
import { formatCompletionStamp, formatEventStamp, formatEventTime } from "./event-time";

/**
 * `formatEventTime`/`formatEventStamp` are exercised indirectly by
 * `day-timeline.test.ts` and `todo-timeline.test.ts`; the cases here are the
 * ones `formatCompletionStamp` (EI-192) depends on directly.
 */
describe("formatCompletionStamp", () => {
  // 2026-08-14T21:41:00Z is Aug 14 in UTC but still Aug 14 in New York (5:41 PM).
  const instant = "2026-08-14T21:41:00.000Z";

  it("names a completed todo", () => {
    expect(formatCompletionStamp("done", instant, "UTC")).toBe("Completed Aug 14 · 9:41 PM");
  });

  it("says dropped, not completed, for a won't-do", () => {
    // The whole reason this is not one string: "Completed" over abandoned
    // work claims credit for it.
    expect(formatCompletionStamp("dropped", instant, "UTC")).toBe("Dropped Aug 14 · 9:41 PM");
  });

  it("says nothing for an open todo", () => {
    expect(formatCompletionStamp("open", null, "UTC")).toBeNull();
  });

  it("says nothing for an open todo that somehow kept a stamp", () => {
    // Reopening nulls `completedAt`, so this should not occur — but status is
    // the authority on whether the todo is settled, not the timestamp.
    expect(formatCompletionStamp("open", instant, "UTC")).toBeNull();
  });

  it("says nothing when there is no timestamp", () => {
    expect(formatCompletionStamp("done", null, "UTC")).toBeNull();
  });

  it("says nothing rather than an empty stamp for an unparseable instant", () => {
    // `formatEventStamp` returns "" here; passing it through would open an
    // empty tooltip popup on hover.
    expect(formatCompletionStamp("done", "not-a-date", "UTC")).toBeNull();
    expect(formatEventStamp("not-a-date", "UTC")).toBe("");
  });

  it("renders in the given timezone, not UTC", () => {
    const utc = formatCompletionStamp("done", instant, "UTC");
    const la = formatCompletionStamp("done", instant, "America/Los_Angeles");
    expect(la).not.toBe(utc);
    // 21:41Z is 2:41 PM the same day in Los Angeles.
    expect(la).toBe("Completed Aug 14 · 2:41 PM");
  });

  it("crosses a date boundary with the timezone", () => {
    // 03:30Z on the 15th is still the evening of the 14th in New York.
    const stamp = formatCompletionStamp("done", "2026-08-15T03:30:00.000Z", "America/New_York");
    expect(stamp).toBe("Completed Aug 14 · 11:30 PM");
  });

  it("falls back to UTC for a garbage timezone rather than throwing", () => {
    expect(formatCompletionStamp("done", instant, "Not/AZone")).toBe("Completed Aug 14 · 9:41 PM");
    expect(formatEventTime(instant, "Not/AZone")).toBe("9:41 PM");
  });
});
