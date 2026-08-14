import type { ZodType } from "zod";
import {
  dayNoteSchema,
  labelSchema,
  listSchema,
  placeSchema,
  projectSchema,
  reminderPresetSchema,
  settingsSchema,
  tabSchema,
  todoEventSchema,
  todoSchema,
} from "@/lib/schema";
import { positionAtEnd } from "@/lib/ordering";
import type { SyncKind } from "./wire";

/**
 * Builds a schema-valid local row from a remote patch for an entity that
 * doesn't exist locally yet (a remote create). Runs the real Zod schemas —
 * `schema.ts` is the single source of truth for the data model, so this must
 * be the same validation every local write already goes through, not a
 * hand-rolled shape check that can drift from it.
 */

/**
 * Explicitly `Record<SyncKind, ZodType>` — a bare object literal would
 * compile with a kind missing and fail only at runtime, the first time a
 * remote create of that kind reaches `hydrateRemoteRow` and indexes
 * `undefined`.
 */
const SCHEMA_BY_KIND: Record<SyncKind, ZodType> = {
  todo: todoSchema,
  list: listSchema,
  label: labelSchema,
  project: projectSchema,
  tab: tabSchema,
  dayNote: dayNoteSchema,
  place: placeSchema,
  todoEvent: todoEventSchema,
  reminderPreset: reminderPresetSchema,
  settings: settingsSchema,
};

/**
 * Fallback for the one field worth inventing when genuinely missing:
 * `position` is a sort key, and a wrong sort order is cosmetic — recoverable
 * by dragging, not a hidden semantic loss the way a fabricated name is.
 *
 * `title`/`name` deliberately have NO fallback anymore. They used to, and
 * that synthesis was the client-side half of a live data-loss incident:
 * every seed write now goes through the outbox as a complete row
 * (`seedWrite`, `mutate.ts`), so `changesFromRow` (`wire.ts`) always
 * delivers every field of a row together in one pull response — a
 * *genuinely* missing required field means something upstream is wrong, and
 * the correct response to "something is wrong" is to skip the row and let
 * the next pull redeliver it once it's actually complete, not to silently
 * invent a value a person will read as real. See `apply-plan.ts`'s
 * `skipped` handling and `merge.ts`'s `FLOOR_HLC` note for the full incident.
 *
 * `fontPairing`/`theme`/`avatarKind` have no entry here for a DIFFERENT
 * reason: `settingsSchema` (`schema.ts`) already gives them a Zod
 * `.default()` — unlike `title`/`name`, they can't be made to fail closed
 * from this file at all, since Zod fills them before this ever sees a
 * failure. That's fine, not a gap: `hydrateRemoteRow` only ever runs on the
 * brand-new-local-row path (`apply-plan.ts`'s `local === undefined`
 * branch) — an EXISTING local value is already fully protected by
 * `merge.ts`'s `FLOOR_HLC` populate-only rule regardless of what this
 * function does, so a Zod default landing on a row that never existed
 * locally isn't loss, it's just what a fresh install would default to
 * anyway.
 */
const REQUIRED_FALLBACKS: Record<string, () => unknown> = {
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
  // Every schema in SCHEMA_BY_KIND parses to a plain record — the generic
  // `ZodType` above just can't say so statically.
  return { ok: true, row: result.data as Record<string, unknown> };
}
