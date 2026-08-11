import { describe, expect, it } from "vitest";
import { zonedInstant } from "./zoned";

describe("zonedInstant", () => {
  it("treats UTC as itself", () => {
    expect(zonedInstant("2026-08-07", "09:00", "UTC")).toBe("2026-08-07T09:00:00.000Z");
  });

  it("converts a fixed positive offset with no DST (Asia/Tokyo, UTC+9)", () => {
    expect(zonedInstant("2026-08-07", "09:00", "Asia/Tokyo")).toBe(
      "2026-08-07T00:00:00.000Z",
    );
  });

  it("converts a DST-observing zone in standard time (America/New_York, January, EST -5)", () => {
    expect(zonedInstant("2026-01-15", "09:00", "America/New_York")).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("converts the same zone in daylight time (America/New_York, July, EDT -4)", () => {
    expect(zonedInstant("2026-07-15", "09:00", "America/New_York")).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("round-trips midnight and end-of-day times", () => {
    expect(zonedInstant("2026-08-07", "00:00", "America/New_York")).toBe(
      "2026-08-07T04:00:00.000Z",
    );
    expect(zonedInstant("2026-08-07", "23:59", "America/New_York")).toBe(
      "2026-08-08T03:59:00.000Z",
    );
  });

  it("falls back to UTC on an unrecognized timezone rather than throwing", () => {
    expect(zonedInstant("2026-08-07", "09:00", "Not/A_Zone")).toBe(
      "2026-08-07T09:00:00.000Z",
    );
  });

  it("throws on a malformed time", () => {
    expect(() => zonedInstant("2026-08-07", "9:00", "UTC")).toThrow();
    expect(() => zonedInstant("2026-08-07", "0900", "UTC")).toThrow();
  });

  // Documented limitation (see zoned.ts's header comment): the transition
  // hour itself isn't asserted exactly, only that it returns SOME valid
  // instant rather than throwing or returning garbage.
  it("returns a valid instant during a DST transition hour, without asserting which side", () => {
    const result = zonedInstant("2026-03-08", "02:30", "America/New_York");
    expect(() => new Date(result)).not.toThrow();
    expect(Number.isNaN(new Date(result).getTime())).toBe(false);
  });
});
