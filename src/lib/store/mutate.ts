import { uuidv7 } from "uuidv7";
import type { EntityKind, OutboxEntry } from "@/lib/schema";
import { getNodeId, localEvent } from "@/lib/sync/hlc";
import { SEED_HLC } from "@/lib/sync/wire";
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

/** Every syncable Dexie table, keyed by kind. `seedWrite` is the one caller
 * that needs the `settings` entry — `mutate()`/`create()` stay narrowed to
 * `RecordTable` via their own generic bound. */
const TABLE_BY_KIND: Record<
  EntityKind,
  "todos" | "lists" | "labels" | "projects" | "tabs" | "dayNotes" | "settings"
> = {
  todo: "todos",
  list: "lists",
  label: "labels",
  project: "projects",
  tab: "tabs",
  dayNote: "dayNotes",
  settings: "settings",
};

export function newId(): string {
  return uuidv7();
}

export function now(): string {
  return new Date().toISOString();
}

const LAST_HLC_KEY = "faite:last-hlc";

// Memoized for the same reason hlc.ts memoizes the node id: a localStorage
// throw (privacy modes) should still leave this session internally
// monotonic instead of restarting from a null "last" on every mutation.
let cachedLastHlc: string | null = null;

function getLastHlc(): string | null {
  if (cachedLastHlc !== null) return cachedLastHlc;
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(LAST_HLC_KEY);
  } catch {
    return null;
  }
}

function setLastHlc(hlc: string): void {
  cachedLastHlc = hlc;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_HLC_KEY, hlc);
  } catch {
    // Best effort; the in-memory cache above still keeps this page's writes
    // monotonic even if it can't survive a reload.
  }
}

/**
 * Real HLC, per P3 (`src/lib/sync/hlc.ts`, EI-47).
 *
 * Outbox rows written before this change hold plain wall-clock ISO strings
 * instead of `<phys>:<counter>:<nodeId>`. They sort AFTER every real HLC
 * (`"2026-…"` > `"019f…"` lexicographically) — the opposite of harmless: an
 * un-normalized legacy stamp would win every LWW comparison forever. See
 * `normalizeLegacyHlc` (`hlc-core.ts`) and `normalizeOutboxHlcs`
 * (`normalize-outbox.ts`), which run once before the first drain.
 */
function nextHlc(): string {
  const hlc = localEvent(getLastHlc(), Date.now(), getNodeId());
  setLastHlc(hlc);
  return hlc;
}

function enqueueAt(
  kind: EntityKind,
  entityId: string,
  patch: Record<string, unknown>,
  hlc: string,
): OutboxEntry {
  return { id: newId(), kind, entityId, patch, hlc, createdAt: now() };
}

/**
 * Exported for `adopt-owner.ts`, which needs to append an outbox entry
 * outside `mutate()`'s own transaction. Using this (instead of hand-rolling
 * the row) is what keeps the `hlc` a real, monotone stamp — a hand-rolled
 * copy is exactly how that drifted into `hlc: now()` before.
 */
export function enqueue(
  kind: EntityKind,
  entityId: string,
  patch: Record<string, unknown>,
): OutboxEntry {
  return enqueueAt(kind, entityId, patch, nextHlc());
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

export interface SeedRecord {
  kind: EntityKind;
  /** Dexie primary key AND the outbox entry's `entityId` — the row's `id`
   * for every kind except `settings`, whose Dexie key is `ownerId`. */
  key: string;
  row: Record<string, unknown>;
}

/**
 * One first-run write: the row itself (`put`, so a re-entrant seed with the
 * same deterministic id is an idempotent upsert, matching `seedIfEmpty`'s
 * existing re-entrancy contract) plus ONE full-row outbox entry stamped at
 * `SEED_HLC` — never a real, monotone HLC.
 *
 * A seed has no real provenance: it's this device's *starting guess*, not a
 * decision a person made. `SEED_HLC` (`wire.ts`) encodes exactly that —
 * it populates a genuinely empty server, and loses every field to any real
 * edit on an established one, so a second device's fresh seed can never
 * overwrite a renamed board. Deliberately does NOT call `nextHlc()`/advance
 * `faite:last-hlc` — folding a seed into this device's HLC chain would make
 * a later real edit's clock depend on when the device happened to seed, for
 * no benefit.
 *
 * MUST be called inside an existing `rw` transaction whose scope covers the
 * target table and `outbox` — it opens none of its own. That's why this
 * can't reuse `create()`: `create()` opens its own transaction and uses
 * `add()`, which throws on the deterministic-id re-entry seeding depends on.
 */
export async function seedWrite(record: SeedRecord): Promise<void> {
  const db = getDb();
  const table = TABLE_BY_KIND[record.kind];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db[table] as any).put(record.row);
  await db.outbox.add(enqueueAt(record.kind, record.key, record.row, SEED_HLC));
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
