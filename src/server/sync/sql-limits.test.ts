import { describe, expect, it } from "vitest";
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT, SYNC_KINDS } from "@/lib/sync/wire";
import { chunkForInClause, IN_CLAUSE_CHUNK, MAX_BOUND_PARAMS } from "./sql-limits";

describe("chunkForInClause", () => {
  it("returns no batches for an empty input", () => {
    // Not one empty batch — `IN ()` is a syntax error, so the caller must
    // issue zero queries, and a bare `for...of` over `[]` does that.
    expect(chunkForInClause([])).toEqual([]);
  });

  it("returns a single batch when the input fits", () => {
    expect(chunkForInClause([1, 2, 3])).toEqual([[1, 2, 3]]);
  });

  it("splits at exactly the chunk size without emitting a trailing empty batch", () => {
    const items = Array.from({ length: IN_CLAUSE_CHUNK }, (_, i) => i);
    expect(chunkForInClause(items)).toHaveLength(1);
    expect(chunkForInClause(items)[0]).toHaveLength(IN_CLAUSE_CHUNK);
  });

  it("splits one past the chunk size into two", () => {
    const items = Array.from({ length: IN_CLAUSE_CHUNK + 1 }, (_, i) => i);
    const batches = chunkForInClause(items);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(IN_CLAUSE_CHUNK);
    expect(batches[1]).toHaveLength(1);
  });

  it("preserves order and loses nothing", () => {
    const items = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    expect(chunkForInClause(items).flat()).toEqual(items);
  });

  it("rejects a nonsense chunk size rather than looping forever", () => {
    expect(() => chunkForInClause([1], 0)).toThrow(RangeError);
  });

  it("honours an explicit size override", () => {
    expect(chunkForInClause([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("REGRESSION: pull() cannot exceed SQLite's bound-parameter limit", () => {
  /**
   * The bug this file exists for. `pull()` fetches up to `limit` rows per
   * kind across every `SYNC_KIND`, then feeds the union into one
   * `IN (?, ?, …)`. Pinning the arithmetic here means a future limit bump —
   * or a seventh sync kind — fails a test instead of failing in production
   * on somebody's first big catch-up pull.
   */
  const worstCaseIds = (limit: number) => SYNC_KINDS.length * limit;

  it("the unchunked query would have blown the limit at the DEFAULT pull limit", () => {
    expect(worstCaseIds(DEFAULT_PULL_LIMIT)).toBeGreaterThan(MAX_BOUND_PARAMS);
  });

  it("every chunk stays under the limit at the DEFAULT pull limit", () => {
    const ids = Array.from({ length: worstCaseIds(DEFAULT_PULL_LIMIT) }, (_, i) => `e-${i}`);
    for (const batch of chunkForInClause(ids)) {
      expect(batch.length).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
    }
  });

  it("every chunk stays under the limit at the MAX pull limit", () => {
    const ids = Array.from({ length: worstCaseIds(MAX_PULL_LIMIT) }, (_, i) => `e-${i}`);
    const batches = chunkForInClause(ids);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(MAX_BOUND_PARAMS);
    }
  });

  it("leaves headroom for extra bound values in the same query", () => {
    expect(IN_CLAUSE_CHUNK).toBeLessThan(MAX_BOUND_PARAMS);
  });
});
