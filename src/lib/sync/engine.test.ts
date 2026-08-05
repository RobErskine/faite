import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "@/lib/schema";
import type { ApplyPlan } from "./apply-plan";
import { createSyncRunner, runSyncCycle, type SyncStore } from "./engine";
import { encodeHlc } from "./hlc-core";
import { SyncAuthError, type SyncTransport } from "./transport";
import type { PullResponse, PushResponse } from "./wire";

const NODE_A = "device-a";

function outboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: `outbox-${Math.random()}`,
    kind: "todo",
    entityId: "todo-1",
    patch: { title: "x" },
    hlc: encodeHlc({ phys: 1000, counter: 0, nodeId: NODE_A }),
    createdAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function emptyPull(cursor: number): PullResponse {
  return { protocol: 1, changes: [], cursor, hasMore: false };
}

function fakeStore(overrides: Partial<SyncStore> = {}): SyncStore & { deletedIds: string[] } {
  const deletedIds: string[] = [];
  return {
    deletedIds,
    getPendingOutbox: async () => [],
    deleteOutboxEntries: async (ids) => {
      deletedIds.push(...ids);
    },
    applyPulledChanges: async (): Promise<ApplyPlan> => ({ writes: [], conflicts: [], skipped: [] }),
    getCursor: () => 0,
    setCursor: () => {},
    getNodeId: () => NODE_A,
    ...overrides,
  };
}

describe("runSyncCycle", () => {
  it("deletes only acked and rejected entries, not entries the response didn't mention", async () => {
    const entries = [outboxEntry({ id: "acked-1" }), outboxEntry({ id: "rejected-1" }), outboxEntry({ id: "survives-1" })];
    const store = fakeStore({ getPendingOutbox: async () => entries });
    const transport: SyncTransport = {
      push: async (): Promise<PushResponse> => ({
        acked: ["acked-1"],
        rejected: [{ id: "rejected-1", reason: "malformed-hlc" }],
        highestVersion: 1,
        conflicts: [],
      }),
      pull: async (cursor) => emptyPull(cursor),
    };

    await runSyncCycle(transport, store);

    expect(store.deletedIds.sort()).toEqual(["acked-1", "rejected-1"]);
    expect(store.deletedIds).not.toContain("survives-1");
  });

  it("writes the cursor only after applyPulledChanges resolves, and leaves it unchanged if apply throws", async () => {
    let cursor = 0;
    const store = fakeStore({
      getCursor: () => cursor,
      setCursor: (c) => {
        cursor = c;
      },
      applyPulledChanges: async () => {
        throw new Error("Dexie transaction failed");
      },
    });
    const transport: SyncTransport = {
      push: async () => ({ acked: [], rejected: [], highestVersion: 0, conflicts: [] }),
      pull: async () => ({
        protocol: 1,
        changes: [{ kind: "todo", entityId: "todo-1", patch: { title: "x" }, hlc: encodeHlc({ phys: 1, counter: 0, nodeId: "server" }) }],
        cursor: 99,
        hasMore: false,
      }),
    };

    await expect(runSyncCycle(transport, store)).rejects.toThrow("Dexie transaction failed");
    expect(cursor).toBe(0);
  });

  it("advances the cursor across a multi-page pull (hasMore loop)", async () => {
    let cursor = 0;
    const store = fakeStore({
      getCursor: () => cursor,
      setCursor: (c) => {
        cursor = c;
      },
    });
    let calls = 0;
    const transport: SyncTransport = {
      push: async () => ({ acked: [], rejected: [], highestVersion: 0, conflicts: [] }),
      pull: async () => {
        calls += 1;
        if (calls === 1) return { protocol: 1, changes: [], cursor: 10, hasMore: true };
        return { protocol: 1, changes: [], cursor: 20, hasMore: false };
      },
    };

    await runSyncCycle(transport, store);

    expect(calls).toBe(2);
    expect(cursor).toBe(20);
  });

  it("classifies a 401 as unauthenticated, not a generic error", async () => {
    const store = fakeStore({ getPendingOutbox: async () => [outboxEntry()] });
    const transport: SyncTransport = {
      push: async () => {
        throw new SyncAuthError();
      },
      pull: async (cursor) => emptyPull(cursor),
    };

    const { runSync } = createSyncRunner(transport, store);
    const outcome = await runSync();

    expect(outcome).toEqual({ status: "unauthenticated" });
  });
});

describe("createSyncRunner coalescing", () => {
  it("many triggers arriving while a cycle is in flight collapse into at most one follow-up cycle", async () => {
    const store = fakeStore();
    let pushCalls = 0;
    const transport: SyncTransport = {
      push: async () => {
        pushCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { acked: [], rejected: [], highestVersion: 0, conflicts: [] };
      },
      pull: async (cursor) => emptyPull(cursor),
    };
    const { runSync } = createSyncRunner(transport, store);

    // Five triggers fired back-to-back, synchronously, before the first
    // cycle's push has resolved.
    const results = await Promise.all([runSync(), runSync(), runSync(), runSync(), runSync()]);

    // Not 5 — every concurrent call shares the in-flight cycle or the single
    // queued follow-up, never starts its own round trip.
    expect(pushCalls).toBeLessThanOrEqual(2);
    for (const outcome of results) expect(outcome.status).toBe("ok");
  });

  it("a call after the previous cycle has fully settled starts a genuinely new round trip", async () => {
    const store = fakeStore({ getPendingOutbox: async () => [outboxEntry()] });
    let pushCalls = 0;
    const transport: SyncTransport = {
      push: async () => {
        pushCalls += 1;
        return { acked: [], rejected: [], highestVersion: 0, conflicts: [] };
      },
      pull: async (cursor) => emptyPull(cursor),
    };
    const { runSync } = createSyncRunner(transport, store);

    await runSync();
    await runSync();

    // Two SEQUENTIAL, fully-awaited calls each get their own round trip —
    // coalescing only collapses calls that overlap an in-flight cycle.
    expect(pushCalls).toBe(2);
  });
});
