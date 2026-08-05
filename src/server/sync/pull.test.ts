import { describe, expect, it } from "vitest";
import { encodeHlc } from "@/lib/sync/hlc-core";
import { FLOOR_HLC } from "@/lib/sync/wire";
import { mergePages, type KindPage } from "./pull";

const HLC = encodeHlc({ phys: 1000, counter: 0, nodeId: "server" });

describe("mergePages", () => {
  it("merges multiple kinds' pages into one page ordered by version", () => {
    const pages: KindPage[] = [
      { kind: "todo", rows: [{ id: "t1", version: 3, title: "c" }], exhausted: false },
      { kind: "list", rows: [{ id: "l1", version: 1, name: "a" }, { id: "l2", version: 2, name: "b" }], exhausted: false },
    ];

    const result = mergePages(pages, 0, 10, {});

    expect(result.changes.map((c) => c.entityId)).toEqual(["l1", "l2", "t1"]);
    expect(result.cursor).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it("caps to `limit` and reports hasMore when any kind's fetch came back full", () => {
    const pages: KindPage[] = [
      { kind: "todo", rows: [{ id: "t1", version: 1 }, { id: "t2", version: 2 }], exhausted: true },
    ];

    const result = mergePages(pages, 0, 2, {});

    expect(result.hasMore).toBe(true);
  });

  it("leaves the cursor unchanged when the page is empty", () => {
    const result = mergePages([{ kind: "todo", rows: [], exhausted: false }], 42, 10, {});
    expect(result.cursor).toBe(42);
    expect(result.changes).toEqual([]);
  });

  it("passes each row's field clocks through to changesFromRow, defaulting to FLOOR_HLC", () => {
    const pages: KindPage[] = [
      { kind: "todo", rows: [{ id: "t1", version: 1, title: "a", status: "open" }], exhausted: false },
    ];
    const fieldClocksByEntityId = { t1: { title: HLC } };

    const result = mergePages(pages, 0, 10, fieldClocksByEntityId);

    expect(result.changes).toContainEqual({ kind: "todo", entityId: "t1", patch: { title: "a" }, hlc: HLC });
    expect(result.changes).toContainEqual({ kind: "todo", entityId: "t1", patch: { status: "open" }, hlc: FLOOR_HLC });
  });
});
