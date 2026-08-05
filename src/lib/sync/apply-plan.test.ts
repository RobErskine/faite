import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "@/lib/schema";
import { planApply } from "./apply-plan";
import { encodeHlc } from "./hlc-core";
import type { WireChange } from "./wire";

const CTX = { ownerId: "user-1", now: "2026-08-05T00:00:00.000Z" };
const NODE_B = "device-b";

function hlc(phys: number, counter = 0, nodeId = NODE_B): string {
  return encodeHlc({ phys, counter, nodeId });
}

describe("planApply", () => {
  it("a remote change for an unknown entity produces a `put` with a schema-valid hydrated row", () => {
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "New", position: "a0" }, hlc: hlc(1000) },
    ];
    const locals = new Map([["todo-1", undefined]]);

    const plan = planApply(changes, [], locals, CTX);

    expect(plan.writes).toEqual([
      {
        op: "put",
        kind: "todo",
        entityId: "todo-1",
        row: expect.objectContaining({ id: "todo-1", ownerId: "user-1", title: "New" }),
      },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("an existing local row gets an `update`, not a `put`", () => {
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "Remote" }, hlc: hlc(1000) },
    ];
    const locals = new Map([["todo-1", { id: "todo-1", title: "Local" }]]);

    const plan = planApply(changes, [], locals, CTX);

    expect(plan.writes).toEqual([{ op: "update", kind: "todo", entityId: "todo-1", changes: { title: "Remote" } }]);
  });

  it("never emits an undefined value in any write payload", () => {
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "x", location: undefined }, hlc: hlc(1000) },
    ];
    const locals = new Map([["todo-1", { id: "todo-1" }]]);

    const plan = planApply(changes, [], locals, CTX);

    const write = plan.writes[0];
    const values = write.op === "put" ? Object.values(write.row) : Object.values(write.changes);
    for (const value of values) expect(value).not.toBeUndefined();
  });

  it("updatedAt is never synthesized locally — only ever taken from the remote patch", () => {
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "x" }, hlc: hlc(1000) },
    ];
    const locals = new Map([["todo-1", { id: "todo-1" }]]);

    const plan = planApply(changes, [], locals, CTX);

    const write = plan.writes[0];
    expect(write.op === "update" && write.changes).not.toHaveProperty("updatedAt");
  });

  it("a change where every field loses produces no write at all, not an empty update", () => {
    const pending: OutboxEntry[] = [
      {
        id: "outbox-1",
        kind: "todo",
        entityId: "todo-1",
        patch: { title: "Local, newer" },
        hlc: hlc(5000, 0, "device-a"),
        createdAt: "2026-08-04T00:00:00.000Z",
      },
    ];
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "Remote, older" }, hlc: hlc(1000) },
    ];
    const locals = new Map([["todo-1", { id: "todo-1", title: "Local, newer" }]]);

    const plan = planApply(changes, pending, locals, CTX);

    expect(plan.writes).toEqual([]);
    expect(plan.conflicts).toEqual([{ entityId: "todo-1", fields: ["title"] }]);
  });

  it("groups multiple WireChanges for the same entity into one write", () => {
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "T" }, hlc: hlc(1000) },
      { kind: "todo", entityId: "todo-1", patch: { status: "done" }, hlc: hlc(2000) },
    ];
    const locals = new Map([["todo-1", { id: "todo-1" }]]);

    const plan = planApply(changes, [], locals, CTX);

    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toEqual({
      op: "update",
      kind: "todo",
      entityId: "todo-1",
      changes: { title: "T", status: "done" },
    });
  });

  it("strips id from an update's changes, defensively", () => {
    const changes: WireChange[] = [
      // id shouldn't appear on the wire at all, but guard the Dexie trap anyway.
      { kind: "todo", entityId: "todo-1", patch: { id: "todo-1", title: "x" }, hlc: hlc(1000) },
    ];
    const locals = new Map([["todo-1", { id: "todo-1" }]]);

    const plan = planApply(changes, [], locals, CTX);

    const write = plan.writes[0];
    expect(write.op === "update" && write.changes).not.toHaveProperty("id");
  });
});
