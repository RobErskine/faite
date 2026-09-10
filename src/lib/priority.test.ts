import { describe, expect, it } from "vitest";
import {
  PRIORITY_RAILS,
  byPriorityThenPosition,
  priorityRail,
  priorityRank,
  railBackgroundImage,
  railBorderStyle,
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
    The whole point of the rail is that thickness, weight and rhythm are three
    channels. If a future edit made two levels identical on all three, the
    design would silently stop encoding anything — so the invariant is a test,
    not a comment.
  */
  it("never lets two levels share width, opacity and rhythm", () => {
    const keys = LEVELS.map((p) => {
      const rail = PRIORITY_RAILS[p];
      return `${rail.width}:${rail.opacity}:${JSON.stringify(rail.dash)}`;
    });
    expect(new Set(keys).size).toBe(LEVELS.length);
  });

  /*
    Stronger than the above, and the reason the rhythms exist: a width ramp
    answers "which of these two is higher" but never "what is this one". Every
    level has to be identifiable with no neighbour beside it, which means the
    rhythm alone must be unique.
  */
  it("gives every level a rhythm no other level shares", () => {
    const rhythms = LEVELS.map((p) => JSON.stringify(PRIORITY_RAILS[p].dash));
    expect(new Set(rhythms).size).toBe(LEVELS.length);
  });

  it("breaks the line more as the level drops", () => {
    // Solid, then progressively more gap than mark — legible as decreasing
    // insistence before you know what the scale is.
    const inked = LEVELS.map((p) => {
      const { dash } = PRIORITY_RAILS[p];
      return dash ? dash.on / (dash.on + dash.off) : 1;
    });
    for (let i = 1; i < inked.length; i++) {
      expect(inked[i]).toBeLessThan(inked[i - 1]);
    }
  });

  it("keeps every rhythm visible at the rail's real height", () => {
    // ~27px on a board card. A period longer than a third of that shows one
    // mark and reads as solid; the encoding would be there and invisible.
    for (const p of LEVELS) {
      const { dash } = PRIORITY_RAILS[p];
      if (dash) expect(dash.on + dash.off).toBeLessThanOrEqual(9);
    }
  });

  // Decision A (docs/DESIGN.md §7): the rail carries no hue, so red can mean
  // urgency alone. A `color` field creeping back in is the regression to catch.
  it("is achromatic — no level carries a color", () => {
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

  // Only the top level is unbroken. Everything below it is told apart by form
  // rather than color, so it survives every color-vision deficiency and both
  // themes.
  it("leaves only the highest level solid", () => {
    expect(LEVELS.map((p) => PRIORITY_RAILS[p].dash === null)).toEqual([
      true,
      false,
      false,
      false,
    ]);
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

describe("railBackgroundImage", () => {
  it("is null for a solid rail, so the caller paints a flat color", () => {
    expect(railBackgroundImage(PRIORITY_RAILS[1])).toBeNull();
  });

  it("builds the rhythm's period from `on` and `on + off`", () => {
    // P4 is 2 on, 5 off — so ink to 2px, gap to 7px, repeat.
    expect(railBackgroundImage(PRIORITY_RAILS[4])).toBe(
      "repeating-linear-gradient(to bottom, var(--foreground) 0 2px, transparent 2px 7px)",
    );
  });
});

describe("railBorderStyle", () => {
  it("maps the four rhythms onto the three styles CSS has", () => {
    // P2 and P3 collide on `dashed` — knowingly. A browser scales its dash
    // length with the border width, and those two differ (2px against 1px),
    // so they still read apart. See the function's own comment.
    expect(LEVELS.map((p) => railBorderStyle(PRIORITY_RAILS[p]))).toEqual([
      "solid",
      "dashed",
      "dashed",
      "dotted",
    ]);
  });

  it("keeps the width difference that separates the two dashed levels", () => {
    expect(PRIORITY_RAILS[2].width).not.toBe(PRIORITY_RAILS[3].width);
  });
});
