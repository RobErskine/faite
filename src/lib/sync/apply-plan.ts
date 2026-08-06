import type { OutboxEntry } from "@/lib/schema";
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import { hydrateRemoteRow } from "./hydrate";
import { mergeRecord } from "./merge";
import type { SyncKind, WireChange } from "./wire";

/**
 * Pure decision layer for applying a pull page locally. `src/lib/store/
 * apply-remote.ts` is the thin Dexie shell that reads/writes around this —
 * this file owns every decision about what those writes should be, so it's
 * testable without IndexedDB.
 *
 * Deliberately NOT `mutate()`-shaped: `mutate()` appends an outbox entry and
 * force-stamps `updatedAt`, both of which would be wrong here — appending
 * would echo a remote change straight back into the next push forever, and
 * `updatedAt` is itself a synced field with a real server clock, so
 * inventing a local value would permanently diverge it for no reason.
 */

export type LocalWrite =
  | { op: "put"; kind: SyncKind; entityId: string; row: Record<string, unknown> }
  | { op: "update"; kind: SyncKind; entityId: string; changes: Record<string, unknown> };

export interface ApplyPlan {
  writes: LocalWrite[];
  conflicts: Array<{ entityId: string; fields: string[] }>;
  skipped: Array<{ entityId: string; reason: string }>;
}

/**
 * `locals.get(entityId)` — the current local row, or `undefined` if the
 * entity doesn't exist locally yet. `undefined` (not a missing map entry) is
 * the caller's signal that it looked and found nothing — `apply-remote.ts`
 * always populates one entry per entity referenced in `changes`.
 */
export function planApply(
  changes: WireChange[],
  pending: OutboxEntry[],
  locals: Map<string, Record<string, unknown> | undefined>,
  ctx: { ownerId: string; now: string },
): ApplyPlan {
  const writes: LocalWrite[] = [];
  const conflicts: ApplyPlan["conflicts"] = [];
  const skipped: ApplyPlan["skipped"] = [];

  const order: string[] = [];
  const byEntity = new Map<string, { kind: SyncKind; entityId: string; changes: WireChange[] }>();
  for (const change of changes) {
    const key = `${change.kind}:${change.entityId}`;
    const group = byEntity.get(key);
    if (group) group.changes.push(change);
    else {
      byEntity.set(key, { kind: change.kind, entityId: change.entityId, changes: [change] });
      order.push(key);
    }
  }

  for (const key of order) {
    const { kind, entityId, changes: entityChanges } = byEntity.get(key)!;
    const local = locals.get(entityId);

    let apply: Record<string, unknown> = {};
    let entityConflicts: string[] = [];
    // Each field of one entity appears in exactly one WireChange
    // (`changesFromRow`'s partition invariant), so merging these results
    // can't collide — order between changes doesn't matter.
    for (const change of entityChanges) {
      const result = mergeRecord(local, pending, {
        entityId: change.entityId,
        patch: change.patch,
        hlc: change.hlc,
      });
      apply = { ...apply, ...result.apply };
      entityConflicts = [...entityConflicts, ...result.conflicts];
    }

    if (entityConflicts.length > 0) conflicts.push({ entityId, fields: entityConflicts });
    // Every field lost (all still-pending local edits) — nothing to write,
    // not even an empty update.
    if (Object.keys(apply).length === 0) continue;

    if (local === undefined) {
      // Settings is permanently pinned to LOCAL_OWNER_ID (never adopted
      // into a real account, ARCHITECTURE §2.12) — the signed-in user's id
      // in `ctx.ownerId` would be wrong here.
      const hydrateCtx = kind === "settings" ? { ownerId: LOCAL_OWNER_ID, now: ctx.now } : ctx;
      const hydrated = hydrateRemoteRow(kind, entityId, apply, hydrateCtx);
      if (!hydrated.ok) {
        skipped.push({ entityId, reason: hydrated.reason });
        continue;
      }
      writes.push({ op: "put", kind, entityId, row: hydrated.row });
    } else {
      // Defensive: `changesFromRow` never emits `id`, but Dexie throws if a
      // primary key shows up in an `update()` changes object.
      const changes = { ...apply };
      delete changes.id;
      writes.push({ op: "update", kind, entityId, changes });
    }
  }

  return { writes, conflicts, skipped };
}
