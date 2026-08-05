import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import { DEFAULT_AVATAR_KIND } from "@/lib/profile";
import {
  archiveList,
  archiveTab,
  createList,
  createTab,
  createTodo,
  DEFAULT_TAB_ID,
  deleteList,
  deleteTab,
  ensureDefaultTab,
  repairDuplicateLists,
  seedIfEmpty,
  unarchiveList,
  unarchiveTab,
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

describe("deleteList", () => {
  it("reports the todos it reassigned, so one undo can put them back", async () => {
    await seedIfEmpty();
    const listId = await createList("Weekend");
    const todoId = await createTodo({ title: "Mow the lawn", listId });

    const result = await deleteList(listId);

    expect(result).toEqual({ listId, movedTodoIds: [todoId] });
    const backlog = (await getDb().lists.toArray()).find((l) => l.isBacklog)!;
    expect((await getDb().todos.get(todoId))?.listId).toBe(backlog.id);
  });

  it("returns null for Backlog, which cannot be deleted", async () => {
    await seedIfEmpty();
    const backlog = (await getDb().lists.toArray()).find((l) => l.isBacklog)!;
    expect(await deleteList(backlog.id)).toBeNull();
  });
});

describe("archiveList", () => {
  it("keeps the list's todos attached, unlike deleting it", async () => {
    await seedIfEmpty();
    const listId = await createList("Weekend");
    const todoId = await createTodo({ title: "Mow the lawn", listId });

    const archived = await archiveList(listId);

    expect(archived?.name).toBe("Weekend");
    expect((await getDb().lists.get(listId))?.archivedAt).toEqual(expect.any(String));
    // The whole point of archiving: restoring must return a full column, not an
    // empty one with its todos stranded in Backlog.
    expect((await getDb().todos.get(todoId))?.listId).toBe(listId);
  });

  it("returns null for Backlog, which has to stay on the board", async () => {
    await seedIfEmpty();
    const backlog = (await getDb().lists.toArray()).find((l) => l.isBacklog)!;

    expect(await archiveList(backlog.id)).toBeNull();
    expect((await getDb().lists.get(backlog.id))?.archivedAt).toBeNull();
  });

  it("returns null for a list that is already archived", async () => {
    // Otherwise a second archive would restamp archivedAt, and the undo entry
    // pushed beside it would restore the list to the wrong place in the archive.
    const listId = await createList("Weekend");
    await archiveList(listId);
    expect(await archiveList(listId)).toBeNull();
  });

  it("returns null for a deleted list", async () => {
    await seedIfEmpty();
    const listId = await createList("Weekend");
    await deleteList(listId);
    expect(await archiveList(listId)).toBeNull();
  });

  it("unarchives back onto the board with its todos", async () => {
    const listId = await createList("Weekend");
    const todoId = await createTodo({ title: "Mow the lawn", listId });
    await archiveList(listId);

    await unarchiveList(listId);

    expect((await getDb().lists.get(listId))?.archivedAt).toBeNull();
    expect((await getDb().todos.get(todoId))?.listId).toBe(listId);
  });

  it("archives a list written before the field existed", async () => {
    // Rows created by an earlier version have no `archivedAt` key at all, so
    // the guard has to test truthiness rather than compare against null.
    const listId = await createList("Weekend");
    const db = getDb();
    const legacy = (await db.lists.get(listId))!;
    delete (legacy as { archivedAt?: string | null }).archivedAt;
    await db.lists.put(legacy);

    expect(await archiveList(listId)).not.toBeNull();
    expect((await db.lists.get(listId))?.archivedAt).toEqual(expect.any(String));
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

describe("seeding tabs", () => {
  it("creates one default tab and puts every list but Backlog on it", async () => {
    await seedIfEmpty();
    const db = getDb();

    const tabs = await db.tabs.toArray();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(DEFAULT_TAB_ID);
    expect(tabs[0].isDefault).toBe(true);

    const lists = await db.lists.toArray();
    // Backlog is pinned into every tab, so it belongs to none of them.
    expect(lists.find((l) => l.isBacklog)?.tabId).toBeNull();
    expect(
      lists.filter((l) => !l.isBacklog).every((l) => l.tabId === DEFAULT_TAB_ID),
    ).toBe(true);
  });

  it("stays idempotent under the StrictMode double-invoke", async () => {
    await Promise.all([seedIfEmpty(), seedIfEmpty(), seedIfEmpty()]);
    expect(await getDb().tabs.count()).toBe(1);
  });

  it("points settings at the default tab", async () => {
    await seedIfEmpty();
    const settings = await getDb().settings.toArray();
    expect(settings[0].activeTabId).toBe(DEFAULT_TAB_ID);
  });

  it("seeds the default appearance and profile", async () => {
    await seedIfEmpty();
    const settings = await getDb().settings.toArray();
    expect(settings[0].theme).toBe(DEFAULT_THEME_MODE);
    expect(settings[0].avatarKind).toBe(DEFAULT_AVATAR_KIND);
    expect(settings[0].displayName).toBe("");
  });
});

describe("ensureDefaultTab", () => {
  it("backfills lists written before tabs existed", async () => {
    // The migration path that matters: rows from an earlier version have no
    // `tabId` key at all, so they match no tab and would vanish from the board.
    await seedIfEmpty();
    const db = getDb();
    const listId = await createList("Weekend");

    const legacy = (await db.lists.get(listId))!;
    delete (legacy as { tabId?: string | null }).tabId;
    await db.lists.put(legacy);

    expect(await ensureDefaultTab()).toBe(1);
    expect((await db.lists.get(listId))?.tabId).toBe(DEFAULT_TAB_ID);
  });

  it("leaves Backlog off every tab", async () => {
    // Null is Backlog's permanent "pinned everywhere" value, not a gap.
    await seedIfEmpty();
    const db = getDb();
    const backlog = (await db.lists.toArray()).find((l) => l.isBacklog)!;

    await ensureDefaultTab();

    expect((await db.lists.get(backlog.id))?.tabId).toBeNull();
  });

  it("creates the default tab for a database that predates tabs entirely", async () => {
    const db = getDb();
    await db.tabs.clear();

    await ensureDefaultTab();

    const tabs = await db.tabs.toArray();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].isDefault).toBe(true);
  });

  it("is a no-op once everything is on a tab", async () => {
    await seedIfEmpty();
    expect(await ensureDefaultTab()).toBe(0);
    expect(await getDb().tabs.count()).toBe(1);
  });
});

describe("archiveTab", () => {
  it("takes the tab's live lists with it", async () => {
    await seedIfEmpty();
    const db = getDb();
    const { tabId, listId: starterId } = await createTab("Work");
    const listId = await createList("Standups", {}, tabId);

    const archived = await archiveTab(tabId);

    // Both the starter list and the one added afterwards.
    expect(archived?.listIds.sort()).toEqual([starterId, listId].sort());
    // One shared timestamp is what makes the group restorable as a group.
    const tab = await db.tabs.get(tabId);
    expect((await db.lists.get(listId))?.archivedAt).toBe(tab?.archivedAt);
  });

  it("leaves a list archived earlier out of the group", async () => {
    // Otherwise restoring the tab would drag back a list the user filed on its
    // own, and undoing the archive would un-archive something it never touched.
    const { tabId } = await createTab("Work");
    const early = await createList("Old", {}, tabId);
    const withTab = await createList("Current", {}, tabId);
    await archiveList(early);

    const archived = await archiveTab(tabId);

    expect(archived?.listIds).toContain(withTab);
    expect(archived?.listIds).not.toContain(early);
  });

  it("returns null for the default tab, which has to stay on the strip", async () => {
    await seedIfEmpty();
    expect(await archiveTab(DEFAULT_TAB_ID)).toBeNull();
    expect((await getDb().tabs.get(DEFAULT_TAB_ID))?.archivedAt).toBeNull();
  });

  it("returns null for a tab that is already archived", async () => {
    const { tabId } = await createTab("Work");
    await archiveTab(tabId);
    expect(await archiveTab(tabId)).toBeNull();
  });
});

describe("unarchiveTab", () => {
  it("restores exactly the lists that went away with it", async () => {
    const db = getDb();
    const { tabId } = await createTab("Work");
    const early = await createList("Old", {}, tabId);
    const withTab = await createList("Current", {}, tabId);
    await archiveList(early);
    await archiveTab(tabId);

    const restored = await unarchiveTab(tabId);

    expect(restored?.listIds).toContain(withTab);
    expect(restored?.listIds).not.toContain(early);
    expect((await db.lists.get(withTab))?.archivedAt).toBeNull();
    // Filed on its own, so it stays filed.
    expect((await db.lists.get(early))?.archivedAt).toEqual(expect.any(String));
  });

  it("leaves a separately filed list alone even when the timestamps collide", async () => {
    /**
     * Regression. Group membership was first inferred from a shared
     * `archivedAt`, which held until two archives landed inside the same
     * millisecond — `now()` has millisecond resolution, and archiving a list
     * then immediately archiving its tab does exactly that. The list the user
     * had filed on its own came back with the tab.
     *
     * Forced deterministically here rather than relying on the race: `early`
     * is given the tab's exact archive instant with no group marker.
     */
    const db = getDb();
    const { tabId } = await createTab("Work");
    const withTab = await createList("Current", {}, tabId);
    const early = await createList("Old", {}, tabId);
    await archiveList(early);
    await archiveTab(tabId);

    const tab = (await db.tabs.get(tabId))!;
    await db.lists.update(early, {
      archivedAt: tab.archivedAt,
      archivedWithTabId: null,
    });

    const restored = await unarchiveTab(tabId);

    expect(restored?.listIds).toContain(withTab);
    expect(restored?.listIds).not.toContain(early);
    expect((await db.lists.get(early))?.archivedAt).toBe(tab.archivedAt);
  });

  it("does not restore a list that was already taken out of the archive", async () => {
    // Its marker is cleared on the way out, so the tab coming back later must
    // not re-file or double-restore it.
    const db = getDb();
    const { tabId, listId: starterId } = await createTab("Work");
    await archiveTab(tabId);
    await unarchiveList(starterId);

    const restored = await unarchiveTab(tabId);

    expect(restored?.listIds).not.toContain(starterId);
    expect((await db.lists.get(starterId))?.archivedAt).toBeNull();
  });

  it("returns null for a tab that is not archived", async () => {
    const { tabId } = await createTab("Work");
    expect(await unarchiveTab(tabId)).toBeNull();
  });
});

describe("deleteTab", () => {
  it("rehomes its lists to the default tab and reports them", async () => {
    await seedIfEmpty();
    const { tabId, listId: starterId } = await createTab("Work");
    const listId = await createList("Standups", {}, tabId);

    const result = await deleteTab(tabId);

    expect(result?.movedListIds.sort()).toEqual([starterId, listId].sort());
    expect((await getDb().lists.get(listId))?.tabId).toBe(DEFAULT_TAB_ID);
    expect((await getDb().lists.get(starterId))?.tabId).toBe(DEFAULT_TAB_ID);
  });

  it("returns null for the default tab, the destination lists fall back to", async () => {
    await seedIfEmpty();
    expect(await deleteTab(DEFAULT_TAB_ID)).toBeNull();
  });
});

describe("createTab", () => {
  it("appends at the end of the strip", async () => {
    await seedIfEmpty();
    const first = await createTab("Work");
    const second = await createTab("Trip");
    const db = getDb();

    const a = (await db.tabs.get(first.tabId))!;
    const b = (await db.tabs.get(second.tabId))!;
    expect(b.position > a.position).toBe(true);
    expect(a.isDefault).toBe(false);
  });

  it("gives the new tab a starter list so it is never an empty track", async () => {
    await seedIfEmpty();
    const { tabId, listId } = await createTab("Work");

    const list = (await getDb().lists.get(listId))!;
    expect(list.name).toBe("Work List");
    expect(list.tabId).toBe(tabId);
    expect(list.isBacklog).toBe(false);
  });

  it("puts the starter list only on the new tab", async () => {
    // A null tabId would pin it into every tab, which is Backlog's job alone.
    await seedIfEmpty();
    const { tabId, listId } = await createTab("Trip");

    const others = (await getDb().lists.toArray()).filter((l) => l.id !== listId);
    expect(others.some((l) => l.tabId === tabId)).toBe(false);
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
