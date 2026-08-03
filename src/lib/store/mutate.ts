import { uuidv7 } from "uuidv7";
import type { EntityKind, OutboxEntry } from "@/lib/schema";
import { getDb } from "./db";

/**
 * The single write path.
 *
 * Every mutation in the app goes through here, and every mutation appends a
 * field-level patch to the outbox. Nothing drains the outbox until P3 — that is
 * the point. Building this now means P3 attaches a transport to an existing
 * change log instead of retrofitting change tracking into an app that never had
 * it, which would be a rewrite.
 *
 * Patches record CHANGED FIELDS, not whole records, so the P3 merge can be
 * field-level: two devices editing different fields of the same todo must both
 * survive rather than one clobbering the other.
 */

/** Tables that carry a syncable `id` primary key. */
type RecordTable = Exclude<EntityKind, "settings">;

const TABLE_BY_KIND: Record<RecordTable, "todos" | "lists" | "labels" | "projects" | "tabs"> = {
  todo: "todos",
  list: "lists",
  label: "labels",
  project: "projects",
  tab: "tabs",
};

export function newId(): string {
  return uuidv7();
}

export function now(): string {
  return new Date().toISOString();
}

/**
 * Stand-in for a Hybrid Logical Clock.
 *
 * P1 uses a wall-clock ISO string, which is enough while there is exactly one
 * writer. P3 replaces this with a real HLC so clock skew between devices cannot
 * reorder causally related edits. The field exists now so the outbox shape does
 * not change when that lands.
 */
function nextHlc(): string {
  return now();
}

function enqueue(
  kind: EntityKind,
  entityId: string,
  patch: Record<string, unknown>,
): OutboxEntry {
  return {
    id: newId(),
    kind,
    entityId,
    patch,
    hlc: nextHlc(),
    createdAt: now(),
  };
}

/**
 * Apply a patch to one record and record it in the outbox, atomically.
 *
 * Both writes share a transaction so a crash can never leave the local store
 * ahead of the change log — that would silently lose an edit at sync time.
 */
export async function mutate<K extends RecordTable>(
  kind: K,
  entityId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const table = TABLE_BY_KIND[kind];
  const stamped = { ...patch, updatedAt: now() };

  await db.transaction("rw", db[table], db.outbox, async () => {
    await db[table].update(entityId, stamped);
    await db.outbox.add(enqueue(kind, entityId, stamped));
  });
}

/** Insert a new record and record the full row as the initial patch. */
export async function create<K extends RecordTable>(
  kind: K,
  record: { id: string } & Record<string, unknown>,
): Promise<string> {
  const db = getDb();
  const table = TABLE_BY_KIND[kind];

  await db.transaction("rw", db[table], db.outbox, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db[table].add(record as any);
    await db.outbox.add(enqueue(kind, record.id, record));
  });

  return record.id;
}

/**
 * Soft delete.
 *
 * Never a hard delete: a row removed locally leaves nothing to tell the other
 * device it was deleted, so the record would simply reappear on the next pull.
 * A tombstone survives the merge.
 */
export async function remove<K extends RecordTable>(
  kind: K,
  entityId: string,
): Promise<void> {
  await mutate(kind, entityId, { deletedAt: now() });
}

/** Undo a soft delete. */
export async function restore<K extends RecordTable>(
  kind: K,
  entityId: string,
): Promise<void> {
  await mutate(kind, entityId, { deletedAt: null });
}

/** Settings are a singleton keyed by owner, so they bypass the id-based path. */
export async function mutateSettings(
  ownerId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const stamped = { ...patch, updatedAt: now() };

  await db.transaction("rw", db.settings, db.outbox, async () => {
    await db.settings.update(ownerId, stamped);
    await db.outbox.add(enqueue("settings", ownerId, stamped));
  });
}

/** Pending change count — surfaced in the UI as a sync indicator at P3. */
export async function pendingCount(): Promise<number> {
  return getDb().outbox.count();
}
