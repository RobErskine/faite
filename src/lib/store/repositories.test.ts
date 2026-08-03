import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "./db";
import {
  createList,
  createTodo,
  deleteList,
  repairDuplicateLists,
  seedIfEmpty,
} from "./repositories";

beforeEach(async () => {
  await resetDbForTests();
});

describe("seedIfEmpty", () => {
  it("creates the default lists with Backlog first", async () => {
    await seedIfEmpty();
    const lists = await getDb().lists.toArray();
    expect(lists).toHaveLength(5);
    expect(lists.filter((l) => l.isBacklog)).toHaveLength(1);
  });

  it("is idempotent when called twice in sequence", async () => {
    await seedIfEmpty();
    await seedIfEmpty();
    expect(await getDb().lists.count()).toBe(5);
  });

  it("is idempotent when called concurrently", async () => {
    // Regression: React StrictMode double-invokes the bootstrap effect in dev.
    // With the emptiness check outside the transaction, both callers saw an
    // empty database and seeded, producing two of every default list.
    await Promise.all([seedIfEmpty(), seedIfEmpty(), seedIfEmpty()]);
    expect(await getDb().lists.count()).toBe(5);
  });

  it("does not reseed once a user has edited their lists", async () => {
    await seedIfEmpty();
    const backlog = (await getDb().lists.toArray()).find((l) => l.isBacklog)!;
    await deleteList(backlog.id); // no-op: Backlog is undeletable
    await seedIfEmpty();
    expect(await getDb().lists.count()).toBe(5);
  });
});

describe("repairDuplicateLists", () => {
  it("removes duplicates and rehomes their todos", async () => {
    await seedIfEmpty();
    const db = getDb();

    // Simulate the pre-fix state: a second "Grocery List" with a random id.
    const duplicateId = await createList("Grocery List");
    const todoId = await createTodo({ title: "Milk", listId: duplicateId });

    expect(await db.lists.count()).toBe(6);

    const removed = await repairDuplicateLists();
    expect(removed).toBe(1);
    expect(await db.lists.count()).toBe(5);

    // The todo survives, reassigned to the surviving list.
    const todo = await db.todos.get(todoId);
    const survivor = (await db.lists.toArray()).find(
      (l) => l.name === "Grocery List",
    )!;
    expect(todo?.listId).toBe(survivor.id);
    expect(survivor.id.startsWith("seed:")).toBe(true);
  });

  it("is a no-op when there are no duplicates", async () => {
    await seedIfEmpty();
    expect(await repairDuplicateLists()).toBe(0);
    expect(await getDb().lists.count()).toBe(5);
  });

  it("leaves distinctly named lists alone", async () => {
    await seedIfEmpty();
    await createList("Weekend");
    expect(await repairDuplicateLists()).toBe(0);
    expect(await getDb().lists.count()).toBe(6);
  });
});

describe("mutate writes to the outbox", () => {
  it("records a patch for every change", async () => {
    await seedIfEmpty();
    const db = getDb();
    await db.outbox.clear();

    const id = await createTodo({ title: "Write tests" });
    const entries = await db.outbox.toArray();

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("todo");
    expect(entries[0].entityId).toBe(id);
    expect(entries[0].hlc).toBeTruthy();
  });
});
