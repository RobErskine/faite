import type {
  CivilDate,
  Label,
  List,
  Priority,
  Project,
  Tab,
  Todo,
  TodoStatus,
} from "@/lib/schema";
import { positionAtEnd, positionsBetween } from "@/lib/ordering";
import { DEFAULT_FONT_PAIRING } from "@/lib/fonts";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import { DEFAULT_AVATAR_KIND } from "@/lib/profile";
import { getDb } from "./db";
import { create, mutate, newId, now, remove } from "./mutate";
import { getCurrentOwnerId, LOCAL_OWNER_ID } from "./owner";

/**
 * CRUD for every entity, expressed on top of mutate().
 *
 * Nothing here touches Dexie's write API directly — every mutation routes
 * through mutate()/create()/remove() so the outbox always sees it.
 */

export { LOCAL_OWNER_ID };

/**
 * The tab every user starts with.
 *
 * Deterministic like the seeded lists, so two devices seeding independently at
 * P3 converge on one tab rather than merging into two.
 */
export const DEFAULT_TAB_ID = "seed:tab:my-lists";

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export interface CreateTodoInput {
  title: string;
  listId?: string | null;
  scheduledDate?: CivilDate | null;
  deadline?: CivilDate | null;
  priority?: Priority | null;
  description?: string | null;
  location?: string | null;
  projectId?: string | null;
  labelIds?: string[];
  position?: string;
}

export async function createTodo(input: CreateTodoInput): Promise<string> {
  const timestamp = now();
  const todo: Todo = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    title: input.title,
    description: input.description ?? null,
    status: "open",
    priority: input.priority ?? null,
    scheduledDate: input.scheduledDate ?? null,
    deadline: input.deadline ?? null,
    listId: input.listId ?? null,
    projectId: input.projectId ?? null,
    labelIds: input.labelIds ?? [],
    location: input.location ?? null,
    parentId: null,
    position: input.position ?? (await nextTodoPosition()),
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
  };
  return create("todo", todo);
}

async function nextTodoPosition(): Promise<string> {
  const db = getDb();
  const last = await db.todos.orderBy("position").last();
  return positionAtEnd(last?.position ?? null);
}

export async function updateTodo(
  id: string,
  patch: Partial<Omit<Todo, "id" | "ownerId" | "createdAt">>,
): Promise<void> {
  await mutate("todo", id, patch);
}

/**
 * The patch shapes, extracted so undo can reverse exactly what was written.
 *
 * An undo entry is built by picking the forward patch's keys off the record as
 * it was before the write (see lib/undo.ts). That only works if the caller can
 * see the WHOLE patch — and two of these write a field the caller never passes:
 * `moveTodoToList` clears `scheduledDate`, `setTodoStatus` stamps `completedAt`.
 *
 * Hand-writing the patch at the call site would silently drop those, and the
 * failure is invisible: dragging a scheduled todo into a list and undoing would
 * restore the list but leave the todo unscheduled. Sharing one shape between
 * the repository and the inverse means they cannot drift.
 */
export const statusPatch = (status: TodoStatus) => ({
  status,
  completedAt: status === "open" ? null : now(),
});

export const schedulePatch = (
  scheduledDate: CivilDate | null,
  position?: string,
) => ({
  scheduledDate,
  ...(position ? { position } : {}),
});

export const listPatch = (listId: string | null, position?: string) => ({
  listId,
  // Moving into a list returns the todo to planning, so any schedule goes.
  scheduledDate: null,
  ...(position ? { position } : {}),
});

/**
 * Set completion state.
 *
 * `dropped` ("won't do") is deliberately a separate status from `done` — the
 * distinction is the whole point of the Overflow column's triage.
 */
export async function setTodoStatus(id: string, status: TodoStatus): Promise<void> {
  await mutate("todo", id, statusPatch(status));
}

/** Schedule onto a day. Does NOT clear listId or labels — membership is kept. */
export async function scheduleTodo(
  id: string,
  scheduledDate: CivilDate | null,
  position?: string,
): Promise<void> {
  await mutate("todo", id, schedulePatch(scheduledDate, position));
}

/** Move into a list column, clearing any schedule so it returns to planning. */
export async function moveTodoToList(
  id: string,
  listId: string | null,
  position?: string,
): Promise<void> {
  await mutate("todo", id, listPatch(listId, position));
}

export async function reorderTodo(id: string, position: string): Promise<void> {
  await mutate("todo", id, { position });
}

/**
 * Soft delete. There is no `restoreTodo` counterpart on purpose: undo writes
 * `{deletedAt: null}` through mutate() like any other patch, so a bespoke
 * restore helper would be a second way to do the same thing.
 */
export const deleteTodo = (id: string) => remove("todo", id);

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/**
 * Create a list on a tab.
 *
 * `tabId` defaults to the default tab rather than null: null is reserved for
 * Backlog, which is pinned into every tab. A new list created with null would
 * appear on all of them.
 */
export async function createList(
  name: string,
  decoration: Partial<Pick<List, "color" | "emoji" | "iconUrl">> = {},
  tabId: string = DEFAULT_TAB_ID,
): Promise<string> {
  const db = getDb();
  const last = await db.lists.orderBy("position").last();
  const timestamp = now();
  const list: List = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    isBacklog: false,
    archivedAt: null,
    archivedWithTabId: null,
    position: positionAtEnd(last?.position ?? null),
    tabId,
    color: decoration.color ?? null,
    emoji: decoration.emoji ?? null,
    iconUrl: decoration.iconUrl ?? null,
  };
  return create("list", list);
}

export async function updateList(
  id: string,
  patch: Partial<Omit<List, "id" | "ownerId" | "createdAt" | "isBacklog">>,
): Promise<void> {
  await mutate("list", id, patch);
}

/**
 * Delete a list, moving its todos to Backlog rather than destroying them.
 *
 * Backlog itself cannot be deleted — it is the guaranteed destination, so
 * removing it would leave orphaned todos with nowhere to land.
 *
 * Returns which todos were reassigned so one undo can put the list AND its
 * todos back. Without them, undoing would restore an empty list and strand
 * every todo in Backlog — worse than no undo at all. Null means nothing was
 * deleted (Backlog, or an id that is already gone).
 */
export async function deleteList(
  id: string,
): Promise<{ listId: string; movedTodoIds: string[] } | null> {
  const db = getDb();
  const list = await db.lists.get(id);
  if (!list || list.isBacklog) return null;

  const backlog = await getBacklog();
  const orphans = await db.todos.where("listId").equals(id).toArray();
  for (const todo of orphans) {
    await mutate("todo", todo.id, { listId: backlog?.id ?? null });
  }
  await remove("list", id);

  return { listId: id, movedTodoIds: orphans.map((t) => t.id) };
}

/**
 * Put a list away without destroying it.
 *
 * Unlike `deleteList`, the to-dos are left exactly where they are: they leave
 * the board with their list and come back with it. Rehoming them to Backlog
 * would make restoring return an empty column, and would make the item count
 * shown in the archive a lie.
 *
 * Backlog is exempt for the same reason it cannot be deleted — it is the
 * fallback destination for homeless to-dos, so it has to stay on the board.
 *
 * Returns the list as it was before archiving, so the caller can label the
 * toast and undo entry. Null means nothing happened.
 */
export async function archiveList(id: string): Promise<List | null> {
  const list = await getDb().lists.get(id);
  if (!list || list.isBacklog || list.deletedAt || list.archivedAt) return null;

  // Explicitly not part of a tab's group, so a later `unarchiveTab` leaves it
  // filed. Written rather than assumed, in case the list carries a stale
  // marker from an earlier group archive.
  await updateList(id, { archivedAt: now(), archivedWithTabId: null });
  return list;
}

/** Return an archived list to the board, its to-dos still attached. */
export async function unarchiveList(id: string): Promise<void> {
  await updateList(id, { archivedAt: null, archivedWithTabId: null });
}

export async function getBacklog(): Promise<List | undefined> {
  const lists = await getDb().lists.toArray();
  return lists.find((l) => l.isBacklog && !l.deletedAt);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

/** The list a new tab is born holding. */
export const starterListName = (tabName: string) => `${tabName} List`;

/**
 * Create a tab, along with one starter list to put things in.
 *
 * A tab with no lists is a dead end: the planning half renders an empty track,
 * and the only way forward is to notice the create-list slot at its left edge.
 * Being born with a list means a new tab is immediately usable, and it makes
 * the tab's purpose legible at a glance rather than after two more steps.
 *
 * Returns both ids because the caller has to undo both — see
 * `createTabWithUndo`, where they become one entry.
 */
export async function createTab(
  name: string,
  fields: Partial<Pick<Tab, "description" | "color" | "emoji" | "iconUrl">> = {},
): Promise<{ tabId: string; listId: string }> {
  const db = getDb();
  const last = await db.tabs.orderBy("position").last();
  const timestamp = now();
  const tab: Tab = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    description: fields.description ?? null,
    isDefault: false,
    archivedAt: null,
    position: positionAtEnd(last?.position ?? null),
    color: fields.color ?? null,
    emoji: fields.emoji ?? null,
    iconUrl: fields.iconUrl ?? null,
  };

  const tabId = await create("tab", tab);
  const listId = await createList(starterListName(name), {}, tabId);
  return { tabId, listId };
}

export async function updateTab(
  id: string,
  patch: Partial<Omit<Tab, "id" | "ownerId" | "createdAt" | "isDefault">>,
): Promise<void> {
  await mutate("tab", id, patch);
}

/**
 * Put a tab away, taking its lists with it.
 *
 * Each live list is marked with `archivedWithTabId`, which is what makes the
 * group restorable as a group: `unarchiveTab` brings back exactly the lists
 * bearing this tab's id, so one archived on its own stays archived. They also
 * share the tab's `archivedAt`, but only so the archive lists them together —
 * the timestamp is presentation, the marker is identity. (Matching on the
 * timestamp alone was the first attempt and it was wrong: two archives inside
 * one millisecond are indistinguishable.)
 *
 * Only lists that were actually live get marked, and their ids come back so a
 * single undo entry can reverse the tab and those lists together.
 *
 * The default tab is exempt for the same reason Backlog is: it is where
 * `deleteTab` rehomes lists, so it has to stay on the strip.
 *
 * Returns null when nothing happened.
 */
export async function archiveTab(
  id: string,
): Promise<{ tab: Tab; listIds: string[] } | null> {
  const db = getDb();
  const tab = await db.tabs.get(id);
  if (!tab || tab.isDefault || tab.deletedAt || tab.archivedAt) return null;

  const lists = await db.lists.where("tabId").equals(id).toArray();
  const listIds = lists.filter((l) => !l.deletedAt && !l.archivedAt).map((l) => l.id);

  const timestamp = now();
  await updateTab(id, { archivedAt: timestamp });
  for (const listId of listIds) {
    await updateList(listId, { archivedAt: timestamp, archivedWithTabId: id });
  }

  return { tab, listIds };
}

/**
 * Return an archived tab to the strip, along with the lists that left with it.
 *
 * `archivedWithTabId` is what keeps this precise: a list archived by itself
 * carries no marker and stays archived, however close together the two
 * archives happened.
 *
 * Returns which lists came back, so undoing a restore can re-file exactly that
 * group. Null means nothing happened.
 */
export async function unarchiveTab(
  id: string,
): Promise<{ tab: Tab; listIds: string[] } | null> {
  const db = getDb();
  const tab = await db.tabs.get(id);
  if (!tab || !tab.archivedAt) return null;

  const lists = await db.lists.where("tabId").equals(id).toArray();
  const listIds = lists
    // `archivedAt` is still checked: a list restored on its own since the tab
    // was filed keeps no marker, but one restored by an older build might.
    .filter((l) => !l.deletedAt && l.archivedAt && l.archivedWithTabId === id)
    .map((l) => l.id);

  await updateTab(id, { archivedAt: null });
  for (const listId of listIds) {
    await updateList(listId, { archivedAt: null, archivedWithTabId: null });
  }

  return { tab, listIds };
}

/**
 * Delete a tab, rehoming its lists to the default tab rather than stranding
 * them on a tab that no longer exists — the mirror of how `deleteList` rehomes
 * todos to Backlog.
 *
 * The default tab itself cannot be deleted, because it is the guaranteed
 * destination here.
 *
 * Returns the rehomed list ids so one undo puts the tab AND its lists back.
 * Null means nothing was deleted.
 */
export async function deleteTab(
  id: string,
): Promise<{ tabId: string; movedListIds: string[] } | null> {
  const db = getDb();
  const tab = await db.tabs.get(id);
  if (!tab || tab.isDefault) return null;

  const orphans = await db.lists.where("tabId").equals(id).toArray();
  for (const list of orphans) {
    await mutate("list", list.id, { tabId: DEFAULT_TAB_ID });
  }
  await remove("tab", id);

  return { tabId: id, movedListIds: orphans.map((l) => l.id) };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export async function createLabel(
  name: string,
  decoration: Partial<Pick<Label, "color" | "emoji" | "iconUrl">> = {},
): Promise<string> {
  const db = getDb();
  const last = await db.labels.orderBy("position").last();
  const timestamp = now();
  const label: Label = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    position: positionAtEnd(last?.position ?? null),
    color: decoration.color ?? null,
    emoji: decoration.emoji ?? null,
    iconUrl: decoration.iconUrl ?? null,
  };
  return create("label", label);
}

export async function updateLabel(
  id: string,
  patch: Partial<Omit<Label, "id" | "ownerId" | "createdAt">>,
): Promise<void> {
  await mutate("label", id, patch);
}

/** Delete a label and strip it from every todo that referenced it. */
export async function deleteLabel(id: string): Promise<void> {
  const db = getDb();
  const tagged = await db.todos.filter((t) => t.labelIds.includes(id)).toArray();
  for (const todo of tagged) {
    await mutate("todo", todo.id, {
      labelIds: todo.labelIds.filter((l) => l !== id),
    });
  }
  await remove("label", id);
}

export async function toggleTodoLabel(todoId: string, labelId: string): Promise<void> {
  const todo = await getDb().todos.get(todoId);
  if (!todo) return;
  const labelIds = todo.labelIds.includes(labelId)
    ? todo.labelIds.filter((l) => l !== labelId)
    : [...todo.labelIds, labelId];
  await mutate("todo", todoId, { labelIds });
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(
  name: string,
  decoration: Partial<Pick<Project, "color" | "emoji" | "iconUrl">> = {},
): Promise<string> {
  const db = getDb();
  const last = await db.projects.orderBy("position").last();
  const timestamp = now();
  const project: Project = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    position: positionAtEnd(last?.position ?? null),
    color: decoration.color ?? null,
    emoji: decoration.emoji ?? null,
    iconUrl: decoration.iconUrl ?? null,
  };
  return create("project", project);
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, "id" | "ownerId" | "createdAt">>,
): Promise<void> {
  await mutate("project", id, patch);
}

export async function deleteProject(id: string): Promise<void> {
  const db = getDb();
  const members = await db.todos.where("projectId").equals(id).toArray();
  for (const todo of members) {
    await mutate("todo", todo.id, { projectId: null });
  }
  await remove("project", id);
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const SEED_LISTS = [
  { slug: "backlog", name: "Backlog", isBacklog: true },
  { slug: "brain-dump", name: "Brain Dump", isBacklog: false },
  { slug: "grocery-list", name: "Grocery List", isBacklog: false },
  { slug: "to-buy", name: "To Buy", isBacklog: false },
  { slug: "to-read", name: "To Read", isBacklog: false },
] as const;

/** Deterministic id for a default list. */
const seedListId = (slug: string) => `seed:list:${slug}`;

/** The default tab record, built fresh so seeding and repair cannot drift. */
function defaultTabRecord(timestamp: string): Tab {
  return {
    id: DEFAULT_TAB_ID,
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name: "My Lists",
    description: null,
    isDefault: true,
    archivedAt: null,
    position: positionAtEnd(null),
    color: null,
    emoji: null,
    iconUrl: null,
  };
}

/**
 * Create the default lists and settings on first run.
 *
 * Idempotent in two independent ways, because a single guard was not enough:
 *
 * 1. The emptiness check runs INSIDE the transaction. Reading the count first
 *    and then opening a transaction let two concurrent callers both observe an
 *    empty database and both seed it — which is exactly what React StrictMode's
 *    double-invoked effect does in development.
 * 2. Seed rows use deterministic ids with `put`, so even a re-entrant call
 *    upserts the same five rows instead of appending another set.
 *
 * The deterministic ids also pay off at P3: two devices seeding independently
 * converge on the same rows rather than merging into ten default lists.
 */
export async function seedIfEmpty(): Promise<void> {
  const db = getDb();
  const timestamp = now();
  const positions = positionsBetween(null, null, SEED_LISTS.length);
  const ownerId = getCurrentOwnerId();

  await db.transaction("rw", db.lists, db.tabs, db.settings, async () => {
    if ((await db.lists.count()) > 0) return;

    await db.tabs.put(defaultTabRecord(timestamp));

    for (const [i, seed] of SEED_LISTS.entries()) {
      const list: List = {
        id: seedListId(seed.slug),
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        name: seed.name,
        isBacklog: seed.isBacklog,
        archivedAt: null,
        archivedWithTabId: null,
        position: positions[i],
        // Backlog is pinned into every tab, so it belongs to none of them.
        // Everything else starts on the default tab.
        tabId: seed.isBacklog ? null : DEFAULT_TAB_ID,
        color: null,
        emoji: null,
        iconUrl: null,
      };
      await db.lists.put(list);
    }

    await db.settings.put({
      // Deliberately NOT `ownerId` above: settings is a per-DEVICE singleton
      // keyed on the placeholder forever, regardless of who is signed in — see
      // adoptLocalData() in adopt-owner.ts. useSettings()/mutateSettings() are
      // hardcoded to this same key throughout the app; keying it any other way
      // would silently orphan every read.
      ownerId: LOCAL_OWNER_ID,
      // Use the device's zone as the starting point; user-editable in settings.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      workdaysOnly: false,
      workdays: [1, 2, 3, 4, 5],
      overflowAfterDays: 3,
      visibleDays: 7,
      fontPairing: DEFAULT_FONT_PAIRING,
      theme: DEFAULT_THEME_MODE,
      displayName: "",
      avatarKind: DEFAULT_AVATAR_KIND,
      avatarInitials: "",
      avatarEmoji: "",
      avatarImage: "",
      activeTabId: DEFAULT_TAB_ID,
      updatedAt: timestamp,
    });
  });
}

/**
 * Make sure the default tab exists and every list sits on a tab.
 *
 * Runs on every boot, not just the first. Databases written before tabs
 * existed hold lists whose `tabId` reads back `undefined`, and those lists
 * match no tab — without this they would vanish from the board entirely, which
 * looks exactly like data loss. Backlog is skipped deliberately: null is its
 * permanent "pinned into every tab" value, not a missing one.
 *
 * Writes go straight to Dexie rather than through mutate(), for the same
 * reason repairDuplicateLists does: this only ever runs pre-sync, so there is
 * no peer that needs an outbox entry for a field it was always going to
 * compute the same way.
 *
 * Idempotent — deterministic id with `put`, and the list pass is a no-op once
 * every list has a tab.
 */
export async function ensureDefaultTab(): Promise<number> {
  const db = getDb();
  let assigned = 0;

  await db.transaction("rw", db.tabs, db.lists, async () => {
    if (!(await db.tabs.get(DEFAULT_TAB_ID))) {
      await db.tabs.put(defaultTabRecord(now()));
    }

    for (const list of await db.lists.toArray()) {
      // Truthiness, not `=== null`: legacy rows read the field back undefined.
      if (list.deletedAt || list.isBacklog || list.tabId) continue;
      await db.lists.update(list.id, { tabId: DEFAULT_TAB_ID });
      assigned++;
    }
  });

  return assigned;
}

/**
 * Repair duplicate lists left behind by the seeding race described above.
 *
 * Groups surviving lists by name, keeps the oldest, moves any todos off the
 * duplicates, and hard-deletes them. Hard deletion is correct here precisely
 * because this only runs pre-sync: the duplicates never left this device, so
 * there is no peer that needs a tombstone.
 *
 * Safe to remove once no local database predates the fix.
 */
export async function repairDuplicateLists(): Promise<number> {
  const db = getDb();
  let removed = 0;

  await db.transaction("rw", db.lists, db.todos, async () => {
    const lists = (await db.lists.toArray()).filter((l) => !l.deletedAt);

    const byName = new Map<string, List[]>();
    for (const list of lists) {
      const group = byName.get(list.name) ?? [];
      group.push(list);
      byName.set(list.name, group);
    }

    for (const group of byName.values()) {
      if (group.length < 2) continue;

      // Prefer the deterministic seed row, then the oldest, as the survivor.
      group.sort((a, b) => {
        const aSeed = a.id.startsWith("seed:") ? 0 : 1;
        const bSeed = b.id.startsWith("seed:") ? 0 : 1;
        return aSeed - bSeed || a.createdAt.localeCompare(b.createdAt);
      });

      const [keeper, ...duplicates] = group;
      for (const duplicate of duplicates) {
        const orphans = await db.todos.where("listId").equals(duplicate.id).toArray();
        for (const todo of orphans) {
          await db.todos.update(todo.id, { listId: keeper.id });
        }
        await db.lists.delete(duplicate.id);
        removed++;
      }
    }
  });

  return removed;
}
