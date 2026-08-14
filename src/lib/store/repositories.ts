import type {
  CivilDate,
  DayNote,
  Label,
  List,
  Place,
  Priority,
  Project,
  ReminderPreset,
  Tab,
  Todo,
  TodoEvent,
  TodoStatus,
} from "@/lib/schema";
import { positionAtEnd, positionsBetween } from "@/lib/ordering";
import { DEFAULT_FONT_PAIRING } from "@/lib/fonts";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import { DEFAULT_AVATAR_KIND } from "@/lib/profile";
import {
  firstOccurrenceAfter,
  occurrencesBetween,
  parseOccurrenceId,
  parseRule,
  serializeRule,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { getDb } from "./db";
import { create, materialize, mutate, mutateSettings, newId, now, remove, seedWrite } from "./mutate";
import { getCurrentOwnerId, LOCAL_OWNER_ID } from "./owner";
import { buildEditedPayload, logTodoEvent } from "./todo-events";

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
  reminderTime?: string | null;
  placeId?: string | null;
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
    // Never stamped at creation, even when created directly onto a day
    // (quick-add): that placement is already covered by the "Created" event,
    // and this would just echo it. Only a later RESCHEDULE sets this — see
    // `schedulePatch`/`dayGroupPatch`.
    scheduledAt: null,
    deadline: input.deadline ?? null,
    listId: input.listId ?? null,
    projectId: input.projectId ?? null,
    labelIds: input.labelIds ?? [],
    location: input.location ?? null,
    placeId: input.placeId ?? null,
    parentId: null,
    position: input.position ?? (await nextTodoPosition()),
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    reminderTime: input.reminderTime ?? null,
  };
  return create("todo", todo, { events: [logTodoEvent(todo.id, "created")] });
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
  const payload = buildEditedPayload(patch);
  await mutate("todo", id, patch, {
    events: payload ? [logTodoEvent(id, "edited", payload)] : [],
  });
}

/**
 * The patch shapes, extracted so undo can reverse exactly what was written.
 *
 * An undo entry is built by picking the forward patch's keys off the record as
 * it was before the write (see lib/undo.ts). That only works if the caller can
 * see the WHOLE patch — and three of these write a field the caller never passes
 * explicitly: `moveTodoToList` clears `scheduledDate`, `setTodoStatus` stamps
 * `completedAt`, and `moveTodoToDayGroup` writes both `listId` and the date.
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

/**
 * `previousDate` is the placement BEFORE this write — used only to decide
 * whether `scheduledAt` should move, not written itself. Dragging a card
 * between list groups within the SAME day calls this too (see
 * `dayGroupPatch`), rewriting the date it already had; that must not look
 * like a fresh assignment on the day sheet's timeline, or shuffling groups
 * within a day would keep bumping "Assigned here" to the current moment.
 */
export const schedulePatch = (
  scheduledDate: CivilDate | null,
  previousDate: CivilDate | null,
  position?: string,
) => ({
  scheduledDate,
  ...(scheduledDate !== previousDate
    ? { scheduledAt: scheduledDate ? now() : null }
    : {}),
  ...(position ? { position } : {}),
});

export const listPatch = (listId: string | null, position?: string) => ({
  listId,
  // Moving into a list returns the todo to planning, so any schedule goes —
  // and with it, WHEN it was last placed on a day. A todo currently unscheduled
  // has nothing for `day-timeline.ts` to say about it.
  scheduledDate: null,
  scheduledAt: null,
  // A reminder resolves against `scheduledDate` (lib/reminders.ts) — clearing
  // one without the other would leave a stored time with no date to fire
  // against, silently orphaned until the todo is scheduled again.
  reminderTime: null,
  ...(position ? { position } : {}),
});

/**
 * Assign a list WITHOUT returning the todo to planning.
 *
 * The day-column group gesture: dropping a card on a group means "this belongs to
 * list X, still scheduled for D". `listPatch` cannot serve it and must not be
 * softened to — clearing the date is the correct meaning of a drop into a LIST
 * COLUMN ("this comes back to planning"), and the two gestures would then be
 * indistinguishable to undo.
 *
 * The date is written rather than left alone even when it looks unchanged, because
 * it often IS changed: a rolled-over todo renders in TODAY's column while still
 * carrying an older `scheduledDate`, so dropping it on a group there is exactly
 * how it gets committed to today. Undo therefore has to reverse both fields, which
 * is what sharing one patch shape with `inversePatch` guarantees.
 */
export const dayGroupPatch = (
  listId: string | null,
  scheduledDate: CivilDate,
  previousDate: CivilDate | null,
  position?: string,
) => ({
  listId,
  scheduledDate,
  ...(scheduledDate !== previousDate ? { scheduledAt: now() } : {}),
  ...(position ? { position } : {}),
});

/**
 * Set completion state.
 *
 * `dropped` ("won't do") is deliberately a separate status from `done` — the
 * distinction is the whole point of the Overflow column's triage.
 */
/**
 * Returns the id of the `done`/`dropped`/`reopened` event this call logged,
 * or `null` when the status didn't actually change — `handleToggle`/
 * `handleSheetStatus` (`use-board-actions.ts`) pass this to `attachEventIds`
 * so undoing an instant status change tombstones the event rather than
 * leaving e.g. "Completed" on something un-done a second later (EI-94 Phase 3).
 */
export async function setTodoStatus(id: string, status: TodoStatus): Promise<string | null> {
  // Read-before-write to know the PREVIOUS status: `reopened` only means
  // something relative to what it was, and a status set to what it already
  // was (unreachable from the UI today, but not from undo/redo replay of a
  // stale entry) must log nothing rather than a false transition.
  const existing = await getDb().todos.get(id);
  const kind =
    !existing || existing.status === status
      ? null
      : status === "done"
        ? "done"
        : status === "dropped"
          ? "dropped"
          : "reopened";
  const eventIds = await mutate("todo", id, statusPatch(status), {
    events: kind ? [logTodoEvent(id, kind)] : [],
  });
  return eventIds[0] ?? null;
}

/** Schedule onto a day. Does NOT clear listId or labels — membership is kept. */
export async function scheduleTodo(
  id: string,
  scheduledDate: CivilDate | null,
  previousDate: CivilDate | null,
  position?: string,
): Promise<void> {
  // Same date-changed condition `schedulePatch` uses for `scheduledAt`, so
  // the guard and the stamp can't drift apart.
  const events =
    scheduledDate !== previousDate
      ? [
          logTodoEvent(id, scheduledDate ? "scheduled" : "unscheduled", {
            v: 1,
            from: previousDate,
            to: scheduledDate,
          }),
        ]
      : [];
  await mutate("todo", id, schedulePatch(scheduledDate, previousDate, position), { events });
}

/** Move into a list column, clearing any schedule so it returns to planning. */
export async function moveTodoToList(
  id: string,
  listId: string | null,
  position?: string,
): Promise<void> {
  const db = getDb();
  const existing = await db.todos.get(id);
  const events: TodoEvent[] = [];
  if (existing) {
    const [fromList, toList] = await Promise.all([
      existing.listId ? db.lists.get(existing.listId) : undefined,
      listId ? db.lists.get(listId) : undefined,
    ]);
    events.push(
      logTodoEvent(id, "moved", {
        v: 1,
        fromListId: existing.listId ?? null,
        fromListName: fromList?.name ?? null,
        toListId: listId,
        toListName: toList?.name ?? null,
      }),
    );
    // `listPatch` unconditionally clears `scheduledDate` — only log
    // `unscheduled` when that actually changed something.
    if (existing.scheduledDate !== null) {
      events.push(logTodoEvent(id, "unscheduled", { v: 1, from: existing.scheduledDate, to: null }));
    }
  }
  await mutate("todo", id, listPatch(listId, position), { events });
}

/** Assign a list while keeping (or committing) a day. See `dayGroupPatch`. */
export async function moveTodoToDayGroup(
  id: string,
  listId: string | null,
  scheduledDate: CivilDate,
  previousDate: CivilDate | null,
  position?: string,
): Promise<void> {
  // Same date-changed condition `dayGroupPatch` uses for `scheduledAt`. Does
  // NOT also log `moved` even though `listId` always changes here — the
  // day-column-group gesture is fundamentally a scheduling action ("this
  // belongs to list X, still scheduled for D"), and `dayGroupPatch`'s own
  // doc comment says so.
  const events =
    scheduledDate !== previousDate
      ? [logTodoEvent(id, "scheduled", { v: 1, from: previousDate, to: scheduledDate })]
      : [];
  await mutate("todo", id, dayGroupPatch(listId, scheduledDate, previousDate, position), { events });
}

export async function reorderTodo(id: string, position: string): Promise<void> {
  await mutate("todo", id, { position });
}

/**
 * Soft delete. There is no `restoreTodo` counterpart on purpose: undo writes
 * `{deletedAt: null}` through mutate() like any other patch, so a bespoke
 * restore helper would be a second way to do the same thing.
 */
export const deleteTodo = (id: string) =>
  remove("todo", id, { events: [logTodoEvent(id, "deleted")] });

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

/**
 * Materialize a virtual recurrence occurrence into a real row.
 *
 * Required before any status change, edit, drag, or delete on an occurrence
 * that has never been touched: `mutate()` throws on a missing row (see
 * `mutate.ts`) by design — a virtual occurrence has no row to update yet.
 * `materialize()` uses `put` rather than `add`, so two devices materializing
 * the same occurrence offline converge on one row instead of racing a
 * `ConstraintError`.
 *
 * Stamps fresh `createdAt`/`updatedAt`: the virtual object's timestamps are
 * cloned from the template (see `lib/recurrence-expand.ts`), and a
 * materialized occurrence is a real, provenanced write, not an echo of when
 * the series itself was created.
 */
export async function materializeOccurrence(virtual: Todo): Promise<Todo> {
  const timestamp = now();
  const row: Todo = { ...virtual, createdAt: timestamp, updatedAt: timestamp };
  await materialize("todo", row);
  return row;
}

/**
 * Stop a series after `until` (inclusive) — "delete this and all future
 * occurrences" or editing the end date from the repeat dialog.
 *
 * A no-op if the template is gone or its rule fails to parse, rather than
 * throwing — this is reachable from an undo replay, where the row it targets
 * may already be gone for unrelated reasons.
 */
export async function setSeriesUntil(
  templateId: string,
  until: CivilDate | null,
): Promise<void> {
  const template = await getDb().todos.get(templateId);
  const rule = template ? parseRule(template.recurrenceRule) : null;
  if (!rule) return;
  await mutate(
    "todo",
    templateId,
    { recurrenceRule: serializeRule({ ...rule, until }) },
    { events: [logTodoEvent(templateId, "edited", { v: 1, fields: ["recurrenceRule"] })] },
  );
}

/**
 * Start a recurring series from an existing one-off todo.
 *
 * `sourceTodo` keeps its own `recurrenceRule` null — it is never itself a
 * template, and never gets re-expanded as one — but its `recurrenceParentId`
 * IS set to the new template, purely so the todo the user just set a repeat
 * on immediately shows that it repeats: the repeat icon on its card, and the
 * schedule/next-occurrence detail in its sheet, rather than looking exactly
 * like a plain todo until the NEXT occurrence eventually appears days later.
 * Without this link, setting up a weekly repeat produced no visible
 * confirmation at all on the item just edited — reported as "is this even
 * being saved?" in practice.
 *
 * This is safe because `recurrenceParentId` alone, without a matching
 * `${templateId}@${date}` id, never satisfies `parseOccurrenceId` — so
 * `sourceTodo` is invisible to the occupancy/settlement logic in
 * `recurrence-expand.ts` (which matches by id shape, not by this field) and
 * can never be mistaken for a materialized occurrence there. `board.tsx`'s
 * `recurrenceInfo` and `retargetSeries`/`deleteSeries` below all fall back
 * sensibly when `parseOccurrenceId` comes back null.
 *
 * "Repeat this" still reads as "and also, from here on, keep recurring", not
 * "replace this card with a series": `sourceTodo` keeps its own status,
 * completion, and every other field untouched, and the user still gets to
 * complete today's row normally — the series' own occurrences pick up
 * starting at the NEXT one, anchored via `firstOccurrenceAfter` rather than
 * `sourceTodo.scheduledDate` itself, which would otherwise generate a
 * duplicate virtual card on the same day as the real todo it came from.
 */
export async function createSeriesFromTodo(
  sourceTodo: Todo,
  rule: RecurrenceRule,
): Promise<string> {
  if (!sourceTodo.scheduledDate) {
    throw new Error("createSeriesFromTodo: source todo has no scheduledDate to anchor a series");
  }
  const timestamp = now();
  const template: Todo = {
    ...sourceTodo,
    id: newId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    status: "open",
    completedAt: null,
    scheduledDate: firstOccurrenceAfter(rule, sourceTodo.scheduledDate),
    scheduledAt: null,
    deadline: null,
    parentId: null,
    recurrenceRule: serializeRule(rule),
    recurrenceParentId: null,
  };
  const templateId = await create("todo", template);
  await mutate(
    "todo",
    sourceTodo.id,
    { recurrenceParentId: templateId },
    { events: [logTodoEvent(sourceTodo.id, "edited", { v: 1, fields: ["recurrenceRule"] })] },
  );
  return templateId;
}

/**
 * Retarget a series to a new rule starting HERE — "this and following
 * occurrences," the same semantic every calendar app uses for editing a
 * repeating event.
 *
 * Editing the rule in place (leaving `scheduledDate` alone) would re-align
 * the WHOLE series including the past: `iterateOccurrences` always starts
 * at the template's own `scheduledDate`, so a changed `freq`/`interval`/
 * `byDay` recomputes every occurrence from day one. Materialized children
 * don't move with it — their ids are `${templateId}@${date}`, frozen at
 * creation — so they'd silently become orphans: real rows still pointing at
 * a live template, sitting on dates the new rule no longer produces.
 * Retargeting keeps everything before `newStart` as untouched history and
 * only changes what the series generates from here forward.
 *
 * Any UNSETTLED child at or after `newStart` that the new rule doesn't
 * produce on its own date is tombstoned — left alone it would sit forever as
 * an open card on a date nothing will ever regenerate or settle. Settled
 * children are never touched; they're already history regardless of rule.
 */
export async function retargetSeries(
  templateId: string,
  rule: RecurrenceRule,
  newStart: CivilDate,
): Promise<void> {
  await mutate("todo", templateId, {
    recurrenceRule: serializeRule(rule),
    scheduledDate: newStart,
  });

  const children = await getDb().todos.where("recurrenceParentId").equals(templateId).toArray();
  for (const child of children) {
    if (child.status !== "open" || child.deletedAt) continue;
    const occurrence = parseOccurrenceId(child.id);
    if (!occurrence || occurrence.date < newStart) continue;
    const stillOnRule =
      occurrencesBetween(rule, newStart, occurrence.date, occurrence.date).length > 0;
    if (!stillOnRule) await remove("todo", child.id);
  }
}

/**
 * Delete a repeating series entirely. The template is tombstoned and every
 * materialized child's `recurrenceParentId` is cleared, so each survives as
 * an ordinary todo rather than continuing to wear a repeat marker for a
 * series that no longer exists — mirrors `deletePlace`'s cleanup of
 * `placeId` below.
 */
export async function deleteSeries(templateId: string): Promise<void> {
  const children = await getDb().todos.where("recurrenceParentId").equals(templateId).toArray();
  for (const child of children) {
    if (child.deletedAt) continue;
    await mutate("todo", child.id, { recurrenceParentId: null });
  }
  await remove("todo", templateId);
}

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
// Reminder presets (EI-106 P1)
// ---------------------------------------------------------------------------

export async function createReminderPreset(
  name: string,
  time: string,
  decoration: Partial<Pick<ReminderPreset, "color" | "emoji" | "iconUrl">> = {},
): Promise<string> {
  const db = getDb();
  const last = await db.reminderPresets.orderBy("position").last();
  const timestamp = now();
  const preset: ReminderPreset = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    time,
    position: positionAtEnd(last?.position ?? null),
    color: decoration.color ?? null,
    emoji: decoration.emoji ?? null,
    iconUrl: decoration.iconUrl ?? null,
  };
  return create("reminderPreset", preset);
}

export async function updateReminderPreset(
  id: string,
  patch: Partial<Omit<ReminderPreset, "id" | "ownerId" | "createdAt">>,
): Promise<void> {
  await mutate("reminderPreset", id, patch);
}

/**
 * Deletes a preset and touches nothing else. Deliberately unlike
 * `deleteLabel`, which strips the id from every `labelIds` array — a todo's
 * `reminderTime` is a literal `"HH:MM"` value the preset resolved to, not a
 * reference, so there is nothing to clean up. The reminder survives the
 * preset and simply renders as a plain time again (EI-106 decision 4).
 */
export async function deleteReminderPreset(id: string): Promise<void> {
  await remove("reminderPreset", id);
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
// Day notes
// ---------------------------------------------------------------------------

/**
 * Deterministic id for a day's notes — one row per calendar day.
 *
 * See `dayNoteSchema` (`lib/schema.ts`) for why this breaks the UUIDv7 rule:
 * two offline devices journaling the same day must collide on one entity so
 * field-level LWW can pick a `body`, rather than producing two rows nothing
 * merges.
 */
export const dayNoteId = (date: CivilDate) => `daynote:${date}`;

/**
 * Write a day's notes, creating the row on first use.
 *
 * Deliberately does NOT create a row for an empty body: opening a day and
 * closing it without typing must leave nothing behind, or every day anyone
 * ever glanced at becomes a synced row and a sticky-note icon in the header.
 *
 * Clearing a note writes `body: ""` rather than a tombstone — the id is
 * deterministic and would be recreated the next time that day is opened, so a
 * `deletedAt` would only buy a resurrect-vs-tombstone race. `useDayNotes`
 * treats a blank body as "no note", which is what makes that work.
 */
export async function setDayNote(date: CivilDate, body: string): Promise<void> {
  const id = dayNoteId(date);
  const existing = await getDb().dayNotes.get(id);

  if (existing) {
    if (existing.body === body) return;
    await mutate("dayNote", id, { body, deletedAt: null });
    return;
  }

  if (body.trim() === "") return;

  const timestamp = now();
  const note: DayNote = {
    id,
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    date,
    body,
  };
  await create("dayNote", note);
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/**
 * A saved location — see `placeSchema` (`lib/schema.ts`).
 *
 * `address` is still whatever text the caller has: a hand-typed address is a
 * first-class case, not a degraded one, and must keep working with no network
 * (EI-83). `google` carries the extra fields when the address did come from a
 * Places lookup.
 *
 * Deliberately one write, not `createPlace(...)` followed by
 * `updatePlace(id, {googlePlaceId, lat, lng})`: two writes would produce two
 * outbox entries and two sync pushes for a single user action, and every
 * reader would briefly see a place with an address and no coordinates.
 */
export async function createPlace(
  name: string,
  address: string,
  google: Partial<Pick<Place, "googlePlaceId" | "lat" | "lng">> = {},
): Promise<string> {
  const timestamp = now();
  const place: Place = {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    address,
    googlePlaceId: google.googlePlaceId ?? null,
    lat: google.lat ?? null,
    lng: google.lng ?? null,
  };
  return create("place", place);
}

export async function updatePlace(
  id: string,
  patch: Partial<Omit<Place, "id" | "ownerId" | "createdAt">>,
): Promise<void> {
  await mutate("place", id, patch);
}

/** Delete a place and clear it from every todo that referenced it — the todo
 * keeps its free-text `location`, so nothing about it disappears, only the
 * saved-place link. Mirrors `deleteLabel`'s cleanup of `labelIds`. */
export async function deletePlace(id: string): Promise<void> {
  const db = getDb();
  const linked = await db.todos.where("placeId").equals(id).toArray();
  for (const todo of linked) {
    await mutate("todo", todo.id, { placeId: null });
  }
  await remove("place", id);
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

/** The default tab record, built fresh so seeding and repair cannot drift.
 * Takes `ownerId` as a parameter rather than resolving it internally so this
 * stays a pure builder — the caller decides whose seed this is. */
function defaultTabRecord(timestamp: string, ownerId: string): Tab {
  return {
    id: DEFAULT_TAB_ID,
    ownerId,
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
 *
 * **Every seed row goes through `seedWrite()` (real outbox entry, `SEED_HLC`)
 * — never a raw Dexie `put`.** A raw `put` was the root cause of a live
 * data-loss incident: with no outbox entry, these rows' first-ever sync
 * write was `adoptLocalData`'s later `{ownerId, updatedAt}` patch, which the
 * server received as a genuinely partial create and synthesized placeholder
 * values for (`"Untitled"` names, `null` tabIds) — see `src/lib/sync/
 * merge.ts`'s `FLOOR_HLC` note. `SEED_HLC` closes this at the source: a
 * fresh seed populates an empty server and loses every field to any real
 * edit on an established one, so it can never again produce a partial
 * server-side create.
 */
export async function seedIfEmpty(): Promise<void> {
  const db = getDb();
  const timestamp = now();
  const positions = positionsBetween(null, null, SEED_LISTS.length);
  const ownerId = getCurrentOwnerId();

  await db.transaction("rw", db.lists, db.tabs, db.settings, db.outbox, async () => {
    if ((await db.lists.count()) > 0) return;

    await seedWrite({
      kind: "tab",
      key: DEFAULT_TAB_ID,
      row: defaultTabRecord(timestamp, ownerId),
    });

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
      await seedWrite({ kind: "list", key: list.id, row: list });
    }

    await seedWrite({
      kind: "settings",
      key: LOCAL_OWNER_ID,
      row: {
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
        visibleStatuses: ["open"],
        showWeekends: true,
        fontPairing: DEFAULT_FONT_PAIRING,
        theme: DEFAULT_THEME_MODE,
        displayName: "",
        avatarKind: DEFAULT_AVATAR_KIND,
        avatarInitials: "",
        avatarEmoji: "",
        avatarImage: "",
        activeTabId: DEFAULT_TAB_ID,
        backlogWidth: null,
        backlogCollapsed: false,
        overflowWidth: null,
        overflowCollapsed: false,
        splitRatio: null,
        splitCollapsed: "none",
        // False, not true: a fresh account still needs the P3 first-run seed
        // to actually write the five default presets. Seeding it true here
        // would skip that seed entirely on every new sign-up.
        reminderPresetsSeeded: false,
        updatedAt: timestamp,
      },
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
 * The tab (if missing) goes through `seedWrite()` — same `SEED_HLC` reasoning
 * as `seedIfEmpty`. The legacy `tabId` backfill is a real, local decision
 * about an existing row (not a first-run guess), so it goes through ordinary
 * `mutate()` with a real HLC — outside the tab-creation transaction, since
 * `mutate()` opens its own. That's also new: it used to write straight to
 * Dexie with no outbox entry at all, so the repair never reached other
 * devices and a synced peer's `FLOOR_HLC` pull could reset it right back to
 * `null` before this session's `merge.ts` fix.
 *
 * Idempotent — deterministic id with `put`, and the list pass is a no-op once
 * every list has a tab.
 */
export async function ensureDefaultTab(): Promise<number> {
  const db = getDb();

  await db.transaction("rw", db.tabs, db.outbox, async () => {
    if (!(await db.tabs.get(DEFAULT_TAB_ID))) {
      await seedWrite({
        kind: "tab",
        key: DEFAULT_TAB_ID,
        row: defaultTabRecord(now(), getCurrentOwnerId()),
      });
    }
  });

  // Truthiness, not `=== null`: legacy rows read the field back undefined.
  const orphaned = (await db.lists.toArray()).filter(
    (list) => !list.deletedAt && !list.isBacklog && !list.tabId,
  );
  for (const list of orphaned) {
    await mutate("list", list.id, { tabId: DEFAULT_TAB_ID });
  }

  return orphaned.length;
}

/** name, time, emoji — in seeded order. */
const SEED_REMINDER_PRESETS: readonly [string, string, string][] = [
  ["Morning", "08:00", "🌅"],
  ["Lunchtime", "12:30", "🥪"],
  ["Afternoon", "15:00", "☕"],
  ["End of day", "17:00", "🌇"],
  ["Evening", "20:00", "🌙"],
];

const seedReminderPresetId = (slug: string) => `seed:reminderpreset:${slug}`;

/**
 * Writes the five default reminder presets once per account, ever.
 *
 * Runs on every boot, like `ensureDefaultTab` — NOT folded into
 * `seedIfEmpty`, because that only fires for a genuinely empty database
 * (`lists.count() === 0`). An account that existed before EI-106 shipped has
 * lists already, so it would never reach this seed if it lived there; a
 * device that boots after the upgrade still needs it once.
 *
 * Guarded by `settings.reminderPresetsSeeded`, not an empty-`reminderPresets`
 * check — deleting all five deliberately must not resurrect them on the next
 * boot (EI-106 decision 6). Deterministic ids (`seed:reminderpreset:<slug>`)
 * so two devices independently reaching "not yet seeded" before their first
 * sync converge on the same five rows rather than creating ten.
 */
export async function seedReminderPresetsIfNeeded(): Promise<void> {
  const db = getDb();
  const ownerId = getCurrentOwnerId();

  await db.transaction("rw", db.reminderPresets, db.settings, db.outbox, async () => {
    const settings = await db.settings.get(LOCAL_OWNER_ID);
    // No settings row yet is NOT "not seeded" — it means seedIfEmpty()
    // hasn't run (or hasn't finished) on this boot. mutateSettings() below
    // is `db.settings.update()`, a silent no-op against a row that doesn't
    // exist, so seeding now would write five presets, never manage to flip
    // the flag, and re-seed every subsequent boot. Wait for a settings row
    // instead — useBootstrap()'s chain always creates one before this runs.
    if (!settings) return;
    if (settings.reminderPresetsSeeded) return;

    const timestamp = now();
    const positions = positionsBetween(null, null, SEED_REMINDER_PRESETS.length);
    for (const [i, [name, time, emoji]] of SEED_REMINDER_PRESETS.entries()) {
      await seedWrite({
        kind: "reminderPreset",
        key: seedReminderPresetId(name.toLowerCase().replace(/\s+/g, "-")),
        row: {
          id: seedReminderPresetId(name.toLowerCase().replace(/\s+/g, "-")),
          ownerId,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          name,
          time,
          position: positions[i],
          color: null,
          emoji,
          iconUrl: null,
        },
      });
    }

    // A real, decisive fact ("this device just seeded"), not a starting
    // guess — ordinary mutateSettings(), not seedWrite()'s SEED_HLC. It must
    // not lose to a later write the way a seed value deliberately does.
    await mutateSettings(LOCAL_OWNER_ID, { reminderPresetsSeeded: true });
  });
}

// `repairDuplicateLists` was removed here (see the commit that deleted it).
// It hard-deleted any two live lists sharing a name — an ordinary, legal
// state (e.g. "Groceries" on a Personal tab and "Groceries" on a Work tab) —
// with no tombstone and no outbox entry, so the deletion never reached other
// devices and the *next* pull could resurrect the "duplicate" only for the
// next boot to delete it again. The race it existed to guard against
// (StrictMode's double-invoked effect racing two `seedIfEmpty()` calls past
// the emptiness check) is already prevented by that check running INSIDE
// the transaction, combined with `seedIfEmpty`'s deterministic ids.
