/**
 * Hard limits of a Durable Object's SQLite storage, and the chunking helper
 * that keeps us under them.
 *
 * Documented at `developers.cloudflare.com/durable-objects/platform/limits/`
 * (verified 2026-08): **100 bound parameters per query.** That is a small
 * number, and it is easy to blow through without noticing, because the query
 * that blows it is built from a row count rather than written literally.
 *
 * `user-do.ts`'s `readFieldClocksBulk` did exactly that: `pull()` gathers
 * entity ids from every `SYNC_KINDS` entry, each capped at `limit` rows, then
 * builds one `... WHERE entity_id IN (?, ?, …)` over the union. At
 * `DEFAULT_PULL_LIMIT` (100) that is up to 600 parameters; at `MAX_PULL_LIMIT`
 * (200), up to 1200. It stayed latent only because the one production account
 * is small — and it would have fired first on the largest, least recoverable
 * pull there is: a `since=0` (or long-offline) catch-up, which is precisely
 * what P4's reconnect path leans on.
 *
 * Rule of thumb for anything added later: if the number of `?`s in a query
 * depends on the length of an array, it must go through `chunkForInClause`.
 */

/** Cloudflare's documented ceiling. Do not raise. */
export const MAX_BOUND_PARAMS = 100;

/**
 * Ids per `IN (...)` batch. Deliberately below `MAX_BOUND_PARAMS` rather than
 * equal to it, so a caller that adds one more bound value to the same query
 * (a `kind = ?`, a `version > ?`) doesn't silently land back on the limit.
 */
export const IN_CLAUSE_CHUNK = 90;

/**
 * Splits `items` into batches of at most `size`. Returns `[]` for an empty
 * input — callers can `for...of` the result without a length guard, and an
 * empty input must issue zero queries, not one query with an empty `IN ()`
 * (which is a SQL syntax error, not an empty result).
 */
export function chunkForInClause<T>(items: readonly T[], size: number = IN_CLAUSE_CHUNK): T[][] {
  if (size < 1) throw new RangeError(`chunk size must be >= 1, got ${size}`);
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push(items.slice(offset, offset + size));
  }
  return batches;
}
