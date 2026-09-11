import { describe, expect, it } from "vitest";
import {
  PRIORITY_RAILS,
  RAIL_RHYTHMS,
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

  it("resolves every level to its line style and width", () => {
    expect(LEVELS.map((p) => priorityRail(p)?.style)).toEqual([
      "double",
      "solid",
      "dashed",
      "dotted",
    ]);
    expect(LEVELS.map((p) => priorityRail(p)?.width)).toEqual([5, 3, 2, 2]);
  });
});

describe("the encoding", () => {
  /*
    Four levels, four line styles, and every level identifiable ALONE. A width
    ramp answers "which of these two is higher" but never "what is this one";
    the line style is what does. If two levels ever shared a style, the one
    thing this design exists to guarantee would silently stop being true.
  */
  it("gives every level a line style no other level shares", () => {
    const styles = LEVELS.map((p) => PRIORITY_RAILS[p].style);
    expect(new Set(styles).size).toBe(LEVELS.length);
  });

  it("uses exactly CSS's four line styles, in order of insistence", () => {
    // Mapping onto `border-style` 1:1 is the point: the border surfaces (drag
    // chip, sheet tab) draw these exactly rather than approximating.
    expect(LEVELS.map((p) => PRIORITY_RAILS[p].style)).toEqual([
      "double",
      "solid",
      "dashed",
      "dotted",
    ]);
  });

  it("gives double enough width to be two strokes and a gap", () => {
    // Below 3px there is no room for a gap at all, and a "double" rail renders
    // as a solid one — present in the table, invisible on screen.
    for (const p of LEVELS) {
      if (PRIORITY_RAILS[p].style === "double") {
        expect(PRIORITY_RAILS[p].width).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("never widens as the level drops", () => {
    const widths = LEVELS.map((p) => PRIORITY_RAILS[p].width);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
    }
  });

  it("keeps every dashed and dotted rhythm visible at a card rail's height", () => {
    // ~27px on a board card. A period over 9px lands two marks and reads as
    // solid. This caught a 12px dash once already.
    for (const rhythm of Object.values(RAIL_RHYTHMS)) {
      expect(rhythm.on + rhythm.off).toBeLessThanOrEqual(9);
    }
  });

  it("makes dotted's marks shorter than dashed's, or the two would blur", () => {
    expect(RAIL_RHYTHMS.dotted.on).toBeLessThan(RAIL_RHYTHMS.dashed.on);
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
  it("is null for solid, so the caller paints a flat color", () => {
    expect(railBackgroundImage(PRIORITY_RAILS[2])).toBeNull();
  });

  it("draws double ACROSS the width: two whole-pixel strokes and a gap", () => {
    // 5px -> 2 / 1 / 2. Whole pixels, so the strokes stay sharp.
    expect(railBackgroundImage(PRIORITY_RAILS[1])).toBe(
      "linear-gradient(to right, var(--foreground) 0 2px, transparent 2px 3px, var(--foreground) 3px)",
    );
  });

  it("draws dashed and dotted DOWN the length, repeating", () => {
    expect(railBackgroundImage(PRIORITY_RAILS[3])).toBe(
      "repeating-linear-gradient(to bottom, var(--foreground) 0 6px, transparent 6px 9px)",
    );
    expect(railBackgroundImage(PRIORITY_RAILS[4])).toBe(
      "repeating-linear-gradient(to bottom, var(--foreground) 0 2px, transparent 2px 5px)",
    );
  });
});

describe("railBorderStyle", () => {
  it("passes the style straight through — exact, not approximated", () => {
    // It used to have to squeeze four rhythms into three styles, landing P2
    // and P3 on the same one. Four styles for four levels means it no longer
    // translates anything.
    for (const p of LEVELS) {
      expect(railBorderStyle(PRIORITY_RAILS[p])).toBe(PRIORITY_RAILS[p].style);
    }
  });
});
