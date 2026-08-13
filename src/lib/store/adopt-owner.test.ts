// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { adoptLocalData, resetLocalDataForNewOwner } from "./adopt-owner";
import { getBoundOwnerId } from "./owner";
import { createTodo, createList, LOCAL_OWNER_ID, seedIfEmpty } from "./repositories";

beforeEach(async () => {
  localStorage.clear();
  await resetDbForTests();
});

describe("adoptLocalData", () => {
  it("rewrites every LOCAL_OWNER_ID row to the signed-in user and logs it in the outbox", async () => {
    await seedIfEmpty();
    const todoId = await createTodo({ title: "Buy milk" });

    const result = await adoptLocalData("real-user-1");
    expect(result).toBe("adopted");

    const todo = await getDb().todos.get(todoId);
    expect(todo?.ownerId).toBe("real-user-1");

    const lists = await getDb().lists.toArray();
    expect(lists.every((l) => l.ownerId === "real-user-1")).toBe(true);

    const tabs = await getDb().tabs.toArray();
    expect(tabs.every((t) => t.ownerId === "real-user-1")).toBe(true);

    const outboxEntries = await getDb().outbox
      .filter((e) => e.entityId === todoId)
      .toArray();
    expect(outboxEntries.some((e) => e.patch.ownerId === "real-user-1")).toBe(true);

    expect(getBoundOwnerId()).toBe("real-user-1");
  });

  it(
    "REGRESSION: rewrites todoEvents rows too — the one table nothing but " +
      "data catches an omission on (EI-94)",
    async () => {
      await seedIfEmpty();
      const todoId = await createTodo({ title: "Buy milk" });

      await adoptLocalData("real-user-1");

      const events = await getDb().todoEvents.where("todoId").equals(todoId).toArray();
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.ownerId === "real-user-1")).toBe(true);
    },
  );

  it("leaves settings keyed to LOCAL_OWNER_ID", async () => {
    await seedIfEmpty();
    await adoptLocalData("real-user-1");

    const settings = await getDb().settings.get(LOCAL_OWNER_ID);
    expect(settings).toBeDefined();
    expect(settings?.ownerId).toBe(LOCAL_OWNER_ID);
  });

  it("does not touch rows that already belong to someone else", async () => {
    await seedIfEmpty();
    await adoptLocalData("real-user-1");
    const secondTodoId = await createTodo({ title: "Second, written after adoption" });

    // New writes after adoption already carry the real id via getCurrentOwnerId().
    const secondTodo = await getDb().todos.get(secondTodoId);
    expect(secondTodo?.ownerId).toBe("real-user-1");
  });

  it("is a no-op the second time the same user signs in", async () => {
    await seedIfEmpty();
    await adoptLocalData("real-user-1");
    const outboxCountAfterFirst = await getDb().outbox.count();

    const result = await adoptLocalData("real-user-1");

    expect(result).toBe("already-bound");
    expect(await getDb().outbox.count()).toBe(outboxCountAfterFirst);
  });

  it("refuses to adopt into a different user without a reset", async () => {
    await seedIfEmpty();
    await adoptLocalData("real-user-1");

    const result = await adoptLocalData("real-user-2");

    expect(result).toBe("different-user");
    const lists = await getDb().lists.toArray();
    expect(lists.every((l) => l.ownerId === "real-user-1")).toBe(true);
  });
});

describe("resetLocalDataForNewOwner", () => {
  it("wipes local data and the binding so the new owner can adopt cleanly", async () => {
    await seedIfEmpty();
    await createList("Side project");
    await createTodo({ title: "Buy milk" });
    await adoptLocalData("real-user-1");

    await resetLocalDataForNewOwner();

    expect(await getDb().lists.count()).toBe(0);
    expect(await getDb().todos.count()).toBe(0);
    expect(await getDb().todoEvents.count()).toBe(0);
    expect(await getDb().settings.count()).toBe(0);
    expect(await getDb().outbox.count()).toBe(0);
    expect(getBoundOwnerId()).toBeNull();

    // The new owner can now seed and adopt without hitting "different-user".
    await seedIfEmpty();
    const result = await adoptLocalData("real-user-2");
    expect(result).toBe("adopted");
  });
});
