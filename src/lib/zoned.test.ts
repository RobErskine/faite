import { describe, expect, it } from "vitest";
import { wallClockTimeIn, zonedInstant } from "./zoned";

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

describe("wallClockTimeIn", () => {
  const instant = new Date("2026-09-08T03:07:00.000Z");

  it("reads the time in the given zone, 24-hour", () => {
    expect(wallClockTimeIn("UTC", instant)).toBe("03:07");
    expect(wallClockTimeIn("America/New_York", instant)).toBe("23:07");
  });

  it("reads midnight as 00, not 24", () => {
    expect(wallClockTimeIn("UTC", new Date("2026-09-08T00:15:00.000Z"))).toBe("00:15");
  });

  it("falls back to UTC on an unknown zone", () => {
    expect(wallClockTimeIn("Not/AZone", instant)).toBe("03:07");
  });
});
