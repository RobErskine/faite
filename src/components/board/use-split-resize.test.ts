import { describe, expect, it } from "vitest";
import { SPLIT_COLLAPSE_THRESHOLD, SPLIT_DEFAULT, SPLIT_MIN } from "@/lib/split";
import { clampSplit, nudgeSplit, resolveDragSplit } from "./use-split-resize";

describe("clampSplit", () => {
  it("converts a pixel height to a percent of the total", () => {
    expect(clampSplit(500, 1000)).toBe(50);
  });

  it("floors the top half at SPLIT_MIN", () => {
    const totalPx = 1000;
    const floor = clampSplit(0, totalPx);
    expect(floor).toBeCloseTo((SPLIT_MIN / totalPx) * 100);
  });

  it("floors the bottom half at SPLIT_MIN", () => {
    const totalPx = 1000;
    const ceiling = clampSplit(totalPx, totalPx);
    expect(ceiling).toBeCloseTo(100 - (SPLIT_MIN / totalPx) * 100);
  });

  it("falls back to the default when the total can't fit both floors", () => {
    expect(clampSplit(100, SPLIT_MIN * 2 - 1)).toBe(SPLIT_DEFAULT);
  });
});

describe("resolveDragSplit", () => {
  const totalPx = 1000;

  it("adds the drag delta and returns a percent while both halves clear the floor", () => {
    expect(resolveDragSplit(500, 50, totalPx)).toBeCloseTo(55);
    expect(resolveDragSplit(500, -50, totalPx)).toBeCloseTo(45);
  });

  it("collapses the calendar once the top crosses its threshold", () => {
    expect(resolveDragSplit(SPLIT_MIN, SPLIT_COLLAPSE_THRESHOLD - SPLIT_MIN - 1, totalPx)).toBe(
      "calendar",
    );
  });

  it("does not collapse the calendar right at the threshold", () => {
    const result = resolveDragSplit(SPLIT_MIN, SPLIT_COLLAPSE_THRESHOLD - SPLIT_MIN, totalPx);
    expect(result).not.toBe("calendar");
  });

  it("collapses the planning half once the bottom crosses its threshold", () => {
    const startTopPx = totalPx - SPLIT_MIN;
    const dy = totalPx - SPLIT_COLLAPSE_THRESHOLD - startTopPx + 1;
    expect(resolveDragSplit(startTopPx, dy, totalPx)).toBe("planning");
  });
});

describe("nudgeSplit", () => {
  it("adds delta and clamps", () => {
    const totalPx = 1000;
    expect(nudgeSplit(500, 16, totalPx)).toBeCloseTo(51.6);
    expect(nudgeSplit(0, -16, totalPx)).toBeCloseTo((SPLIT_MIN / totalPx) * 100);
  });
});
