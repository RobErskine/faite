import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import { DEFAULT_AVATAR_KIND } from "@/lib/profile";
import { SEED_HLC } from "@/lib/sync/wire";
import { defaultRule, occurrenceId, parseRule } from "@/lib/recurrence";
import {
  archiveList,
  archiveTab,
  createList,
  createPlace,
  createSeriesFromTodo,
  createTab,
  createTodo,
  dayGroupPatch,
  DEFAULT_TAB_ID,
  deleteList,
  deletePlace,
  deleteTab,
  ensureDefaultTab,
  listPatch,
  materializeOccurrence,
  schedulePatch,
  seedIfEmpty,
  setSeriesUntil,
  unarchiveList,
  unarchiveTab,
  updatePlace,
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

  it(
    "REGRESSION: writes a real outbox entry at SEED_HLC for every seeded row " +
      "(5 lists + 1 tab + 1 settings) — the root cause of the live data-loss " +
      "incident was these rows having NO outbox entry at all",
    async () => {
      await seedIfEmpty();
      const entries = await getDb().outbox.toArray();

      expect(entries).toHaveLength(7);
      expect(entries.every((e) => e.hlc === SEED_HLC)).toBe(true);

      const kinds = entries.map((e) => e.kind).sort();
      expect(kinds).toEqual(["list", "list", "list", "list", "list", "settings", "tab"]);

      // Full-row patches, not the {ownerId, updatedAt} sliver adoptLocalData
      // used to be these rows' first-ever outbox entry.
      const tabEntry = entries.find((e) => e.kind === "tab")!;
      expect(tabEntry.patch.name).toBe("My Lists");
      const settingsEntry = entries.find((e) => e.kind === "settings")!;
      expect(settingsEntry.patch.fontPairing).toBeDefined();
    },
  );

  it("seeding twice does not duplicate outbox entries (guarded by the same emptiness check)", async () => {
    await seedIfEmpty();
    await seedIfEmpty();
    expect(await getDb().outbox.count()).toBe(7);
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

describe("no more duplicate-list repair", () => {
  it(
    "REGRESSION: two lists sharing a name (an ordinary, legal state — e.g. the same name on " +
      "two different tabs) both survive a bootstrap, with their own todos intact — " +
      "repairDuplicateLists used to hard-delete one of these with no tombstone",
    async () => {
      await seedIfEmpty();
      const db = getDb();

      const secondId = await createList("Grocery List");
      const todoId = await createTodo({ title: "Milk", listId: secondId });

      expect(await db.lists.count()).toBe(6);

      await ensureDefaultTab();

      expect(await db.lists.count()).toBe(6);
      expect((await db.lists.get(secondId))?.deletedAt).toBeFalsy();
      expect((await db.todos.get(todoId))?.listId).toBe(secondId);
    },
  );
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

  it(
    "REGRESSION: the legacy tabId backfill produces a real outbox entry with a real HLC, " +
      "not a silent Dexie write — otherwise the repair never reached other devices, and a " +
      "synced peer's next pull could reset tabId right back to null",
    async () => {
      await seedIfEmpty();
      const db = getDb();
      const listId = await createList("Weekend");
      const outboxCountBeforeBackfill = await db.outbox.count();

      const legacy = (await db.lists.get(listId))!;
      delete (legacy as { tabId?: string | null }).tabId;
      await db.lists.put(legacy);

      await ensureDefaultTab();

      const newEntries = (await db.outbox.toArray()).slice(outboxCountBeforeBackfill);
      const backfillEntry = newEntries.find((e) => e.entityId === listId);
      expect(backfillEntry).toBeDefined();
      expect(backfillEntry?.patch.tabId).toBe(DEFAULT_TAB_ID);
      // A real, monotone HLC (via mutate()) — not SEED_HLC. This is a
      // deliberate local decision about an existing row, not a first-run
      // guess, so it must win against any real edit, not lose to one.
      expect(backfillEntry?.hlc).not.toBe(SEED_HLC);
    },
  );
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

describe("schedulePatch — placement stamping", () => {
  it("stamps scheduledAt when the date genuinely changes", () => {
    const patch = schedulePatch("2026-08-11", "2026-08-10");
    expect(patch.scheduledDate).toBe("2026-08-11");
    expect(patch.scheduledAt).toBeTruthy();
  });

  it("stamps scheduledAt when scheduling for the first time (previous null)", () => {
    const patch = schedulePatch("2026-08-11", null);
    expect(patch.scheduledAt).toBeTruthy();
  });

  it("does NOT stamp scheduledAt when the date is unchanged", () => {
    // The case that matters: re-writing the same date must not look like a
    // fresh assignment on the day sheet's timeline.
    const patch = schedulePatch("2026-08-11", "2026-08-11");
    expect(Object.hasOwn(patch, "scheduledAt")).toBe(false);
  });

  it("nulls scheduledAt when clearing the date", () => {
    const patch = schedulePatch(null, "2026-08-11");
    expect(patch.scheduledDate).toBeNull();
    expect(patch.scheduledAt).toBeNull();
  });

  it("does not stamp when clearing an already-null date", () => {
    const patch = schedulePatch(null, null);
    expect(Object.hasOwn(patch, "scheduledAt")).toBe(false);
  });
});

describe("dayGroupPatch — placement stamping", () => {
  it("stamps scheduledAt when dropped on a different day", () => {
    const patch = dayGroupPatch("list1", "2026-08-11", "2026-08-10");
    expect(patch.scheduledAt).toBeTruthy();
  });

  it("does NOT stamp scheduledAt when only the list group changes within the same day", () => {
    // Dragging a card between list groups within one day writes the same date
    // again — that must not read as a fresh assignment.
    const patch = dayGroupPatch("list2", "2026-08-11", "2026-08-11");
    expect(Object.hasOwn(patch, "scheduledAt")).toBe(false);
    expect(patch.listId).toBe("list2");
  });

  it("stamps scheduledAt on first placement (previous null)", () => {
    const patch = dayGroupPatch("list1", "2026-08-11", null);
    expect(patch.scheduledAt).toBeTruthy();
  });
});

describe("listPatch — unscheduling clears placement", () => {
  it("nulls both scheduledDate and scheduledAt", () => {
    const patch = listPatch("list1", "a5");
    expect(patch.scheduledDate).toBeNull();
    expect(patch.scheduledAt).toBeNull();
  });
});

describe("materializeOccurrence", () => {
  it("writes a real row for a virtual occurrence and stamps fresh timestamps", async () => {
    const templateId = await createTodo({ title: "Timesheets", scheduledDate: "2026-08-07" });
    const template = (await getDb().todos.get(templateId))!;
    const virtual = { ...template, id: occurrenceId(templateId, "2026-08-14"), scheduledDate: "2026-08-14" };

    const row = await materializeOccurrence(virtual);

    expect(row.id).toBe(occurrenceId(templateId, "2026-08-14"));
    const stored = await getDb().todos.get(row.id);
    expect(stored).toBeDefined();
    expect(stored?.scheduledDate).toBe("2026-08-14");
  });

  it("upserts rather than throwing on a re-entrant materialize of the same occurrence", async () => {
    const templateId = await createTodo({ title: "Timesheets", scheduledDate: "2026-08-07" });
    const template = (await getDb().todos.get(templateId))!;
    const virtual = { ...template, id: occurrenceId(templateId, "2026-08-14"), scheduledDate: "2026-08-14" };

    await materializeOccurrence(virtual);
    await expect(materializeOccurrence(virtual)).resolves.toBeDefined();
    expect(await getDb().todos.where("id").equals(virtual.id).count()).toBe(1);
  });
});

describe("setSeriesUntil", () => {
  it("sets `until` on the template's rule", async () => {
    const templateId = await createTodo({ title: "Timesheets", scheduledDate: "2026-08-07" });
    await getDb().todos.update(templateId, {
      recurrenceRule: JSON.stringify(defaultRule("2026-08-07")),
    });

    await setSeriesUntil(templateId, "2026-09-01");

    const template = (await getDb().todos.get(templateId))!;
    expect(parseRule(template.recurrenceRule)?.until).toBe("2026-09-01");
  });

  it("is a no-op when the template has no parseable rule", async () => {
    const todoId = await createTodo({ title: "Not a series" });
    await expect(setSeriesUntil(todoId, "2026-09-01")).resolves.toBeUndefined();
  });
});

describe("createSeriesFromTodo", () => {
  it("leaves the source todo untouched and anchors the template past it", async () => {
    const sourceId = await createTodo({ title: "Timesheets", scheduledDate: "2026-08-07" });
    const source = (await getDb().todos.get(sourceId))!;

    const rule = { ...defaultRule("2026-08-07"), freq: "weekly" as const, byDay: [5] };
    const templateId = await createSeriesFromTodo(source, rule);

    const unchangedSource = (await getDb().todos.get(sourceId))!;
    expect(unchangedSource.recurrenceRule).toBeNull();
    expect(unchangedSource.recurrenceParentId).toBeNull();
    expect(unchangedSource.scheduledDate).toBe("2026-08-07");

    const template = (await getDb().todos.get(templateId))!;
    expect(template.id).not.toBe(sourceId);
    expect(parseRule(template.recurrenceRule)).toEqual(rule);
    // Anchored to the NEXT Friday, not the source's own date.
    expect(template.scheduledDate).toBe("2026-08-14");
  });

  it("throws when the source todo has no scheduledDate", async () => {
    const sourceId = await createTodo({ title: "Unscheduled" });
    const source = (await getDb().todos.get(sourceId))!;
    await expect(createSeriesFromTodo(source, defaultRule("2026-08-07"))).rejects.toThrow();
  });
});

describe("places", () => {
  it("creates a place with the given name and address", async () => {
    const id = await createPlace("Home", "1 Main St");
    const place = await getDb().places.get(id);
    expect(place?.name).toBe("Home");
    expect(place?.address).toBe("1 Main St");
    expect(place?.googlePlaceId).toBeNull();
  });

  it("updates a place", async () => {
    const id = await createPlace("Home", "1 Main St");
    await updatePlace(id, { name: "Home Sweet Home" });
    expect((await getDb().places.get(id))?.name).toBe("Home Sweet Home");
  });

  it("deletes a place and clears it from every todo that referenced it", async () => {
    const placeId = await createPlace("Gym", "2 Fitness Ave");
    const todoId = await createTodo({ title: "Workout" });
    await getDb().todos.update(todoId, { placeId });

    await deletePlace(placeId);

    expect((await getDb().places.get(placeId))?.deletedAt).toBeTruthy();
    const todo = await getDb().todos.get(todoId);
    expect(todo?.placeId).toBeNull();
    // The todo itself, and its free-text location, are untouched.
    expect(todo?.deletedAt).toBeNull();
  });

  it("leaves unrelated todos' placeId alone", async () => {
    const placeA = await createPlace("Home", "1 Main St");
    const placeB = await createPlace("Gym", "2 Fitness Ave");
    const todoId = await createTodo({ title: "Workout" });
    await getDb().todos.update(todoId, { placeId: placeB });

    await deletePlace(placeA);

    expect((await getDb().todos.get(todoId))?.placeId).toBe(placeB);
  });
});
