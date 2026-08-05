import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { applyIncomingPatch } from "./apply-patch";

const NODE_A = "aaaa1111";
const NODE_B = "bbbb2222";

function hlc(phys: number, counter = 0, nodeId = NODE_A): string {
  return encodeHlc({ phys, counter, nodeId });
}

describe("applyIncomingPatch", () => {
  it("applies a field with no existing clock (never written before)", () => {
    const result = applyIncomingPatch({}, { title: "New" }, hlc(1000, 0, NODE_B));

    expect(result.apply).toEqual({ title: "New" });
    expect(result.clockUpdates).toEqual({ title: hlc(1000, 0, NODE_B) });
    expect(result.conflicts).toEqual([]);
  });

  it("two writers touching different fields both apply", () => {
    const existing = { title: hlc(1000, 0, NODE_A) };
    const result = applyIncomingPatch(existing, { done: true }, hlc(1000, 0, NODE_B));

    expect(result.apply).toEqual({ done: true });
    expect(result.conflicts).toEqual([]);
  });

  it("same field: a newer incoming HLC beats the stored clock", () => {
    const existing = { title: hlc(1000, 0, NODE_A) };
    const result = applyIncomingPatch(existing, { title: "Newer" }, hlc(2000, 0, NODE_B));

    expect(result.apply).toEqual({ title: "Newer" });
    expect(result.clockUpdates).toEqual({ title: hlc(2000, 0, NODE_B) });
    expect(result.conflicts).toEqual([]);
  });

  it("same field: an older incoming HLC loses and is reported as a conflict", () => {
    const existing = { title: hlc(5000, 0, NODE_A) };
    const result = applyIncomingPatch(existing, { title: "Stale" }, hlc(1000, 0, NODE_B));

    expect(result.apply).toEqual({});
    expect(result.clockUpdates).toEqual({});
    expect(result.conflicts).toEqual(["title"]);
  });

  it("falsy values survive", () => {
    const result = applyIncomingPatch(
      {},
      { done: false, priority: 0, notes: "" },
      hlc(1000, 0, NODE_B),
    );

    expect(result.apply).toEqual({ done: false, priority: 0, notes: "" });
  });

  it("never writes undefined into apply or clockUpdates", () => {
    const result = applyIncomingPatch({}, { title: "Kept", location: undefined }, hlc(1000, 0, NODE_B));

    expect(result.apply).toEqual({ title: "Kept" });
    expect(Object.hasOwn(result.apply, "location")).toBe(false);
    expect(Object.hasOwn(result.clockUpdates, "location")).toBe(false);
  });

  it("mixed patch: some fields win, some lose, independently", () => {
    const existing = { title: hlc(5000, 0, NODE_A), done: hlc(1000, 0, NODE_A) };
    const result = applyIncomingPatch(
      existing,
      { title: "Stale title", done: true },
      hlc(3000, 0, NODE_B),
    );

    expect(result.apply).toEqual({ done: true });
    expect(result.clockUpdates).toEqual({ done: hlc(3000, 0, NODE_B) });
    expect(result.conflicts).toEqual(["title"]);
  });
});
