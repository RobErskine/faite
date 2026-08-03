import type {
  CivilDate,
  Label,
  List,
  Priority,
  Project,
  Todo,
  TodoStatus,
} from "@/lib/schema";
import { positionAtEnd, positionsBetween } from "@/lib/ordering";
import { getDb } from "./db";
import { create, mutate, newId, now, remove, restore } from "./mutate";

/**
 * CRUD for every entity, expressed on top of mutate().
 *
 * Nothing here touches Dexie's write API directly — every mutation routes
 * through mutate()/create()/remove() so the outbox always sees it.
 */

/**
 * The local user id.
 *
 * P1 is single-user with no auth, so this is a fixed value. P2 replaces it with
 * the authenticated user's id; every record already carries `ownerId`, so that
 * swap does not require a migration.
 */
export const LOCAL_OWNER_ID = "local-user";

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
    ownerId: LOCAL_OWNER_ID,
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
 * Set completion state.
 *
 * `dropped` ("won't do") is deliberately a separate status from `done` — the
 * distinction is the whole point of the Overflow column's triage.
 */
export async function setTodoStatus(id: string, status: TodoStatus): Promise<void> {
  await mutate("todo", id, {
    status,
    completedAt: status === "open" ? null : now(),
  });
}

/** Schedule onto a day. Does NOT clear listId or labels — membership is kept. */
export async function scheduleTodo(
  id: string,
  scheduledDate: CivilDate | null,
  position?: string,
): Promise<void> {
  await mutate("todo", id, {
    scheduledDate,
    ...(position ? { position } : {}),
  });
}

/** Move into a list column, clearing any schedule so it returns to planning. */
export async function moveTodoToList(
  id: string,
  listId: string | null,
  position?: string,
): Promise<void> {
  await mutate("todo", id, {
    listId,
    scheduledDate: null,
    ...(position ? { position } : {}),
  });
}

export async function reorderTodo(id: string, position: string): Promise<void> {
  await mutate("todo", id, { position });
}

export const deleteTodo = (id: string) => remove("todo", id);
export const restoreTodo = (id: string) => restore("todo", id);

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function createList(
  name: string,
  decoration: Partial<Pick<List, "color" | "emoji" | "iconUrl">> = {},
): Promise<string> {
  const db = getDb();
  const last = await db.lists.orderBy("position").last();
  const timestamp = now();
  const list: List = {
    id: newId(),
    ownerId: LOCAL_OWNER_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name,
    isBacklog: false,
    position: positionAtEnd(last?.position ?? null),
    tabId: null,
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
 */
export async function deleteList(id: string): Promise<void> {
  const db = getDb();
  const list = await db.lists.get(id);
  if (!list || list.isBacklog) return;

  const backlog = await getBacklog();
  const orphans = await db.todos.where("listId").equals(id).toArray();
  for (const todo of orphans) {
    await mutate("todo", todo.id, { listId: backlog?.id ?? null });
  }
  await remove("list", id);
}

export async function getBacklog(): Promise<List | undefined> {
  const lists = await getDb().lists.toArray();
  return lists.find((l) => l.isBacklog && !l.deletedAt);
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
    ownerId: LOCAL_OWNER_ID,
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
    ownerId: LOCAL_OWNER_ID,
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

/**
 * Create the default lists and settings on first run.
 *
 * Idempotent — safe to call on every mount.
 */
export async function seedIfEmpty(): Promise<void> {
  const db = getDb();
  const existing = await db.lists.count();
  if (existing > 0) return;

  const timestamp = now();
  const names = ["Backlog", "Brain Dump", "Grocery List", "To Buy", "To Read"];
  const positions = positionsBetween(null, null, names.length);

  await db.transaction("rw", db.lists, db.settings, db.outbox, async () => {
    for (const [i, name] of names.entries()) {
      const list: List = {
        id: newId(),
        ownerId: LOCAL_OWNER_ID,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        name,
        isBacklog: i === 0,
        position: positions[i],
        tabId: null,
        color: null,
        emoji: null,
        iconUrl: null,
      };
      await db.lists.add(list);
    }

    await db.settings.put({
      ownerId: LOCAL_OWNER_ID,
      // Use the device's zone as the starting point; user-editable in settings.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      workdaysOnly: false,
      workdays: [1, 2, 3, 4, 5],
      overflowAfterDays: 3,
      visibleDays: 7,
      updatedAt: timestamp,
    });
  });
}
