import { describe, expect, it } from "vitest";
import { encodeHlc } from "./hlc-core";
import { mergeRecord } from "./merge";
import { changesFromRow, FLOOR_HLC, SERVER_ONLY_FIELDS } from "./wire";
import type { OutboxEntry } from "@/lib/schema";

const NODE_A = "aaaa1111";
const NODE_B = "bbbb2222";
const TODO_ID = "todo-1";

function hlc(phys: number, counter = 0, nodeId = NODE_A): string {
  return encodeHlc({ phys, counter, nodeId });
}

describe("changesFromRow", () => {
  it("collapses fields sharing an hlc into one change", () => {
    const row = { title: "A", status: "done" };
    const clocks = { title: hlc(1000), status: hlc(1000) };

    const changes = changesFromRow("todo", TODO_ID, row, clocks);

    expect(changes).toEqual([
      { kind: "todo", entityId: TODO_ID, patch: { title: "A", status: "done" }, hlc: hlc(1000) },
    ]);
  });

  it("splits fields with distinct hlcs into distinct changes", () => {
    const row = { title: "A", status: "done" };
    const clocks = { title: hlc(1000), status: hlc(2000) };

    const changes = changesFromRow("todo", TODO_ID, row, clocks);

    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual({ kind: "todo", entityId: TODO_ID, patch: { title: "A" }, hlc: hlc(1000) });
    expect(changes).toContainEqual({ kind: "todo", entityId: TODO_ID, patch: { status: "done" }, hlc: hlc(2000) });
  });

  it("groups columns with no clock under FLOOR_HLC rather than omitting them", () => {
    const row = { title: "A", position: "a0" };
    const clocks = { title: hlc(1000) };

    const changes = changesFromRow("todo", TODO_ID, row, clocks);

    expect(changes).toContainEqual({ kind: "todo", entityId: TODO_ID, patch: { position: "a0" }, hlc: FLOOR_HLC });
  });

  it("never emits version, id, or ownerId", () => {
    const row = { id: TODO_ID, ownerId: "user-1", version: 5, title: "A" };
    const clocks = { title: hlc(1000) };

    const changes = changesFromRow("todo", TODO_ID, row, clocks);

    for (const change of changes) {
      for (const field of Object.keys(change.patch)) {
        expect(SERVER_ONLY_FIELDS.has(field)).toBe(false);
      }
    }
  });

  it(
    "ANTI-TEST: grouped-by-distinct-hlc preserves a newer local pending edit; " +
      "row-max encoding would silently clobber it",
    () => {
      // Server holds title@old (device B, stale) and status@new (device B).
      // Device A has a pending unsynced title edit newer than title@old but
      // older than status@new.
      const row = { title: "B's old title", status: "done" };
      const clocks = { title: hlc(1000, 0, NODE_B), status: hlc(3000, 0, NODE_B) };
      const pending: OutboxEntry[] = [
        {
          id: "outbox-1",
          kind: "todo",
          entityId: TODO_ID,
          patch: { title: "A's newer title" },
          hlc: hlc(2000, 0, NODE_A),
          createdAt: "2026-08-04T00:00:00.000Z",
        },
      ];
      const local = { id: TODO_ID, title: "A's newer title", status: "open" };

      // (a) The real, grouped encoding: two changes, one per distinct hlc.
      const grouped = changesFromRow("todo", TODO_ID, row, clocks);
      let apply: Record<string, unknown> = {};
      let conflicts: string[] = [];
      for (const change of grouped) {
        const result = mergeRecord(local, pending, change);
        apply = { ...apply, ...result.apply };
        conflicts = [...conflicts, ...result.conflicts];
      }
      expect(conflicts).toContain("title");
      expect(apply).not.toHaveProperty("title");
      expect(apply).toEqual({ status: "done" });

      // (b) The rejected alternative: one change at the row's max hlc.
      const rowMaxChange = { kind: "todo" as const, entityId: TODO_ID, patch: row, hlc: hlc(3000, 0, NODE_B) };
      const rowMaxResult = mergeRecord(local, pending, rowMaxChange);
      // Clobbers A's newer title with B's stale one — this is why row-max is wrong.
      expect(rowMaxResult.apply.title).toBe("B's old title");
    },
  );

  it(
    "REGRESSION: never emits activeTabId for settings, even though it's a real, clockless column " +
      "that `SELECT *` naturally includes",
    () => {
      // A live smoke test caught this: activeTabId always exists in a real
      // settings row and is never written server-side, so with no filter it
      // rides along as `null` under FLOOR_HLC on every pull — and once a
      // device's local pending edit for it clears, that `null` wins the
      // merge outright and silently resets which tab is showing.
      const row = { theme: "dark", activeTabId: null };
      const clocks = { theme: hlc(1000) };

      const changes = changesFromRow("settings", "settings", row, clocks);

      for (const change of changes) {
        expect(Object.hasOwn(change.patch, "activeTabId")).toBe(false);
      }
    },
  );
});
