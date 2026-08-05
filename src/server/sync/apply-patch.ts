import { compareHlc } from "@/lib/sync/hlc-core";

/**
 * The Durable Object's side of field-level LWW (P3, D2 server half).
 *
 * The client derives a field's clock from its outbox because it has exactly
 * one writer (`src/lib/sync/merge.ts`). The DO has many concurrent writers
 * and no outbox, so it keeps a real per-field HLC in the `field_clocks` table
 * (`src/server/db/user-schema.ts`) instead. This function is the pure
 * decision logic over that table's data — no D1, no `ctx.storage`, no
 * bindings — so it's importable by plain vitest exactly like the client's
 * `mergeRecord`. The wiring that reads/writes `field_clocks` around it is
 * P3/P4 transport work, not this phase.
 */

/** Field name -> the HLC of the last write the server accepted for it. */
export type FieldClockMap = Record<string, string>;

export interface ApplyPatchResult {
  /** Fields to write into the entity row. */
  apply: Record<string, unknown>;
  /** `field_clocks` rows to upsert for the fields in `apply`. */
  clockUpdates: FieldClockMap;
  /** Fields where the existing server value already won; the patch is dropped. */
  conflicts: string[];
}

export function applyIncomingPatch(
  existingClocks: FieldClockMap,
  patch: Record<string, unknown>,
  patchHlc: string,
): ApplyPatchResult {
  const apply: Record<string, unknown> = {};
  const clockUpdates: FieldClockMap = {};
  const conflicts: string[] = [];

  for (const field of Object.keys(patch)) {
    const existingHlc = existingClocks[field] ?? null;
    const incomingWins = existingHlc === null || compareHlc(patchHlc, existingHlc) > 0;

    if (!incomingWins) {
      conflicts.push(field);
      continue;
    }

    const value = patch[field];
    // Never write `undefined` — same rule as the client merge (§8): it reads
    // as "delete this key path" to Dexie, and there is no reason a SQLite
    // write path should treat it any more meaningfully.
    if (value === undefined) continue;

    apply[field] = value;
    clockUpdates[field] = patchHlc;
  }

  return { apply, clockUpdates, conflicts };
}
