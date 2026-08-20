import { describe, expect, it } from "vitest";
import {
  byPosition,
  positionAtEnd,
  positionAtStart,
  positionBetween,
  positionForDropOnItem,
  positionsForDropOnItem,
  positionForIndex,
  positionsBetween,
} from "./ordering";

describe("fractional ordering", () => {
  it("orders start before end", () => {
    const end = positionAtEnd(null);
    const start = positionAtStart(end);
    expect(start < end).toBe(true);
  });

  it("appends in ascending order", () => {
    const positions: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 10; i++) {
      last = positionAtEnd(last);
      positions.push(last);
    }
    expect([...positions].sort()).toEqual(positions);
  });

  it("inserts strictly between neighbours", () => {
    const a = positionAtEnd(null);
    const b = positionAtEnd(a);
    const mid = positionBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it("survives repeated insertion at the same spot", () => {
    // Dragging repeatedly into one gap is the pathological case for any
    // integer-based scheme; fractional keys just get longer.
    let a = positionAtEnd(null);
    const b = positionAtEnd(a);
    for (let i = 0; i < 50; i++) {
      const mid = positionBetween(a, b);
      expect(a < mid && mid < b).toBe(true);
      a = mid;
    }
  });

  it("generates n evenly spaced keys", () => {
    const keys = positionsBetween(null, null, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("positionForIndex", () => {
  const ordered = positionsBetween(null, null, 3).map((position) => ({ position }));

  it("places at the top", () => {
    expect(positionForIndex(ordered, 0) < ordered[0].position).toBe(true);
  });

  it("places at the bottom", () => {
    expect(positionForIndex(ordered, 3) > ordered[2].position).toBe(true);
  });

  it("places in the middle", () => {
    const p = positionForIndex(ordered, 1);
    expect(ordered[0].position < p && p < ordered[1].position).toBe(true);
  });

  it("clamps out-of-range indices", () => {
    expect(positionForIndex(ordered, -5) < ordered[0].position).toBe(true);
    expect(positionForIndex(ordered, 99) > ordered[2].position).toBe(true);
  });

  it("handles an empty column", () => {
    expect(typeof positionForIndex([], 0)).toBe("string");
  });
});

describe("positionForDropOnItem", () => {
  /**
   * A, B, C, D in a column. These tests are the regression for EI-191: the
   * insertion line renders ABOVE the hovered card, so a drop must land
   * strictly before it, whichever direction the card came from.
   */
  const column = () =>
    ["a", "b", "c", "d"].map((id, i) => ({ id, position: positionsBetween(null, null, 4)[i] }));

  const landsBetween = (position: string, before: string | null, after: string | null) =>
    (before === null || before < position) && (after === null || position < after);

  it("lands a card dragged DOWNWARD immediately above its target", () => {
    // The bug: dragging A onto C used to land it between C and D.
    const items = column();
    const position = positionForDropOnItem(items, "a", "c");
    expect(landsBetween(position, items[1].position, items[2].position)).toBe(true);
  });

  it("lands a card dragged UPWARD immediately above its target", () => {
    const items = column();
    const position = positionForDropOnItem(items, "d", "b");
    expect(landsBetween(position, items[0].position, items[1].position)).toBe(true);
  });

  it("matches positionForIndex when the dragged card is not a sibling", () => {
    // A cross-column drop: the filter is a no-op, so nothing about the
    // existing behaviour may change.
    const items = column();
    const position = positionForDropOnItem(items, "elsewhere", "c");
    expect(position).toBe(positionForIndex(items, 2));
  });

  it("appends to the end when no card was hovered", () => {
    const items = column();
    const position = positionForDropOnItem(items, "elsewhere", null);
    expect(position > items[3].position).toBe(true);
  });

  it("appends when the dragged card is hovering itself", () => {
    // Unreachable via collision detection, which filters the active id out.
    // Asserted so the fallback can never silently become "index 0".
    const items = column();
    const position = positionForDropOnItem(items, "a", "a");
    expect(position > items[3].position).toBe(true);
  });

  it("drops into the first slot of a column it is leaving the top of", () => {
    const items = column();
    const position = positionForDropOnItem(items, "c", "a");
    expect(position < items[0].position).toBe(true);
  });

  it("handles a column holding only the dragged card", () => {
    const items = column().slice(0, 1);
    expect(typeof positionForDropOnItem(items, "a", null)).toBe("string");
  });
});

describe("positionsForDropOnItem", () => {
  const column = () =>
    ["a", "b", "c", "d"].map((id, i) => ({ id, position: positionsBetween(null, null, 4)[i] }));

  it("agrees with the single-card path at count 1", () => {
    // Required, not incidental: a one-card selection must land exactly where
    // a plain drag of that card would.
    const items = column();
    const [multi] = positionsForDropOnItem(items, new Set(["a"]), "c", 1);
    expect(multi).toBe(positionForDropOnItem(items, "a", "c"));
  });

  it("returns strictly ascending keys inside the target gap", () => {
    const items = column();
    const out = positionsForDropOnItem(items, new Set(["a"]), "c", 3);
    expect(out).toHaveLength(3);
    expect([...out].sort()).toEqual(out);
    expect(items[1].position < out[0]).toBe(true);
    expect(out[2] < items[2].position).toBe(true);
  });

  it("excludes every mover from the neighbour list, not just the hovered one", () => {
    // With b and c both moving, a run dropped on d must not be interleaved
    // with cards that are about to leave from between them.
    const items = column();
    const out = positionsForDropOnItem(items, new Set(["b", "c"]), "d", 2);
    expect(items[0].position < out[0]).toBe(true);
    expect(out[1] < items[3].position).toBe(true);
  });

  it("appends past the end when no card was hovered", () => {
    const items = column();
    const out = positionsForDropOnItem(items, new Set(["elsewhere"]), null, 2);
    expect(items[3].position < out[0]).toBe(true);
    expect(out[0] < out[1]).toBe(true);
  });

  it("lands above the first card when the top is the target", () => {
    const items = column();
    const out = positionsForDropOnItem(items, new Set(["d"]), "a", 2);
    expect(out[1] < items[0].position).toBe(true);
  });

  it("handles a column where every card is moving", () => {
    const items = column();
    const out = positionsForDropOnItem(items, new Set(["a", "b", "c", "d"]), null, 4);
    expect(out).toHaveLength(4);
    expect([...out].sort()).toEqual(out);
  });

  it("returns nothing for a count of zero", () => {
    expect(positionsForDropOnItem(column(), new Set(), null, 0)).toEqual([]);
  });
});

describe("concurrent reorder convergence", () => {
  it("two offline devices moving different items do not collide", () => {
    // The P3 merge is field-level LWW, so the only requirement is that the two
    // devices never generate the SAME key for different items.
    const base = positionsBetween(null, null, 4).map((position, i) => ({
      id: `item-${i}`,
      position,
    }));

    // Device A moves item-3 to the top.
    const aWithout = base.filter((i) => i.id !== "item-3").sort(byPosition);
    const aPosition = positionForIndex(aWithout, 0);

    // Device B independently moves item-0 to the bottom.
    const bWithout = base.filter((i) => i.id !== "item-0").sort(byPosition);
    const bPosition = positionForIndex(bWithout, bWithout.length);

    expect(aPosition).not.toBe(bPosition);

    // Merged, every position is still distinct and totally ordered.
    const merged = [
      { id: "item-1", position: base[1].position },
      { id: "item-2", position: base[2].position },
      { id: "item-3", position: aPosition },
      { id: "item-0", position: bPosition },
    ].sort(byPosition);

    const positions = merged.map((m) => m.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(merged[0].id).toBe("item-3");
    expect(merged[merged.length - 1].id).toBe("item-0");
  });
});
