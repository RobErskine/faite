import { settingsSchema, type Settings } from "@/lib/schema";

/**
 * A Settings row for an account that may never have written one —
 * `get_profile`/`get_overflow` (MCP) can be the very first thing an account
 * created via desktop handoff ever touches, since `seedIfEmpty()` (the
 * client's own first-boot seed) never gets a chance to run.
 *
 * Every `settingsSchema` field carries a Zod `.default()` EXCEPT `ownerId`
 * and `updatedAt` — REGRESSION, caught live while testing `get_profile`
 * against a fresh account: `settingsSchema.parse({ ownerId })` alone throws
 * `expected string, received undefined` on `updatedAt`. Both are supplied
 * here so a genuinely-missing row still parses to the same shape a brand
 * new account's local Settings would have.
 *
 * Kept in its own dependency-free module (mirroring `accept.ts`'s split
 * from `routes.ts`, for the identical reason): `routes.ts` transitively
 * imports `agents/mcp`, which has a hard `cloudflare:workers` runtime
 * dependency vitest's Node environment can't resolve.
 */
export function settingsOrDefault(
  row: Record<string, unknown> | null,
  ownerId: string,
  now: () => string = () => new Date().toISOString(),
): Settings {
  return settingsSchema.parse(row ?? { ownerId, updatedAt: now() });
}
