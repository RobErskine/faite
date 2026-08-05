import { describe, expect, it } from "vitest";
import {
  canJumpBack,
  canJumpForward,
  clampJumpTarget,
  computeAnchorIndex,
  computeVisibleCount,
} from "./use-day-track";

describe("computeAnchorIndex", () => {
  it("divides scroll position by column pitch", () => {
    expect(computeAnchorIndex(0, 169)).toBe(0);
    expect(computeAnchorIndex(169 * 3, 169)).toBe(3);
  });

  it("rounds to the nearest column mid-scroll", () => {
    expect(computeAnchorIndex(169 * 3 + 80, 169)).toBe(3);
    expect(computeAnchorIndex(169 * 3 + 90, 169)).toBe(4);
  });

  it("is 0 when the pitch has not been measured yet", () => {
    expect(computeAnchorIndex(500, 0)).toBe(0);
  });
});

describe("computeVisibleCount", () => {
  it("divides track width by column pitch", () => {
    expect(computeVisibleCount(169 * 7, 169)).toBe(7);
  });

  it("is never less than 1, even on a sliver of width", () => {
    expect(computeVisibleCount(10, 169)).toBe(1);
  });

  it("is 1 when the pitch has not been measured yet", () => {
    expect(computeVisibleCount(1000, 0)).toBe(1);
  });
});

describe("clampJumpTarget", () => {
  it("adds the delta to the anchor", () => {
    expect(clampJumpTarget(0, 7, 180)).toBe(7);
    expect(clampJumpTarget(10, -7, 180)).toBe(3);
  });

  it("clamps at 0, never going negative", () => {
    expect(clampJumpTarget(3, -7, 180)).toBe(0);
  });

  it("clamps at cap - 1", () => {
    expect(clampJumpTarget(175, 90, 180)).toBe(179);
  });
});

describe("canJumpBack", () => {
  it("is true when the full delta fits before the anchor", () => {
    expect(canJumpBack(7, 7)).toBe(true);
    expect(canJumpBack(10, 7)).toBe(true);
  });

  it("is false once the jump would go negative", () => {
    expect(canJumpBack(6, 7)).toBe(false);
    expect(canJumpBack(0, 7)).toBe(false);
  });
});

describe("canJumpForward", () => {
  it("is true when the full delta fits inside the cap", () => {
    expect(canJumpForward(0, 7, 180)).toBe(true);
    expect(canJumpForward(172, 7, 180)).toBe(true);
  });

  it("is false once the jump would reach or pass the cap", () => {
    expect(canJumpForward(173, 7, 180)).toBe(false);
    expect(canJumpForward(179, 1, 180)).toBe(false);
  });
});
