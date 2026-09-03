import { describe, expect, it } from "vitest";
import {
  PRIORITY_RAILS,
  byPriorityThenPosition,
  priorityRail,
  priorityRank,
} from "./priority";
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
    The whole point of the rail is that thickness and form are two channels. If
    a future edit made two levels identical on width, opacity AND line style,
    the design would silently stop encoding anything — so the invariant is a
    test, not a comment.
  */
  it("never lets two levels share width, opacity and line style", () => {
    const keys = LEVELS.map((p) => {
      const rail = PRIORITY_RAILS[p];
      return `${rail.width}:${rail.opacity}:${rail.dotted}`;
    });
    expect(new Set(keys).size).toBe(LEVELS.length);
  });

  // Decision A (docs/DESIGN.md §7): the rail carries no hue, so red can mean
  // urgency alone. A `color` field creeping back in is the regression to catch.
  it("is achromatic — no level carries a colour", () => {
    for (const p of LEVELS) {
      expect(PRIORITY_RAILS[p]).not.toHaveProperty("color");
    }
  });

  it("steps down in weight from P1 to P4", () => {
    const weights = LEVELS.map((p) => PRIORITY_RAILS[p].width * PRIORITY_RAILS[p].opacity);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
    }
  });

  // The 1px pair shares a thickness; the dotted line is what tells them apart,
  // in every theme and for every colour-vision deficiency, because it is form.
  it("dots only the lowest level", () => {
    expect(LEVELS.map((p) => PRIORITY_RAILS[p].dotted)).toEqual([false, false, false, true]);
  });

  it("keeps every opacity legible", () => {
    for (const p of LEVELS) {
      expect(PRIORITY_RAILS[p].opacity).toBeGreaterThanOrEqual(0.5);
      expect(PRIORITY_RAILS[p].opacity).toBeLessThanOrEqual(1);
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
