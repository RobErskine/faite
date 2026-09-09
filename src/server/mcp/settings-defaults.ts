import { settingsSchema, type Settings } from "@/lib/schema";

/**
 * A Settings row for an account that may never have written one —
 * `get_profile`/`get_overflow` (MCP) and `/api/v1/profile` (A17) can be the
 * very first thing an account created via desktop handoff ever touches, since
 * `seedIfEmpty()` (the client's own first-boot seed) never gets a chance to
 * run.
 *
 * Every `settingsSchema` field carries a Zod `.default()` EXCEPT `ownerId`
 * and `updatedAt` — REGRESSION, caught live while testing `get_profile`
 * against a fresh account: `settingsSchema.parse({ ownerId })` alone throws
 * `expected string, received undefined` on `updatedAt`. Both are supplied
 * here so a genuinely-missing row still parses to the same shape a brand new
 * account's local Settings would have.
 *
 * Kept in its own dependency-free module (mirroring `accept.ts`'s split from
 * `routes.ts`, for the identical reason): `routes.ts` transitively imports
 * `agents/mcp`, which has a hard `cloudflare:workers` runtime dependency
 * vitest's Node environment can't resolve.
 *
 * ## Why this tolerates a bad field instead of throwing (EI-314)
 *
 * It used to `parse()`, so ONE malformed field took down every caller. That
 * is exactly what happened: `splitRatio` had been stored as a fraction since
 * the resize seam shipped while the schema said `.int()`, and
 * `/api/v1/profile` — which does not even expose `splitRatio`, because it is
 * device-local — returned 500 for any account that had ever dragged the seam.
 *
 * A settings row is a wide bag of mostly-cosmetic preferences. A reader that
 * wants `timezone` should not fail because a pane divider is half a percent
 * off, and the odds of some field drifting from its declared type over the
 * life of a synced product are high. So: drop the fields that fail, keep
 * everything that parses, and let the schema's own defaults fill the gaps.
 */

/** Bounded so a pathological row cannot spin: each pass removes at least one
 * field, and there are far fewer than this many fields. */
const MAX_REPAIR_PASSES = 40;

export function settingsOrDefault(
  row: Record<string, unknown> | null,
  ownerId: string,
  now: () => string = () => new Date().toISOString(),
): Settings {
  const base = row ?? { ownerId, updatedAt: now() };

  const parsed = settingsSchema.safeParse(base);
  if (parsed.success) return parsed.data;

  // Strip only the fields Zod actually complained about, then re-parse. Each
  // pass can surface new errors (Zod reports what it reached), hence the loop
  // rather than a single strip.
  const repaired: Record<string, unknown> = { ...base };
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    const attempt = settingsSchema.safeParse(repaired);
    if (attempt.success) return attempt.data;

    // Only top-level keys are removable; a nested failure means the whole
    // field goes, which is the same outcome at this granularity.
    const offending = attempt.error.issues
      .map((issue) => issue.path[0])
      .filter((key): key is string => typeof key === "string");

    if (offending.length === 0) break;

    let removedAny = false;
    for (const key of offending) {
      // `ownerId`/`updatedAt` have no defaults to fall back to — removing
      // them cannot help, and would only loop.
      if (key === "ownerId" || key === "updatedAt") continue;
      if (key in repaired) {
        delete repaired[key];
        removedAny = true;
      }
    }
    if (!removedAny) break;
  }

  // Nothing salvageable — a row missing `ownerId`/`updatedAt`, or corrupt
  // beyond per-field repair. Defaults are still a truthful answer to "what
  // are this account's settings" for a reader that only wants a timezone.
  return settingsSchema.parse({ ownerId, updatedAt: now() });
}
