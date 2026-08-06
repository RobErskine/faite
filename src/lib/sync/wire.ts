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

/**
 * Every kind that syncs, `settings` included (EI-60). `settings` is a
 * singleton with no `id` column — its Drizzle/Dexie primary key is
 * `ownerId` itself, and the client's Dexie row is *permanently* pinned to
 * `LOCAL_OWNER_ID` (never adopted into a real account, see
 * ARCHITECTURE §2.12) — so it needs two things the other five kinds don't:
 * `SETTINGS_ENTITY_ID` as a wire-level stand-in for "the one settings row",
 * and `SETTINGS_SYNCED_FIELDS` to keep device-local fields (`activeTabId`)
 * off the wire entirely.
 */
export type SyncKind = EntityKind;

// `as const` (not just `readonly SyncKind[]`) so consumers that need a
// literal tuple — `z.enum(SYNC_KINDS)` in `routes.ts` — get one without a cast.
export const SYNC_KINDS = [
  "todo",
  "list",
  "label",
  "project",
  "tab",
  "settings",
] as const satisfies readonly SyncKind[];

/**
 * Fixed stand-in `entityId` for all settings wire traffic. Settings has no
 * natural per-row id (there's exactly one row per Durable Object), so the
 * server overrides whatever `entityId` a push entry carries to this
 * constant, and emits it on pull — see `src/server/sync/push.ts` and
 * `src/server/user-do.ts`'s `pull()`. Neither side needs to know or agree
 * on the *client's* internal `LOCAL_OWNER_ID` value; this is purely a wire
 * sentinel, resolved to each side's own local identity independently
 * (`LOCAL_OWNER_ID` in Dexie, the authenticated session user in the DO).
 */
export const SETTINGS_ENTITY_ID = "settings";

/**
 * The only settings fields that sync. `activeTabId` is deliberately
 * excluded, permanently: it's device view-state (which tab this browser
 * has open), not account state, and it's the highest-frequency writer
 * (`board.tsx` writes it on every tab switch) — keeping it off the wire is
 * what keeps a tab switch from ever touching the outbox at all.
 */
export const SETTINGS_SYNCED_FIELDS: ReadonlySet<string> = new Set([
  "timezone",
  "workdaysOnly",
  "workdays",
  "overflowAfterDays",
  "visibleDays",
  "fontPairing",
  "theme",
  "displayName",
  "avatarKind",
  "avatarInitials",
  "avatarEmoji",
  "avatarImage",
]);

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
 *
 * For `settings`, also enforces `SETTINGS_SYNCED_FIELDS` on the way OUT, not
 * just `sanitizePatch`'s enforcement on the way in. Without this,
 * `activeTabId` — a real column that's simply never written server-side —
 * would ride along in every pull as `null` (via `FLOOR_HLC`, since it has no
 * clock), and once a device's local pending edit for it clears, `null`
 * would win the merge outright and silently reset which tab is showing.
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
    if (kind === "settings" && !SETTINGS_SYNCED_FIELDS.has(field)) continue;
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
