import Dexie, { type EntityTable } from "dexie";
import type {
  DayNote,
  Label,
  List,
  OutboxEntry,
  Project,
  Settings,
  Tab,
  Todo,
} from "@/lib/schema";

/**
 * The local IndexedDB store.
 *
 * This is the ONLY thing the UI reads from. The server is never a render
 * dependency, which is what makes the app work offline, feel instant (no
 * request sits on the interaction path), and run unchanged inside a Capacitor
 * WebView later.
 */
export class FaiteDatabase extends Dexie {
  todos!: EntityTable<Todo, "id">;
  lists!: EntityTable<List, "id">;
  labels!: EntityTable<Label, "id">;
  projects!: EntityTable<Project, "id">;
  tabs!: EntityTable<Tab, "id">;
  dayNotes!: EntityTable<DayNote, "id">;
  settings!: EntityTable<Settings, "ownerId">;
  outbox!: EntityTable<OutboxEntry, "id">;

  constructor() {
    super("faite");
    this.version(1).stores({
      // Indexed fields only. Everything else is stored but unindexed.
      todos: "id, listId, projectId, scheduledDate, status, position, deletedAt",
      lists: "id, position, tabId, isBacklog, deletedAt",
      labels: "id, position, deletedAt",
      projects: "id, position, deletedAt",
      tabs: "id, position, deletedAt",
      settings: "ownerId",
      outbox: "id, kind, entityId, createdAt",
    });
    // Dexie MERGES versions — a later version declares only its delta, and the
    // stores above carry forward untouched. Restating them here would be
    // harmless but would also make it impossible to see what v2 actually added.
    this.version(2).stores({
      dayNotes: "id, date, deletedAt",
    });
    // `recurrenceParentId` indexed for `useRecurrenceChildren()` — every
    // materialized occurrence of a series is looked up by its template's id.
    this.version(3).stores({
      todos: "id, listId, projectId, scheduledDate, status, position, deletedAt, recurrenceParentId",
    });
  }
}

/**
 * Dexie opens an IndexedDB connection on construction, which does not exist
 * during SSR or the static export build. Instantiate lazily so importing this
 * module stays safe on the server.
 */
let instance: FaiteDatabase | null = null;

export function getDb(): FaiteDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("getDb() called outside the browser");
  }
  instance ??= new FaiteDatabase();
  return instance;
}

/** True when a local store is available (i.e. we are in the browser). */
export function canUseDb(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Drop and recreate the database. Test-only. */
export async function resetDbForTests(): Promise<void> {
  if (instance) {
    instance.close();
    await instance.delete();
    instance = null;
  }
  await getDb().open();
}
