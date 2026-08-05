import { labelSchema, listSchema, projectSchema, tabSchema, todoSchema } from "@/lib/schema";
import { positionAtEnd } from "@/lib/ordering";
import type { SyncKind } from "./wire";

/**
 * Builds a schema-valid local row from a remote patch for an entity that
 * doesn't exist locally yet (a remote create). Runs the real Zod schemas —
 * `schema.ts` is the single source of truth for the data model, so this must
 * be the same validation every local write already goes through, not a
 * hand-rolled shape check that can drift from it.
 */

const SCHEMA_BY_KIND = {
  todo: todoSchema,
  list: listSchema,
  label: labelSchema,
  project: projectSchema,
  tab: tabSchema,
};

/**
 * Fallbacks for the handful of fields that are required with NO Zod
 * `.default()` and aren't already guaranteed by the caller (`id`, `ownerId`,
 * `createdAt`, `updatedAt`). Reachable only when a row's create WireChanges
 * are somehow incomplete — normally every field lands in the same pull
 * response, since `changesFromRow` partitions one row's fields across
 * changes but never drops any (see `wire.ts`). Mirrors `upsert.ts`'s
 * `FIELD_DEFAULTS` on the server side for the same reason.
 */
const REQUIRED_FALLBACKS: Record<string, () => unknown> = {
  title: () => "",
  name: () => "Untitled",
  position: () => positionAtEnd(null),
};

export type HydrateResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: string };

export function hydrateRemoteRow(
  kind: SyncKind,
  entityId: string,
  fields: Record<string, unknown>,
  ctx: { ownerId: string; now: string },
): HydrateResult {
  const candidate: Record<string, unknown> = {
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...fields,
    // Always win over anything (even defensively) present in `fields` — an
    // entity's id and owner are never synced values, they're context the
    // caller already knows.
    id: entityId,
    ownerId: ctx.ownerId,
  };

  for (const [field, fallback] of Object.entries(REQUIRED_FALLBACKS)) {
    if (candidate[field] === undefined || candidate[field] === null) {
      candidate[field] = fallback();
    }
  }

  const result = SCHEMA_BY_KIND[kind].safeParse(candidate);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map((issue) => issue.message).join("; ") };
  }
  return { ok: true, row: result.data };
}
