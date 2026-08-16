import { describe, expect, it } from "vitest";
import {
  SWIPE_ACTION,
  SWIPE_AXIS_LOCK_PX,
  SWIPE_COMMIT_PX,
  resolveSwipeDirection,
  swipeProgress,
} from "./overdrive-swipe";

describe("resolveSwipeDirection", () => {
  it("is null inside the deadzone in every direction", () => {
    expect(resolveSwipeDirection(0, 0)).toBeNull();
    expect(resolveSwipeDirection(SWIPE_AXIS_LOCK_PX - 1, 0)).toBeNull();
    expect(resolveSwipeDirection(0, SWIPE_AXIS_LOCK_PX - 1)).toBeNull();
    expect(resolveSwipeDirection(-(SWIPE_AXIS_LOCK_PX - 1), 0)).toBeNull();
  });

  it("locks left/right once the deadzone clears on the horizontal axis", () => {
    expect(resolveSwipeDirection(SWIPE_AXIS_LOCK_PX, 0)).toBe("right");
    expect(resolveSwipeDirection(-SWIPE_AXIS_LOCK_PX, 0)).toBe("left");
  });

  it("locks up/down once the deadzone clears on the vertical axis", () => {
    expect(resolveSwipeDirection(0, SWIPE_AXIS_LOCK_PX)).toBe("down");
    expect(resolveSwipeDirection(0, -SWIPE_AXIS_LOCK_PX)).toBe("up");
  });

  it("picks whichever axis has travelled farther on a diagonal drag", () => {
    expect(resolveSwipeDirection(40, 10)).toBe("right");
    expect(resolveSwipeDirection(10, 40)).toBe("down");
    expect(resolveSwipeDirection(-40, -10)).toBe("left");
    expect(resolveSwipeDirection(-10, -40)).toBe("up");
  });

  it("a perfect tie goes to the horizontal axis (adx > ady is strict)", () => {
    expect(resolveSwipeDirection(20, 20)).toBe("down");
  });
});

describe("swipeProgress", () => {
  it("is 0 at the start of a gesture", () => {
    expect(swipeProgress(0, 0, "left")).toBe(0);
  });

  it("scales linearly toward SWIPE_COMMIT_PX along the locked axis", () => {
    expect(swipeProgress(SWIPE_COMMIT_PX / 2, 0, "right")).toBeCloseTo(0.5);
    expect(swipeProgress(-SWIPE_COMMIT_PX / 2, 0, "left")).toBeCloseTo(0.5);
    expect(swipeProgress(0, SWIPE_COMMIT_PX / 2, "down")).toBeCloseTo(0.5);
    expect(swipeProgress(0, -SWIPE_COMMIT_PX / 2, "up")).toBeCloseTo(0.5);
  });

  it("reaches exactly 1 at the commit threshold and clamps beyond it", () => {
    expect(swipeProgress(SWIPE_COMMIT_PX, 0, "right")).toBe(1);
    expect(swipeProgress(SWIPE_COMMIT_PX * 3, 0, "right")).toBe(1);
  });

  it("ignores travel on the axis that didn't lock", () => {
    // Locked "right", but the finger also drifted vertically — only dx counts.
    expect(swipeProgress(SWIPE_COMMIT_PX, 500, "right")).toBe(1);
    expect(swipeProgress(10, 500, "right")).toBeCloseTo(10 / SWIPE_COMMIT_PX);
  });
});

describe("SWIPE_ACTION", () => {
  it("maps each direction to the same KeyAction the keyboard/buttons use", () => {
    expect(SWIPE_ACTION.left).toBe("wontDo");
    expect(SWIPE_ACTION.up).toBe("done");
    expect(SWIPE_ACTION.down).toBe("toList");
    // Right stages rather than commits — the asymmetric one (ticket note).
    expect(SWIPE_ACTION.right).toBe("ramp");
  });
});
