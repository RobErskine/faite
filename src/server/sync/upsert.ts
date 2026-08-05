import { positionAtEnd } from "@/lib/ordering";
import type { SyncKind } from "@/lib/sync/wire";
import { COLUMNS_BY_KIND } from "./columns";

/**
 * Type-appropriate defaults for the NOT-NULL-without-SQL-default columns that
 * can't be synthesized generically from `dataType` alone (an empty string is
 * a reasonable `title`, but not a reasonable `position`). Only reached when
 * the field is genuinely missing from every prior write — see the reachability
 * note on `buildInsertColumns`.
 */
const FIELD_DEFAULTS: Record<string, () => unknown> = {
  title: () => "",
  name: () => "Untitled",
  position: () => positionAtEnd(null),
};

/**
 * Fills in the columns a bare INSERT needs beyond what a patch supplied.
 *
 * Reachability: within one device, a create outbox entry always precedes its
 * updates (HLC is monotone per node) and the drain preserves that order.
 * Across devices, device B can only reference a row it pulled, which means
 * device A already pushed the full-row create for it. So a genuinely partial
 * first write is pathological — a corrupted outbox, a previously rejected
 * entry, or a bug — not a normal path. Given that, this synthesizes rather
 * than rejects: never lose data, never 500, leave the row self-healing.
 *
 * Synthesized columns intentionally get no `field_clocks` row (the caller
 * only writes clocks for keys present in the incoming patch, via
 * `applyIncomingPatch`'s `clockUpdates`) — so on the next pull they group
 * under `FLOOR_HLC` (`wire.ts`) and the first real value from any device
 * overwrites the placeholder. The pathological case repairs itself with no
 * special case anywhere else in the pipeline.
 */
export function buildInsertColumns(
  kind: SyncKind,
  entityId: string,
  ownerId: string,
  patchFields: Record<string, unknown>,
  nowIso: string,
  version: number,
): Record<string, unknown> {
  const columns = COLUMNS_BY_KIND[kind];
  const row: Record<string, unknown> = {
    id: entityId,
    ownerId,
    createdAt: nowIso,
    updatedAt: nowIso,
    version,
    ...patchFields,
  };

  for (const [field, meta] of Object.entries(columns)) {
    if (!meta.notNull || meta.hasDefault) continue;
    if (row[field] !== undefined && row[field] !== null) continue;
    const fallback = FIELD_DEFAULTS[field];
    if (fallback) row[field] = fallback();
  }

  return row;
}
