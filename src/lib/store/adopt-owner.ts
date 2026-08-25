import type { EntityKind } from "@/lib/schema";
import { clearSyncCursors } from "@/lib/sync/cursor";
import { getDb } from "./db";
import { enqueue, now } from "./mutate";
import {
  clearBoundOwnerId,
  getBoundOwnerId,
  LOCAL_OWNER_ID,
  setBoundOwnerId,
} from "./owner";

type RecordTable =
  | "todos"
  | "lists"
  | "labels"
  | "projects"
  | "tabs"
  | "dayNotes"
  | "places"
  | "todoEvents"
  | "reminderPresets"
  | "attachments";

/**
 * Every id-keyed syncable table. **A new sync kind must be added here**, and
 * nothing will tell you if it isn't: the omission type-checks cleanly and
 * fails only as data — rows written before sign-in keep `LOCAL_OWNER_ID`
 * forever and push under the wrong owner, and `resetLocalDataForNewOwner`
 * leaves them behind for the next account to inherit.
 */
const TABLES: Array<{ table: RecordTable; kind: EntityKind }> = [
  { table: "todos", kind: "todo" },
  { table: "lists", kind: "list" },
  { table: "labels", kind: "label" },
  { table: "projects", kind: "project" },
  { table: "tabs", kind: "tab" },
  { table: "dayNotes", kind: "dayNote" },
  { table: "places", kind: "place" },
  { table: "todoEvents", kind: "todoEvent" },
  { table: "reminderPresets", kind: "reminderPreset" },
  { table: "attachments", kind: "attachment" },
];

async function adoptTable(
  table: RecordTable,
  kind: EntityKind,
  newOwnerId: string,
): Promise<void> {
  const db = getDb();
  const rows = (await db[table].toArray()).filter(
    (r) => r.ownerId === LOCAL_OWNER_ID,
  );

  for (const row of rows) {
    const stamped = { ownerId: newOwnerId, updatedAt: now() };
    // Union table type across the loop; mutate()'s TABLE_BY_KIND dispatch has
    // the same shape and takes the same escape hatch for the same reason.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[table] as any).update(row.id, stamped);
    // `enqueue` (not a hand-rolled row) so `hlc` is a real, monotone HLC
    // stamp — a hand-rolled `hlc: now()` here is exactly how this outbox
    // entry drifted into an ISO string that would have won every LWW
    // comparison forever. See hlc-core.ts's `normalizeLegacyHlc`.
    await db.outbox.add(enqueue(kind, row.id, stamped));
  }
}

export type AdoptionResult =
  /** Rewrote this device's LOCAL_OWNER_ID rows to the signed-in user. */
  | "adopted"
  /** This device was already adopted into this same account — no-op. */
  | "already-bound"
  /** A DIFFERENT account signed in on a device already bound to someone else. */
  | "different-user";

/**
 * One-time backfill: rewrites every row in `TABLES` above carrying the
 * placeholder `LOCAL_OWNER_ID` to the real, signed-in user's
 * id, and remembers the binding (`localStorage`, mirroring the font/theme
 * bridge in layout.tsx) so it never repeats. New writes after this call use
 * `getCurrentOwnerId()` (owner.ts), so this genuinely only has to run once.
 *
 * `settings` is deliberately excluded. It is a per-DEVICE singleton keyed on
 * `ownerId` as its Dexie PRIMARY KEY — Dexie cannot change a primary key with
 * `update()`, and `useSettings()`/`mutateSettings()` are hardcoded to look it
 * up under `LOCAL_OWNER_ID` throughout the app (board.tsx, the settings
 * sheet, the command palette). Re-keying it would silently orphan every read
 * and write of settings the moment someone signs in. It stays local-device
 * scoped forever; P3's sync layer will need its own answer for settings
 * regardless, since "one row per device" was never going to survive sync
 * unchanged.
 *
 * Every other table carries no such coupling: nothing filters a read by
 * `ownerId` (see hooks.ts — `useTodos`/`useLists`/etc. all read the whole
 * table), so rewriting it is free.
 */
export async function adoptLocalData(newOwnerId: string): Promise<AdoptionResult> {
  const bound = getBoundOwnerId();
  if (bound === newOwnerId) return "already-bound";
  if (bound && bound !== newOwnerId) return "different-user";

  const db = getDb();
  await db.transaction(
    "rw",
    [
      db.todos,
      db.lists,
      db.labels,
      db.projects,
      db.tabs,
      db.dayNotes,
      db.places,
      db.todoEvents,
      db.reminderPresets,
      db.attachments,
      db.outbox,
    ],
    async () => {
      for (const { table, kind } of TABLES) {
        await adoptTable(table, kind, newOwnerId);
      }
    },
  );

  setBoundOwnerId(newOwnerId);
  return "adopted";
}

/**
 * A different account signed in on a device already bound to someone else.
 *
 * Rather than merge two people's boards under one id, this wipes the LOCAL
 * data only (never the remote account) so the caller can reseed fresh for the
 * new owner. Clears the binding too, so the next `adoptLocalData` call for the
 * new owner does not immediately read back "different-user" against an empty
 * database.
 */
export async function resetLocalDataForNewOwner(): Promise<void> {
  const db = getDb();
  await db.transaction(
    "rw",
    [
      db.todos,
      db.lists,
      db.labels,
      db.projects,
      db.tabs,
      db.dayNotes,
      db.places,
      db.todoEvents,
      db.reminderPresets,
      db.attachments,
      db.settings,
      db.outbox,
    ],
    async () => {
      await db.todos.clear();
      await db.lists.clear();
      await db.labels.clear();
      await db.projects.clear();
      await db.tabs.clear();
      await db.dayNotes.clear();
      await db.places.clear();
      await db.todoEvents.clear();
      await db.reminderPresets.clear();
      await db.attachments.clear();
      await db.settings.clear();
      await db.outbox.clear();
    },
  );
  clearBoundOwnerId();
  // The old owner's pull cursor is meaningless against the new owner's DO —
  // reusing it would silently skip the new owner's earliest rows. NOT called
  // on a plain sign-out: a returning same-account sign-in should resume from
  // where it left off, not re-pull everything.
  clearSyncCursors();
}
