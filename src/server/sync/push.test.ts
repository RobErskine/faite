import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { SETTINGS_ENTITY_ID, type PushEntry } from "@/lib/sync/wire";
import { applyIncomingPatch } from "./apply-patch";
import { groupByEntity, resolveEntityPush, validateEntries } from "./push";

const NODE_A = "device-a";
const NODE_B = "device-b";

function hlc(phys: number, counter = 0, nodeId = NODE_A): string {
  return encodeHlc({ phys, counter, nodeId });
}

describe("validateEntries", () => {
  it("rejects a malformed hlc", () => {
    const entries: PushEntry[] = [
      { id: "e1", kind: "todo", entityId: "t1", patch: { title: "x" }, hlc: new Date().toISOString() },
    ];
    const { accepted, rejected } = validateEntries(entries);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ id: "e1", reason: "malformed-hlc" }]);
  });

  it("rejects an unknown kind", () => {
    const entries = [
      { id: "e1", kind: "bogus-kind", entityId: "t1", patch: { title: "x" }, hlc: hlc(1000) },
    ] as unknown as PushEntry[];
    const { rejected } = validateEntries(entries);
    expect(rejected).toEqual([{ id: "e1", reason: "unknown-kind" }]);
  });

  it("rejects a patch that sanitizes to empty (e.g. only server-owned keys)", () => {
    const entries: PushEntry[] = [
      { id: "e1", kind: "todo", entityId: "t1", patch: { version: 99, ownerId: "attacker" }, hlc: hlc(1000) },
    ];
    const { rejected } = validateEntries(entries);
    expect(rejected).toEqual([{ id: "e1", reason: "empty-patch" }]);
  });

  it("rejects a settings patch that sanitizes to empty (activeTabId only)", () => {
    const entries: PushEntry[] = [
      { id: "e1", kind: "settings", entityId: "local-user", patch: { activeTabId: "tab-1" }, hlc: hlc(1000) },
    ];
    const { rejected } = validateEntries(entries);
    expect(rejected).toEqual([{ id: "e1", reason: "empty-patch" }]);
  });

  it("overrides entityId to the shared sentinel for settings, regardless of what the client sent", () => {
    const entries: PushEntry[] = [
      { id: "e1", kind: "settings", entityId: "local-user", patch: { theme: "dark" }, hlc: hlc(1000) },
    ];
    const { accepted } = validateEntries(entries);
    expect(accepted).toEqual([
      { id: "e1", kind: "settings", entityId: SETTINGS_ENTITY_ID, hlc: hlc(1000), patch: { theme: "dark" } },
    ]);
  });

  it("does not touch entityId for non-settings kinds", () => {
    const entries: PushEntry[] = [{ id: "e1", kind: "todo", entityId: "todo-1", patch: { title: "x" }, hlc: hlc(1000) }];
    const { accepted } = validateEntries(entries);
    expect(accepted[0].entityId).toBe("todo-1");
  });

  it("accepts and sanitizes a valid entry, one bad entry doesn't affect a good one", () => {
    const entries: PushEntry[] = [
      { id: "bad", kind: "todo", entityId: "t1", patch: {}, hlc: "not-an-hlc" },
      { id: "good", kind: "todo", entityId: "t2", patch: { title: "x", version: 99 }, hlc: hlc(1000) },
    ];
    const { accepted, rejected } = validateEntries(entries);
    expect(rejected).toEqual([{ id: "bad", reason: "malformed-hlc" }]);
    expect(accepted).toEqual([{ id: "good", kind: "todo", entityId: "t2", hlc: hlc(1000), patch: { title: "x" } }]);
  });
});

describe("groupByEntity", () => {
  it("groups entries for the same entity and folds same-field collisions to the last write", () => {
    const entries = validateEntries([
      { id: "e1", kind: "todo", entityId: "t1", patch: { title: "First" }, hlc: hlc(1000) },
      { id: "e2", kind: "todo", entityId: "t1", patch: { title: "Second", status: "done" }, hlc: hlc(2000) },
    ]).accepted;

    const groups = groupByEntity(entries);

    expect(groups).toHaveLength(1);
    expect(groups[0].entityId).toBe("t1");
    // title's last write (Second@2000) and status (Second@2000) share an hlc,
    // so they land in one group — first's title write is superseded, not merged.
    expect(groups[0].fieldsByHlc).toEqual([{ hlc: hlc(2000), patch: { title: "Second", status: "done" } }]);
  });

  it("keeps distinct hlcs in separate groups", () => {
    const entries = validateEntries([
      { id: "e1", kind: "todo", entityId: "t1", patch: { title: "T" }, hlc: hlc(1000) },
      { id: "e2", kind: "todo", entityId: "t1", patch: { status: "done" }, hlc: hlc(2000) },
    ]).accepted;

    const groups = groupByEntity(entries);

    expect(groups[0].fieldsByHlc).toEqual([
      { hlc: hlc(1000), patch: { title: "T" } },
      { hlc: hlc(2000), patch: { status: "done" } },
    ]);
  });

  it("separates different entities into different groups, preserving order", () => {
    const entries = validateEntries([
      { id: "e1", kind: "todo", entityId: "t2", patch: { title: "Second entity" }, hlc: hlc(1000) },
      { id: "e2", kind: "todo", entityId: "t1", patch: { title: "First entity" }, hlc: hlc(2000) },
    ]).accepted;

    const groups = groupByEntity(entries);

    expect(groups.map((g) => g.entityId)).toEqual(["t2", "t1"]);
  });
});

describe("resolveEntityPush", () => {
  it("matches applyIncomingPatch for a single-hlc group", () => {
    const group = { kind: "todo" as const, entityId: "t1", fieldsByHlc: [{ hlc: hlc(2000, 0, NODE_B), patch: { title: "New" } }] };
    const existing = { title: hlc(1000, 0, NODE_A) };

    const result = resolveEntityPush(existing, group);
    const direct = applyIncomingPatch(existing, { title: "New" }, hlc(2000, 0, NODE_B));

    expect(result).toEqual(direct);
  });

  it("resolves each hlc group independently and merges the results", () => {
    const group = {
      kind: "todo" as const,
      entityId: "t1",
      fieldsByHlc: [
        { hlc: hlc(1000, 0, NODE_A), patch: { title: "Stale" } }, // loses
        { hlc: hlc(3000, 0, NODE_B), patch: { status: "done" } }, // wins (no existing clock)
      ],
    };
    const existing = { title: hlc(5000, 0, NODE_A) };

    const result = resolveEntityPush(existing, group);

    expect(result.apply).toEqual({ status: "done" });
    expect(result.conflicts).toEqual(["title"]);
    expect(result.clockUpdates).toEqual({ status: hlc(3000, 0, NODE_B) });
  });
});
