import type { OutboxEntry } from "@/lib/schema";
import { compareHlc } from "./hlc";

/**
 * Field-level last-writer-wins merge — the correctness core of P3 (EI-47, D2).
 *
 * Pure: takes plain data, returns plain data, touches no Dexie. Per-field
 * clocks are never stored — the outbox already *is* the client's field-level
 * clock (`mutate.ts` writes one entry per mutation with `{patch, hlc}`, and
 * `patch` holds exactly the changed fields). So a field's local clock is the
 * `hlc` of the newest pending outbox entry whose patch mentions it; a field
 * with no pending entry is fully synced, and any remote change to it wins by
 * definition.
 */

export interface RemoteChange {
  entityId: string;
  patch: Record<string, unknown>;
  hlc: string;
}

export interface MergeResult {
  /** Fields to write locally. Empty when the local copy wins outright. */
  apply: Record<string, unknown>;
  /** Fields where local won and must be re-pushed. */
  conflicts: string[];
}

/** Newest pending entry (for this row) whose patch touches `field`, or null if fully synced. */
function findLocalFieldHlc(pendingForRow: OutboxEntry[], field: string): string | null {
  let newest: OutboxEntry | null = null;
  for (const entry of pendingForRow) {
    if (!Object.hasOwn(entry.patch, field)) continue;
    if (newest === null || compareHlc(entry.hlc, newest.hlc) > 0) newest = entry;
  }
  return newest?.hlc ?? null;
}

/**
 * `local` is accepted for a complete (local, pending, remote) merge signature
 * but isn't consulted directly: whether a field is "unsynced" is fully
 * determined by `pending`, and a row with no pending entries and no local
 * copy (a remote change for a brand-new row) already falls out of the same
 * per-field rule — every field has no local clock, so the whole patch applies.
 */
export function mergeRecord(
  local: Record<string, unknown> | undefined,
  pending: OutboxEntry[],
  remote: RemoteChange,
): MergeResult {
  const pendingForRow = pending.filter((entry) => entry.entityId === remote.entityId);
  const apply: Record<string, unknown> = {};
  const conflicts: string[] = [];

  for (const field of Object.keys(remote.patch)) {
    const localHlc = findLocalFieldHlc(pendingForRow, field);
    const remoteWins = localHlc === null || compareHlc(remote.hlc, localHlc) > 0;

    if (!remoteWins) {
      conflicts.push(field);
      continue;
    }

    const remoteValue = remote.patch[field];
    // Dexie's update() reads an explicit `undefined` value as "delete this
    // key path" (§8) — never let one reach `apply`.
    if (remoteValue === undefined) continue;
    apply[field] = remoteValue;
  }

  return { apply, conflicts };
}
