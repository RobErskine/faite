import { isHlc } from "@/lib/sync/hlc-core";
import { SYNC_KINDS, type PushEntry, type RejectReason, type SyncKind } from "@/lib/sync/wire";
import { applyIncomingPatch, type FieldClockMap } from "./apply-patch";
import { sanitizePatch } from "./columns";

/**
 * Pure push-resolution pipeline: validate -> group by entity -> resolve each
 * entity's fields against its existing clocks. No storage I/O anywhere in
 * this file — `user-do.ts` owns reading `existingClocks`/writing the result,
 * this module owns every decision about what those writes should be. Kept
 * separate specifically so `round-trip.test.ts` can compose the real pipeline
 * without a Durable Object.
 */

export interface ValidatedEntry {
  id: string;
  kind: SyncKind;
  entityId: string;
  hlc: string;
  /** Sanitized (whitelisted against the schema), guaranteed non-empty. */
  patch: Record<string, unknown>;
}

export interface EntryRejection {
  id: string;
  reason: RejectReason;
}

const SYNC_KIND_SET = new Set<string>(SYNC_KINDS);

/**
 * Per-entry checks that need no storage: hlc shape, known kind, and a
 * non-empty patch after whitelisting. Rejecting here (rather than 400-ing the
 * whole request) means one malformed entry in a batch can't wedge every other
 * entry in it — `field_clocks` is the one surface a later client deploy can't
 * repair, so malformed HLCs must be unreachable from this side too, on top of
 * the client-side normalization in `normalize-outbox.ts`.
 */
export function validateEntries(entries: PushEntry[]): {
  accepted: ValidatedEntry[];
  rejected: EntryRejection[];
} {
  const accepted: ValidatedEntry[] = [];
  const rejected: EntryRejection[] = [];

  for (const entry of entries) {
    if (!isHlc(entry.hlc)) {
      rejected.push({ id: entry.id, reason: "malformed-hlc" });
      continue;
    }
    if (!SYNC_KIND_SET.has(entry.kind)) {
      rejected.push({ id: entry.id, reason: "unknown-kind" });
      continue;
    }
    const patch = sanitizePatch(entry.kind, entry.patch);
    if (Object.keys(patch).length === 0) {
      rejected.push({ id: entry.id, reason: "empty-patch" });
      continue;
    }
    accepted.push({ id: entry.id, kind: entry.kind, entityId: entry.entityId, hlc: entry.hlc, patch });
  }

  return { accepted, rejected };
}

export interface EntityGroup {
  kind: SyncKind;
  entityId: string;
  /** Each field appears in exactly one group, governed by the LAST (highest
   * push-order) entry that touched it — the same "newest wins" rule the
   * client's `findLocalFieldHlc` applies to its own outbox. */
  fieldsByHlc: Array<{ hlc: string; patch: Record<string, unknown> }>;
}

/** Groups validated entries by (kind, entityId), preserving first-seen order. */
export function groupByEntity(entries: ValidatedEntry[]): EntityGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ValidatedEntry[]>();

  for (const entry of entries) {
    const key = `${entry.kind}:${entry.entityId}`;
    const existing = byKey.get(key);
    if (existing) existing.push(entry);
    else {
      byKey.set(key, [entry]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const list = byKey.get(key)!;
    // Fold same-field collisions within this batch to the last write, since
    // `entries` arrives pre-sorted ascending by (hlc, createdAt, id).
    const latestHlcForField: Record<string, string> = {};
    const valueForField: Record<string, unknown> = {};
    for (const entry of list) {
      for (const field of Object.keys(entry.patch)) {
        latestHlcForField[field] = entry.hlc;
        valueForField[field] = entry.patch[field];
      }
    }

    const byHlc = new Map<string, Record<string, unknown>>();
    for (const field of Object.keys(latestHlcForField)) {
      const hlc = latestHlcForField[field];
      const group = byHlc.get(hlc);
      if (group) group[field] = valueForField[field];
      else byHlc.set(hlc, { [field]: valueForField[field] });
    }

    return {
      kind: list[0].kind,
      entityId: list[0].entityId,
      fieldsByHlc: Array.from(byHlc.entries()).map(([hlc, patch]) => ({ hlc, patch })),
    };
  });
}

export interface EntityResolution {
  apply: Record<string, unknown>;
  clockUpdates: FieldClockMap;
  conflicts: string[];
}

/**
 * Resolves one entity's grouped push against its existing field clocks by
 * calling `applyIncomingPatch` once per hlc group (never once for the whole
 * merged patch — a batch can legitimately carry several hlcs for one entity)
 * and merging the results. Fields partition cleanly across groups by
 * construction (`groupByEntity`), so the merge below can't collide.
 */
export function resolveEntityPush(
  existingClocks: FieldClockMap,
  group: EntityGroup,
): EntityResolution {
  let apply: Record<string, unknown> = {};
  let clockUpdates: FieldClockMap = {};
  let conflicts: string[] = [];

  for (const { hlc, patch } of group.fieldsByHlc) {
    const result = applyIncomingPatch(existingClocks, patch, hlc);
    apply = { ...apply, ...result.apply };
    clockUpdates = { ...clockUpdates, ...result.clockUpdates };
    conflicts = [...conflicts, ...result.conflicts];
  }

  return { apply, clockUpdates, conflicts };
}
