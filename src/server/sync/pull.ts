import { changesFromRow, type SyncKind, type WireChange } from "@/lib/sync/wire";
import type { FieldClockMap } from "./apply-patch";

/**
 * Pure pull-merge: given each kind's independently-fetched, version-ascending
 * page (the SQL lives in `user-do.ts`), produce one globally-ordered page of
 * `WireChange`s plus the next cursor. Kept storage-free so `round-trip.test.ts`
 * can exercise the real merge without a Durable Object.
 */

export interface KindPage {
  kind: SyncKind;
  /** JS-typed rows (via `rowFromSqlRow`), ascending by `version`, already
   * capped to `limit` by the caller's `SELECT ... ORDER BY version LIMIT ?`. */
  rows: Array<Record<string, unknown> & { id: string; version: number }>;
  /** True when this kind's own fetch returned exactly `limit` rows — there
   * might be more beyond what was fetched, even if none land on this page. */
  exhausted: boolean;
}

export interface PulledPage {
  changes: WireChange[];
  cursor: number;
  hasMore: boolean;
}

/**
 * Merges each kind's capped page into one page ordered by `version`.
 *
 * Correct because each kind's fetch already IS that kind's true oldest N rows
 * above the cursor (`ORDER BY version LIMIT limit`, ascending) — so merging
 * all five kinds' oldest-N and re-cutting to `limit` can never miss a row
 * that belongs in the true global oldest-`limit`. At most `limit` rows from
 * any single kind could ever rank in that global slice, and this fetches
 * exactly that many.
 */
export function mergePages(
  pages: KindPage[],
  cursor: number,
  limit: number,
  fieldClocksByEntityId: Record<string, FieldClockMap>,
): PulledPage {
  const allRows = pages.flatMap((page) => page.rows.map((row) => ({ kind: page.kind, row })));
  allRows.sort((a, b) => a.row.version - b.row.version);
  const page = allRows.slice(0, limit);

  const changes = page.flatMap(({ kind, row }) =>
    changesFromRow(kind, row.id, row, fieldClocksByEntityId[row.id] ?? {}),
  );

  const newCursor = page.length > 0 ? page[page.length - 1].row.version : cursor;

  // Conservative: a kind whose own fetch came back full (== limit) might hold
  // more above what we saw, even if none of those rows made this page. A kind
  // that had exactly `limit` rows remaining (no more, ever) is the one false
  // positive this produces — the client just pulls again and gets an empty
  // page next time, which is a correct, if occasionally wasted, round trip.
  const hasMore = pages.some((p) => p.exhausted);

  return { changes, cursor: newCursor, hasMore };
}
