// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { FaiteDatabase } from "./db";

describe("Dexie version 9 upgrade (EI-402)", () => {
  it("backfills assigneeId, doneCriteria and access on a to-do written before assignees", async () => {
    // A v8-shaped database: the to-do has none of the three new fields.
    const old = new Dexie("faite");
    old.version(8).stores({
      todos:
        "id, listId, projectId, scheduledDate, status, position, deletedAt, recurrenceParentId, placeId",
    });
    await old.open();
    await old.table("todos").put({ id: "legacy", title: "Old row", listId: "l1" });
    old.close();

    const db = new FaiteDatabase();
    const row = await db.todos.get("legacy");
    expect(row?.assigneeId).toBeNull();
    expect(row?.doneCriteria).toEqual([]);
    expect(row?.access).toBeNull();
    db.close();
  });
});
