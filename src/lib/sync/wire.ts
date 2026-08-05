import type { EntityKind } from "@/lib/schema";

/**
 * The P3 sync wire format (EI-46/EI-48). Shared, DOM-free contract between
 * the client outbox drain and the per-user Durable Object.
 *
 * DOM-free by contract, same rule as `hlc-core.ts`: import `./hlc-core` only,
 * never `./hlc` — `tsc -p tsconfig.worker.json` type-checks a whole imported
 * file under the worker's DOM-less `lib`, so one `localStorage` reference
 * anywhere in this module would poison every `src/server` importer.
 */

/** `settings` is excluded from P3 sync — see docs/SYNC.md's "Known traps". */
export type SyncKind = Exclude<EntityKind, "settings">;

export const SYNC_PROTOCOL_VERSION = 1 as const;

/**
 * Sorts below every real HLC (`compareHlc(FLOOR_HLC, anything real) < 0`) —
 * the clock a puller assigns to a column with no `field_clocks` row. That
 * happens only for server-synthesized NOT NULL placeholders on a partial
 * create (`src/server/sync/upsert.ts`), so a floor clock is correct by
 * construction: it loses to any pending local edit, and a field with no
 * pending edit was never locally unsynced, so adopting the server's
 * synthesized value is right either way.
 */
export const FLOOR_HLC = "000000000000:0000:server";

/**
 * Never crosses the wire in either direction. `version` and `id` are
 * server/identity-owned; `ownerId` is a function of which Durable Object a
 * request reached, not a synced field — see `src/server/sync/columns.ts`.
 */
export const SERVER_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "version",
  "id",
  "ownerId",
]);

// ---- push -------------------------------------------------------------

export interface PushEntry {
  /** The outbox entry id — the ACK key. Not the entity id. */
  id: string;
  kind: SyncKind;
  entityId: string;
  /** Field-level patch, JS-typed (arrays/booleans as-is, not SQL-coerced). */
  patch: Record<string, unknown>;
  /** One HLC governing every field in `patch`. */
  hlc: string;
}

export interface PushRequest {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  /** Pre-sorted by (hlc, createdAt, id) — see `src/lib/sync/drain.ts`. The
   * server does not re-sort; order only affects diagnostic fields. */
  entries: PushEntry[];
}

export type RejectReason =
  | "malformed-hlc"
  | "unknown-kind"
  | "empty-patch"
  | "patch-too-large";

export interface PushResponse {
  /**
   * Entry ids the DO PROCESSED — delete these locally. "Processed" is not
   * "applied": an entry whose every field lost the LWW comparison is still
   * acked, or a re-pushed duplicate (a lost response) could never clear.
   */
  acked: string[];
  /** Permanently unacceptable. Delete locally and log — retrying can't help. */
  rejected: Array<{ id: string; reason: RejectReason }>;
  /** DIAGNOSTIC ONLY. Never advance the pull cursor from this. */
  highestVersion: number;
  /** Fields the server refused because it held a newer value. Diagnostic —
   * no re-push machinery needed: the winning local entry is still pending by
   * construction, so it pushes again next cycle regardless. */
  conflicts: Array<{ entityId: string; fields: string[] }>;
}

// ---- pull -------------------------------------------------------------

/** Exactly `mergeRecord`'s `RemoteChange`, plus the routing `kind`. */
export interface WireChange {
  kind: SyncKind;
  entityId: string;
  patch: Record<string, unknown>;
  /** ONE hlc governing every field in `patch` — see `changesFromRow`. */
  hlc: string;
}

export interface PullResponse {
  protocol: typeof SYNC_PROTOCOL_VERSION;
  changes: WireChange[];
  /** Persist AFTER the local apply transaction commits, never before —
   * crash the other way round loses whatever the interrupted apply missed. */
  cursor: number;
  /** More rows remain above `cursor`; pull again immediately. */
  hasMore: boolean;
}

/**
 * One `WireChange` per DISTINCT hlc among a row's fields — the minimal
 * encoding that preserves `mergeRecord`'s per-field decision. Fields sharing
 * an hlc collapse into one change; that's a pure payload compression with no
 * semantic content, since `mergeRecord` would reach the same verdict either
 * way for fields carrying the same clock.
 *
 * Deliberately NOT "the row's max hlc for the whole row" — that inflates
 * every field's clock to the newest field's, letting a stale field silently
 * beat a newer local pending edit for a *different* field while
 * `mergeRecord` still reports `conflicts: []`. See `wire.test.ts`'s
 * `changesFromRow` anti-test, which pins this by asserting the row-max
 * alternative actually clobbers data.
 *
 * Columns with no clock (server-synthesized NOT NULL placeholders, see
 * `src/server/sync/upsert.ts`) are grouped under `FLOOR_HLC` rather than
 * omitted — omitting would make a remote create arrive at a device without
 * the row, missing fields, and unhydratable.
 */
export function changesFromRow(
  kind: SyncKind,
  entityId: string,
  row: Record<string, unknown>,
  clocks: Record<string, string>,
): WireChange[] {
  const groups = new Map<string, Record<string, unknown>>();

  for (const field of Object.keys(row)) {
    if (SERVER_ONLY_FIELDS.has(field)) continue;
    const hlc = clocks[field] ?? FLOOR_HLC;
    const group = groups.get(hlc);
    if (group) {
      group[field] = row[field];
    } else {
      groups.set(hlc, { [field]: row[field] });
    }
  }

  return Array.from(groups.entries()).map(([hlc, patch]) => ({
    kind,
    entityId,
    patch,
    hlc,
  }));
}
