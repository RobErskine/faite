import { describe, expect, it } from "vitest";
import {
  PRIORITY_RAILS,
  byPriorityThenPosition,
  priorityRail,
  priorityRank,
} from "./priority";
import { isTintableColor } from "./colors";
import type { Priority, Todo } from "./schema";

const LEVELS: Priority[] = [1, 2, 3, 4];

describe("priorityRail", () => {
  it("renders nothing for an unprioritised to-do", () => {
    expect(priorityRail(null)).toBeUndefined();
    expect(priorityRail(undefined)).toBeUndefined();
  });

  it("resolves every level", () => {
    expect(LEVELS.map((p) => priorityRail(p)?.width)).toEqual([3, 2, 1, 1]);
  });
});

describe("the encoding", () => {
  /*
    The whole point of the rail is that thickness and hue are two channels. If a
    future palette edit made two levels identical on both, the design would
    silently stop encoding anything — so the invariant is a test, not a comment.
  */
  it("never lets two levels share both width and colour", () => {
    const keys = LEVELS.map((p) => {
      const rail = PRIORITY_RAILS[p];
      return `${rail.width}:${rail.color}`;
    });
    expect(new Set(keys).size).toBe(LEVELS.length);
  });

  it("gives every level its own colour", () => {
    const colors = LEVELS.map((p) => PRIORITY_RAILS[p].color);
    expect(new Set(colors).size).toBe(LEVELS.length);
  });

  // Six-digit hex is what the rest of the app can tint; shorthand or oklch here
  // would quietly break anything that later wants `tint()` on a rail colour.
  it("stores colours in the house format", () => {
    for (const p of LEVELS) {
      expect(isTintableColor(PRIORITY_RAILS[p].color)).toBe(true);
    }
  });

  it("labels every level for screen readers", () => {
    for (const p of LEVELS) {
      expect(PRIORITY_RAILS[p].label).toMatch(/^Priority \d/);
    }
  });
});

describe("byPriorityThenPosition", () => {
  const card = (id: string, priority: Priority | null, position: string) =>
    ({ id, priority, position }) as Todo;

  it("ranks unprioritised last, not first", () => {
    // Undecided work belongs below decided work.
    expect(priorityRank(null)).toBe(5);
    expect(priorityRank(4)).toBeLessThan(priorityRank(null));
  });

  it("sorts P1 → P4, then unprioritised", () => {
    const sorted = [
      card("none", null, "a0"),
      card("p4", 4, "a0"),
      card("p1", 1, "a0"),
      card("p2", 2, "a0"),
    ]
      .sort(byPriorityThenPosition)
      .map((t) => t.id);
    expect(sorted).toEqual(["p1", "p2", "p4", "none"]);
  });

  /*
    The reason the `byPosition` fallback cannot be trimmed on stability grounds:
    Array.sort is stable, but the insertion order it would preserve is the store's,
    which is arbitrary. Two inputs holding the same cards in different orders must
    produce the same output.
  */
  it("is deterministic regardless of input order", () => {
    const a = [card("x", 2, "a1"), card("y", 2, "a0")].sort(byPriorityThenPosition);
    const b = [card("y", 2, "a0"), card("x", 2, "a1")].sort(byPriorityThenPosition);
    expect(a.map((t) => t.id)).toEqual(["y", "x"]);
    expect(b.map((t) => t.id)).toEqual(a.map((t) => t.id));
  });

  it("orders two unprioritised cards by position too", () => {
    const sorted = [card("x", null, "a1"), card("y", null, "a0")]
      .sort(byPriorityThenPosition)
      .map((t) => t.id);
    expect(sorted).toEqual(["y", "x"]);
  });
});
