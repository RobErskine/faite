import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Ordering via fractional indexing.
 *
 * Each item stores a `position` string that sorts lexicographically. Moving an
 * item writes ONE field on ONE record — not a renumbering of its neighbours.
 *
 * This matters most for sync (P3): two devices reordering the same list while
 * offline generate different keys rather than fighting over the same integer
 * indices, so the merge stays a plain field-level last-writer-wins with no
 * special handling for order.
 */

export type Position = string;

/** Position for an item at the very top of an empty or existing column. */
export function positionAtStart(first: Position | null): Position {
  return generateKeyBetween(null, first ?? null);
}

/** Position for an item appended to the end of a column. */
export function positionAtEnd(last: Position | null): Position {
  return generateKeyBetween(last ?? null, null);
}

/**
 * Position for an item dropped between two neighbours.
 *
 * Pass null for `before` when dropping at the top, or null for `after` when
 * dropping at the bottom.
 */
export function positionBetween(
  before: Position | null,
  after: Position | null,
): Position {
  return generateKeyBetween(before, after);
}

/** N evenly spaced positions — used when seeding default lists. */
export function positionsBetween(
  before: Position | null,
  after: Position | null,
  count: number,
): Position[] {
  return generateNKeysBetween(before, after, count);
}

/** Ascending comparator for any positioned record. */
export function byPosition<T extends { position: Position }>(a: T, b: T): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/**
 * Resolve the position for moving an item into `index` within `ordered`.
 *
 * `ordered` must already be sorted and must EXCLUDE the item being moved —
 * otherwise the item's own position becomes one of its own neighbours and the
 * result can land on the wrong side of it.
 */
export function positionForIndex(
  ordered: readonly { position: Position }[],
  index: number,
): Position {
  const clamped = Math.max(0, Math.min(index, ordered.length));
  const before = clamped > 0 ? ordered[clamped - 1].position : null;
  const after = clamped < ordered.length ? ordered[clamped].position : null;
  return generateKeyBetween(before, after);
}
