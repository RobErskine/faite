import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { todoSchema } from "@/lib/schema";
import type { WireChange } from "@/lib/sync/wire";
import { applyPulledChanges } from "./apply-remote";
import { getDb, resetDbForTests } from "./db";
import { create, now } from "./mutate";

beforeEach(async () => {
  await resetDbForTests();
});

const NODE_B = "device-b";

function hlc(phys: number, counter = 0, nodeId = NODE_B): string {
  return encodeHlc({ phys, counter, nodeId });
}

describe("applyPulledChanges", () => {
  it("ANTI-ECHO: leaves the outbox count unchanged", async () => {
    const before = await getDb().outbox.count();

    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "Remote todo", position: "a0" }, hlc: hlc(1000) },
    ];
    await applyPulledChanges(changes);

    expect(await getDb().outbox.count()).toBe(before);
  });

  it("a remote create lands as a readable row (the Dexie update()-on-missing-key trap)", async () => {
    const changes: WireChange[] = [
      { kind: "todo", entityId: "todo-1", patch: { title: "Remote todo", position: "a0" }, hlc: hlc(1000) },
    ];

    const plan = await applyPulledChanges(changes);

    expect(plan.writes).toEqual([expect.objectContaining({ op: "put", entityId: "todo-1" })]);
    const row = await getDb().todos.get("todo-1");
    expect(row?.title).toBe("Remote todo");
  });

  it("updates an existing local row without touching fields the remote change didn't mention", async () => {
    // Added directly (not via `create()`) so the row has no pending outbox
    // history — i.e. it's already fully synced, isolating this case from
    // "a local unsynced edit beats an older remote change" below.
    const id = "todo-1";
    await getDb().todos.add(
      todoSchema.parse({
        id,
        ownerId: "local-user",
        title: "Original",
        status: "open",
        position: "a0",
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    const changes: WireChange[] = [{ kind: "todo", entityId: id, patch: { status: "done" }, hlc: hlc(1000) }];
    await applyPulledChanges(changes);

    const row = await getDb().todos.get(id);
    expect(row?.status).toBe("done");
    expect(row?.title).toBe("Original");
  });

  it("a local unsynced edit beats an older remote change for the same field", async () => {
    const id = await create("todo", {
      id: "todo-1",
      ownerId: "local-user",
      title: "Original",
      status: "open",
      position: "a0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    });
    // `create`'s own outbox entry (the full-row patch) is the "local unsynced
    // edit" here — nothing has acked it, so it's still pending.
    const changes: WireChange[] = [
      { kind: "todo", entityId: id, patch: { title: "Stale remote title" }, hlc: hlc(1) },
    ];

    const plan = await applyPulledChanges(changes);

    const row = await getDb().todos.get(id);
    expect(row?.title).toBe("Original");
    expect(plan.conflicts).toEqual([{ entityId: id, fields: ["title"] }]);
  });
});
