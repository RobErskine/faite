import type { OutboxEntry } from "@/lib/schema";
import { compareHlc } from "./hlc-core";
import { FLOOR_HLC } from "./wire";

/**
 * Field-level last-writer-wins merge — the correctness core of P3 (EI-47, D2).
 *
 * Pure: takes plain data, returns plain data, touches no Dexie. Per-field
 * clocks are never stored — the outbox already *is* the client's field-level
 * clock (`mutate.ts` writes one entry per mutation with `{patch, hlc}`, and
 * `patch` holds exactly the changed fields). So a field's local clock is the
 * `hlc` of the newest pending outbox entry whose patch mentions it; a field
 * with no pending entry is fully synced, and any remote change to it wins by
 * definition — UNLESS that remote change is `FLOOR_HLC` (see below), which
 * exists to *populate* a field the local row never had, never to overwrite
 * one it already has.
 *
 * `FLOOR_HLC` needs the one carve-out in this file. It marks a
 * server-synthesized value with no real provenance (`src/server/sync/
 * upsert.ts`'s NOT-NULL placeholders on a partial create) — sorts below every
 * real HLC by construction, but `remoteWins`'s `localHlc === null` branch
 * short-circuits *before* the two clocks are ever compared, so "no pending
 * entry -> remote wins" let a placeholder clobber an already-synced local
 * value with no HLC comparison involved at all. Found live: a fresh device's
 * placeholder-synthesizing partial create (seed rows written outside the
 * outbox — now fixed via `src/lib/store/mutate.ts`'s `seedWrite`) renamed an
 * established board's lists to "Untitled".
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
 * `local` drives every decision `pending` doesn't: whether a field is
 * "unsynced" (no pending entry touches it) is fully determined by `pending`,
 * but whether a `FLOOR_HLC` value is a legitimate *populate* or an illegal
 * *overwrite* can only be answered by looking at what the local row already
 * holds. A row with no pending entries and no local copy (a remote change for
 * a brand-new row) still falls out of the ordinary per-field rule — every
 * field has no local clock, so the whole patch applies — `FLOOR_HLC` fields
 * included, which is exactly how a remote create hydrates.
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

    // FLOOR_HLC may only fill in a field the local row doesn't already have a
    // value for — never overwrite one it does. `local[field] !== undefined`
    // (not `Object.hasOwn`, not `local !== undefined` alone) is deliberate:
    // a genuinely absent/undefined field (e.g. a pre-tabs row's `tabId`,
    // which reads back `undefined` — see `ensureDefaultTab`) must still be
    // populated, and a present `null` (`tabId: null` = Backlog pinned
    // everywhere, `deletedAt: null` = alive) must NOT be clobbered back to
    // whatever the server happened to default it to.
    if (remote.hlc === FLOOR_HLC && local !== undefined && local[field] !== undefined) {
      continue;
    }

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
