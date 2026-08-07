import { describe, expect, it } from "vitest";
import { RAIL_COLLAPSE_THRESHOLD, RAIL_MAX, RAIL_MIN } from "@/lib/rail";
import { clampRailWidth, nudgeRailWidth, resolveDragWidth } from "./use-rail-resize";

describe("clampRailWidth", () => {
  it("passes through a width already in range", () => {
    expect(clampRailWidth(250)).toBe(250);
  });

  it("floors at RAIL_MIN", () => {
    expect(clampRailWidth(0)).toBe(RAIL_MIN);
    expect(clampRailWidth(RAIL_MIN - 1)).toBe(RAIL_MIN);
  });

  it("ceils at RAIL_MAX", () => {
    expect(clampRailWidth(RAIL_MAX + 500)).toBe(RAIL_MAX);
  });
});

describe("resolveDragWidth", () => {
  it("adds the drag delta to the starting width", () => {
    expect(resolveDragWidth(200, 50)).toBe(250);
    expect(resolveDragWidth(200, -30)).toBe(170);
  });

  it("clamps within range while above the collapse threshold", () => {
    expect(resolveDragWidth(RAIL_MIN, 10_000)).toBe(RAIL_MAX);
  });

  it("returns null once the drag crosses the collapse threshold", () => {
    expect(resolveDragWidth(RAIL_MIN, RAIL_COLLAPSE_THRESHOLD - RAIL_MIN - 1)).toBeNull();
  });

  it("does not collapse right at the threshold", () => {
    expect(resolveDragWidth(RAIL_MIN, RAIL_COLLAPSE_THRESHOLD - RAIL_MIN)).toBe(RAIL_MIN);
  });
});

describe("nudgeRailWidth", () => {
  it("adds delta and clamps", () => {
    expect(nudgeRailWidth(200, 16)).toBe(216);
    expect(nudgeRailWidth(RAIL_MIN, -16)).toBe(RAIL_MIN);
    expect(nudgeRailWidth(RAIL_MAX, 16)).toBe(RAIL_MAX);
  });
});
