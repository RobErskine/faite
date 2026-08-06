import { DEFAULT_FONT_PAIRING } from "@/lib/fonts";
import { positionAtEnd } from "@/lib/ordering";
import { DEFAULT_AVATAR_KIND } from "@/lib/profile";
import { DEFAULT_THEME_MODE } from "@/lib/theme";
import type { SyncKind } from "@/lib/sync/wire";
import { COLUMNS_BY_KIND } from "./columns";

/**
 * Type-appropriate defaults for the NOT-NULL-without-SQL-default columns that
 * can't be synthesized generically from `dataType` alone (an empty string is
 * a reasonable `title`, but not a reasonable `position`). Only reached when
 * the field is genuinely missing from every prior write — see the reachability
 * note on `buildInsertColumns`. `fontPairing`/`theme`/`avatarKind` reuse the
 * exact constants the client's own Zod schema defaults to, so a synthesized
 * settings row can't disagree with what a brand-new local one looks like.
 */
const FIELD_DEFAULTS: Record<string, () => unknown> = {
  title: () => "",
  name: () => "Untitled",
  position: () => positionAtEnd(null),
  fontPairing: () => DEFAULT_FONT_PAIRING,
  theme: () => DEFAULT_THEME_MODE,
  avatarKind: () => DEFAULT_AVATAR_KIND,
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

  // `settings` has neither `id` nor `createdAt` columns (singleton, keyed by
  // `ownerId`) — filtering to known columns here, rather than special-casing
  // which base fields to set per kind above, means every kind's INSERT is
  // built from exactly the columns it actually has, generically.
  return Object.fromEntries(Object.entries(row).filter(([field]) => field in columns));
}
