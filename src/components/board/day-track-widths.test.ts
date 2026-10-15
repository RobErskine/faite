import { describe, expect, it } from "vitest";
import {
  DAY_COLUMN_WIDTH_CLASS,
  dayColumnWidth,
  dayTrackStyle,
} from "./day-track-widths";

/**
 * EI-384: Today gets room. The rule in one place, so the three widths can be
 * checked without a layout engine (desktop-layout.spec.ts measures the real
 * pixels).
 */
describe("dayColumnWidth", () => {
  it("gives Today the today width, and only Today", () => {
    expect(dayColumnWidth(0, 7, true)).toBe("today");
    for (let i = 1; i < 30; i++) expect(dayColumnWidth(i, 7, true)).not.toBe("today");
  });

  it("narrows the other days on Today's page, and none after it", () => {
    for (let i = 1; i <= 6; i++) expect(dayColumnWidth(i, 7, true)).toBe("near");
    for (let i = 7; i < 30; i++) expect(dayColumnWidth(i, 7, true)).toBe("far");
    expect(dayColumnWidth(1, 3, true)).toBe("near");
    expect(dayColumnWidth(2, 3, true)).toBe("near");
    expect(dayColumnWidth(3, 3, true)).toBe("far");
  });

  it("has no near days in a 1-day view — Today is the whole page", () => {
    expect(dayColumnWidth(0, 1, true)).toBe("today");
    expect(dayColumnWidth(1, 1, true)).toBe("far");
  });

  it("keeps every column equal off desktop (tablet)", () => {
    for (let i = 0; i < 10; i++) expect(dayColumnWidth(i, 7, false)).toBe("far");
  });

  it("only re-points the variables for today and near — a far column inherits the track's", () => {
    expect(DAY_COLUMN_WIDTH_CLASS.today).toContain("var(--column-today)");
    expect(DAY_COLUMN_WIDTH_CLASS.near).toContain("var(--column-near)");
    expect(DAY_COLUMN_WIDTH_CLASS.far).toBeUndefined();
  });
});

describe("dayTrackStyle", () => {
  const vars = (visibleDays: number, wide: boolean) =>
    dayTrackStyle(visibleDays, wide) as Record<string, string>;

  it("keeps the far width exactly what every column used to be", () => {
    const style = vars(7, true);
    const before = "max(var(--column-floor), calc((100% - 72px) / 7))";
    expect(style["--column-min"]).toBe(before);
    expect(style["--column-max"]).toBe(before);
  });

  it("shares Today's page between N-1 near days and one ratio-wide Today", () => {
    const style = vars(7, true);
    expect(style["--column-near"]).toBe(
      "max(var(--column-floor), calc((100% - 72px) / (6 + var(--column-today-ratio))))",
    );
    expect(style["--column-today"]).toBe("calc(var(--column-near) * var(--column-today-ratio))");
  });

  it("sets no today/near variables off desktop", () => {
    const style = vars(7, false);
    expect(style["--column-near"]).toBeUndefined();
    expect(style["--column-today"]).toBeUndefined();
  });

  /**
   * The arithmetic the CSS performs, checked in numbers: at 1440×900 the
   * track is 1174px (measured), and at 1920 it is 1654px.
   */
  it("fills the track exactly with Today + near days when the floor does not bind", () => {
    const FLOOR = 168;
    const RATIO = 1.5;
    const resolve = (track: number, n: number) => {
      const gaps = (n - 1) * 12;
      const near = Math.max(FLOOR, (track - gaps) / (n - 1 + RATIO));
      const far = Math.max(FLOOR, (track - gaps) / n);
      return { near, today: near * RATIO, far, firstPage: near * RATIO + (n - 1) * near + gaps };
    };

    // 1920, 7 days: Today 316px beside 211px days; later pages 226px each.
    const wide = resolve(1654, 7);
    expect(wide.firstPage).toBeCloseTo(1654);
    expect(wide.today / wide.near).toBeCloseTo(RATIO);

    // 1440, 7 days: the floor binds, so only Today changes (168 -> 252).
    const laptop = resolve(1174, 7);
    expect(laptop.near).toBe(FLOOR);
    expect(laptop.far).toBe(FLOOR);
    expect(laptop.today).toBe(252);

    // 1-day view: Today is the whole track, same as before.
    expect(resolve(1174, 1).today).toBeCloseTo(1174);
  });
});
