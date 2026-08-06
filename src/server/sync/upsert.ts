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
 * Reachability — corrected after a live incident: the original comment here
 * claimed a partial first write was "pathological" (a corrupted outbox, a
 * previously rejected entry, or a bug). It was not. `seedIfEmpty`/
 * `ensureDefaultTab` (`src/lib/store/repositories.ts`) wrote seed rows
 * directly to Dexie, bypassing `mutate()`/`create()` entirely, so those rows
 * had NO create outbox entry — only `adoptLocalData`'s later `{ownerId,
 * updatedAt}` patch, which `sanitizePatch` reduces further to `{updatedAt}`.
 * That is a genuinely partial first write, on the ordinary sign-in path, on
 * every device that has ever run the app. `src/lib/sync/merge.ts`'s
 * `FLOOR_HLC` carve-out (populate-only, never overwrite) is what makes
 * synthesizing here safe regardless of how this is reached; do not remove
 * that guard on the assumption that this function is now unreachable with a
 * partial patch — `seedWrite` (`mutate.ts`) closes the *known* source, not
 * the general case a client is free to retry into.
 *
 * Synthesized columns intentionally get no `field_clocks` row (the caller
 * only writes clocks for keys present in the incoming patch, via
 * `applyIncomingPatch`'s `clockUpdates`) — so on the next pull they group
 * under `FLOOR_HLC` (`wire.ts`) and the first real value from any device
 * overwrites the placeholder, without ever touching a value a device that
 * already has this row is holding.
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

  const synthesized: string[] = [];
  for (const [field, meta] of Object.entries(columns)) {
    if (!meta.notNull || meta.hasDefault) continue;
    if (row[field] !== undefined && row[field] !== null) continue;
    const fallback = FIELD_DEFAULTS[field];
    if (fallback) {
      row[field] = fallback();
      synthesized.push(field);
    }
  }

  if (synthesized.length > 0) {
    // A partial first write for this entity — see the reachability note
    // above. Not an error, but worth a trace: it's the signal that a create
    // is missing an outbox entry somewhere upstream of this push.
    console.warn(
      `[faite] synthesized placeholder(s) for ${kind}/${entityId} on a partial create: ${synthesized.join(", ")}`,
    );
  }

  // `settings` has neither `id` nor `createdAt` columns (singleton, keyed by
  // `ownerId`) — filtering to known columns here, rather than special-casing
  // which base fields to set per kind above, means every kind's INSERT is
  // built from exactly the columns it actually has, generically.
  return Object.fromEntries(Object.entries(row).filter(([field]) => field in columns));
}
