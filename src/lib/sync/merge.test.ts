import { describe, expect, it } from "vitest";
import { encodeHlc } from "./hlc";
import { mergeRecord } from "./merge";
import { FLOOR_HLC } from "./wire";
import type { OutboxEntry } from "@/lib/schema";

const NODE_A = "aaaa1111";
const NODE_B = "bbbb2222";
const TODO_ID = "todo-1";

function hlc(phys: number, counter = 0, nodeId = NODE_A): string {
  return encodeHlc({ phys, counter, nodeId });
}

function pendingEntry(overrides: Partial<OutboxEntry> & Pick<OutboxEntry, "patch" | "hlc">): OutboxEntry {
  return {
    id: `outbox-${Math.random()}`,
    kind: "todo",
    entityId: TODO_ID,
    createdAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeRecord", () => {
  it("two devices editing different fields of one todo — both survive", () => {
    // Local device unsyncedly edited `title`; remote device's change touches
    // `done`, a field local has never touched — it must apply cleanly.
    const local = { id: TODO_ID, title: "Local edit", done: false };
    const pending = [pendingEntry({ patch: { title: "Local edit" }, hlc: hlc(1000) })];
    const remote = { entityId: TODO_ID, patch: { done: true }, hlc: hlc(2000, 0, NODE_B) };

    const result = mergeRecord(local, pending, remote);

    expect(result.apply).toEqual({ done: true });
    expect(result.conflicts).toEqual([]);
    // The local title edit is untouched by this merge (caller leaves it as-is).
    expect(result.apply).not.toHaveProperty("title");
  });

  it("same field edited on both — newer HLC wins (remote newer)", () => {
    const local = { id: TODO_ID, title: "Local" };
    const pending = [pendingEntry({ patch: { title: "Local" }, hlc: hlc(1000) })];
    const remote = { entityId: TODO_ID, patch: { title: "Remote" }, hlc: hlc(2000, 0, NODE_B) };

    const result = mergeRecord(local, pending, remote);

    expect(result.apply).toEqual({ title: "Remote" });
    expect(result.conflicts).toEqual([]);
  });

  it("same field edited on both — newer HLC wins (local newer)", () => {
    const local = { id: TODO_ID, title: "Local" };
    const pending = [pendingEntry({ patch: { title: "Local" }, hlc: hlc(3000) })];
    const remote = { entityId: TODO_ID, patch: { title: "Remote" }, hlc: hlc(2000, 0, NODE_B) };

    const result = mergeRecord(local, pending, remote);

    expect(result.apply).toEqual({});
    expect(result.conflicts).toEqual(["title"]);
  });

  it("a remote change for a row that doesn't exist locally applies the whole row", () => {
    const remote = {
      entityId: TODO_ID,
      patch: { id: TODO_ID, title: "Brand new", done: false },
      hlc: hlc(1000, 0, NODE_B),
    };

    const result = mergeRecord(undefined, [], remote);

    expect(result.apply).toEqual({ id: TODO_ID, title: "Brand new", done: false });
    expect(result.conflicts).toEqual([]);
  });

  it("a remote change older than an unsynced local edit is a no-op + conflict", () => {
    const local = { id: TODO_ID, title: "Local, newer" };
    const pending = [pendingEntry({ patch: { title: "Local, newer" }, hlc: hlc(5000) })];
    const remote = { entityId: TODO_ID, patch: { title: "Remote, older" }, hlc: hlc(1000, 0, NODE_B) };

    const result = mergeRecord(local, pending, remote);

    expect(result.apply).toEqual({});
    expect(result.conflicts).toEqual(["title"]);
  });

  it("walks pending entries newest-first per field, not just the last entry in the array", () => {
    // Out-of-order array: an older entry for `title` appended after a newer one.
    const pending = [
      pendingEntry({ patch: { title: "Newest" }, hlc: hlc(5000) }),
      pendingEntry({ patch: { title: "Oldest" }, hlc: hlc(1000) }),
    ];
    const remote = { entityId: TODO_ID, patch: { title: "Remote" }, hlc: hlc(3000, 0, NODE_B) };

    const result = mergeRecord({ id: TODO_ID, title: "Newest" }, pending, remote);

    // Remote (3000) beats the newest local clock (5000)? No — 3000 < 5000, so local wins.
    expect(result.apply).toEqual({});
    expect(result.conflicts).toEqual(["title"]);
  });

  it("deletedAt is ordinary LWW: a delete can lose to a newer edit on another field's device (D3)", () => {
    const pending = [pendingEntry({ patch: { deletedAt: "2026-08-04T00:00:00.000Z" }, hlc: hlc(1000) })];
    const remote = { entityId: TODO_ID, patch: { deletedAt: null }, hlc: hlc(2000, 0, NODE_B) };

    const result = mergeRecord({ id: TODO_ID, deletedAt: null }, pending, remote);

    // Remote's un-delete is newer, so it wins outright — not a bug.
    expect(result.apply).toEqual({ deletedAt: null });
    expect(result.conflicts).toEqual([]);
  });

  it("deletedAt: an older remote delete loses to a newer local edit (D3, other direction)", () => {
    const pending = [pendingEntry({ patch: { title: "Renamed after delete" }, hlc: hlc(5000) })];
    const remote = { entityId: TODO_ID, patch: { deletedAt: "2026-08-04T00:00:00.000Z" }, hlc: hlc(1000, 0, NODE_B) };

    // `deletedAt` has no pending entry of its own, so it's synced and the
    // remote delete applies regardless of the unrelated `title` edit.
    const result = mergeRecord({ id: TODO_ID, title: "Renamed after delete", deletedAt: null }, pending, remote);

    expect(result.apply).toEqual({ deletedAt: "2026-08-04T00:00:00.000Z" });
    expect(result.conflicts).toEqual([]);
  });

  it("falsy values survive — false, 0, and empty string all apply", () => {
    const remote = {
      entityId: TODO_ID,
      patch: { done: false, priority: 0, notes: "" },
      hlc: hlc(1000, 0, NODE_B),
    };

    const result = mergeRecord({ id: TODO_ID }, [], remote);

    expect(result.apply).toEqual({ done: false, priority: 0, notes: "" });
  });

  it("never writes undefined into apply, even if a remote patch somehow carries it", () => {
    const remote = {
      entityId: TODO_ID,
      patch: { title: "Kept", location: undefined },
      hlc: hlc(1000, 0, NODE_B),
    };

    const result = mergeRecord({ id: TODO_ID }, [], remote);

    expect(result.apply).toEqual({ title: "Kept" });
    expect(Object.hasOwn(result.apply, "location")).toBe(false);
  });

  it("ignores pending entries for other entities", () => {
    const pending = [
      pendingEntry({ entityId: "other-todo", patch: { title: "Unrelated" }, hlc: hlc(9999) }),
    ];
    const remote = { entityId: TODO_ID, patch: { title: "Remote" }, hlc: hlc(1000, 0, NODE_B) };

    const result = mergeRecord({ id: TODO_ID, title: "Local" }, pending, remote);

    // No pending entry actually touches TODO_ID's title, so it's synced and remote wins.
    expect(result.apply).toEqual({ title: "Remote" });
    expect(result.conflicts).toEqual([]);
  });
});

describe("FLOOR_HLC — populate-only, never an overwrite", () => {
  it(
    "REGRESSION: a FLOOR_HLC change never overwrites a value the local row already has " +
      "(the live bug: a synthesized placeholder renamed a real list to \"Untitled\")",
    () => {
      const local = { id: TODO_ID, name: "Personal Lists" };
      const remote = { entityId: TODO_ID, patch: { name: "Untitled" }, hlc: FLOOR_HLC };

      const result = mergeRecord(local, [], remote);

      expect(result.apply).toEqual({});
      // Not a conflict either — there's no pending entry to re-push. A
      // FLOOR_HLC field the local row already holds is simply a no-op.
      expect(result.conflicts).toEqual([]);
    },
  );

  it("still populates a field the local row is genuinely missing", () => {
    const local = { id: TODO_ID, title: "Existing" };
    const remote = { entityId: TODO_ID, patch: { position: "a0" }, hlc: FLOOR_HLC };

    const result = mergeRecord(local, [], remote);

    expect(result.apply).toEqual({ position: "a0" });
  });

  it("populates a field whose local value is undefined (the pre-tabs tabId case)", () => {
    // `ensureDefaultTab`'s own comment: legacy rows read a field back
    // `undefined`, not `null` — Object.hasOwn would wrongly treat this as
    // "already has a value" and block the populate.
    const local = { id: TODO_ID, tabId: undefined };
    const remote = { entityId: TODO_ID, patch: { tabId: "seed:tab:my-lists" }, hlc: FLOOR_HLC };

    const result = mergeRecord(local, [], remote);

    expect(result.apply).toEqual({ tabId: "seed:tab:my-lists" });
  });

  it("does not overwrite a local null with a synthesized value — null is meaningful here", () => {
    // tabId: null means "pinned into every tab" (Backlog). A FLOOR_HLC
    // placeholder must not silently turn that into some other tab id.
    const local = { id: TODO_ID, tabId: null };
    const remote = { entityId: TODO_ID, patch: { tabId: "seed:tab:my-lists" }, hlc: FLOOR_HLC };

    const result = mergeRecord(local, [], remote);

    expect(result.apply).toEqual({});
  });

  it("applies in full when the local row does not exist — the hydrate path is unaffected", () => {
    const remote = {
      entityId: TODO_ID,
      patch: { name: "Untitled", position: "a0" },
      hlc: FLOOR_HLC,
    };

    const result = mergeRecord(undefined, [], remote);

    expect(result.apply).toEqual({ name: "Untitled", position: "a0" });
  });

  it(
    "ANTI-TEST: the lowest possible REAL hlc still beats a synced local value — " +
      "proves we special-cased the sentinel, not \"low clocks\" in general",
    () => {
      const local = { id: TODO_ID, name: "Personal Lists" };
      const lowestReal = encodeHlc({ phys: 0, counter: 0, nodeId: "0" });
      const remote = { entityId: TODO_ID, patch: { name: "Renamed" }, hlc: lowestReal };

      const result = mergeRecord(local, [], remote);

      expect(result.apply).toEqual({ name: "Renamed" });
    },
  );
});
