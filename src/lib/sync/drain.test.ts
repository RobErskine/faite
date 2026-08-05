import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "@/lib/schema";
import { planDrain } from "./drain";
import { encodeHlc, isHlc } from "./hlc-core";

const NODE = "device-a";

function entry(overrides: Partial<OutboxEntry> & Pick<OutboxEntry, "hlc" | "createdAt">): OutboxEntry {
  return {
    id: `outbox-${Math.random()}`,
    kind: "todo",
    entityId: "todo-1",
    patch: { title: "x" },
    ...overrides,
  };
}

describe("planDrain", () => {
  it("routes settings entries to drop, everything else to batch", () => {
    const pending: OutboxEntry[] = [
      entry({ kind: "settings", hlc: encodeHlc({ phys: 1000, counter: 0, nodeId: NODE }), createdAt: "2026-08-04T00:00:00.000Z" }),
      entry({ hlc: encodeHlc({ phys: 1000, counter: 0, nodeId: NODE }), createdAt: "2026-08-04T00:00:00.000Z" }),
    ];

    const plan = planDrain(pending, NODE);

    expect(plan.drop).toHaveLength(1);
    expect(plan.drop[0].kind).toBe("settings");
    expect(plan.batch).toHaveLength(1);
    expect(plan.batch[0].kind).toBe("todo");
  });

  it("normalizes a legacy ISO stamp still sitting in the outbox on the fly", () => {
    const pending: OutboxEntry[] = [
      entry({ hlc: new Date(2026, 0, 1).toISOString(), createdAt: "2026-08-04T00:00:00.000Z" }),
    ];

    const plan = planDrain(pending, NODE);

    expect(isHlc(plan.batch[0].hlc)).toBe(true);
  });

  it("sorts ascending by hlc", () => {
    const pending: OutboxEntry[] = [
      entry({ id: "later", hlc: encodeHlc({ phys: 2000, counter: 0, nodeId: NODE }), createdAt: "2026-08-04T00:00:00.000Z" }),
      entry({ id: "earlier", hlc: encodeHlc({ phys: 1000, counter: 0, nodeId: NODE }), createdAt: "2026-08-04T00:00:00.000Z" }),
    ];

    const plan = planDrain(pending, NODE);

    expect(plan.batch.map((e) => e.id)).toEqual(["earlier", "later"]);
  });

  it("keeps a total order when normalized legacy stamps tie on hlc, via createdAt then id", () => {
    const pending: OutboxEntry[] = [
      entry({ id: "b", hlc: new Date(2026, 0, 1, 0, 0, 0, 0).toISOString(), createdAt: "2026-08-04T00:00:02.000Z" }),
      entry({ id: "a", hlc: new Date(2026, 0, 1, 0, 0, 0, 0).toISOString(), createdAt: "2026-08-04T00:00:01.000Z" }),
    ];

    const plan = planDrain(pending, NODE);

    // Both normalize to the same millisecond -> same hlc; createdAt breaks the tie.
    expect(plan.batch[0].hlc).toBe(plan.batch[1].hlc);
    expect(plan.batch.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
