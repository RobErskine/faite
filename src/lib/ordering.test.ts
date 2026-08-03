import { describe, expect, it } from "vitest";
import {
  byPosition,
  positionAtEnd,
  positionAtStart,
  positionBetween,
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
