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

/**
 * Resolve the position for a card dropped onto another card in the same column.
 *
 * This exists because the two arrays involved are NOT the same length, and
 * using an index from one against the other is an off-by-one that fractional
 * indexing hides almost everywhere (EI-191):
 *
 * - the target's index must be read from the list WITHOUT the dragged item,
 * - because `positionForIndex` also resolves against that list.
 *
 * Read the index from the full sibling list instead and a card dragged
 * DOWNWARD past its target lands one slot too low — every element after the
 * dragged one shifts up by one when it is removed. The insertion line
 * (`todo-card.tsx`) is drawn ABOVE the hovered card, so that mismatch is a
 * visible broken promise, not just an internal detail.
 *
 * `siblings` may or may not contain the dragged item — a cross-column drop is
 * the case where it does not, and there the filter is a no-op and this behaves
 * exactly like `positionForIndex`.
 *
 * `overId` of null means "no specific card was hovered", i.e. append to the end.
 */
export function positionForDropOnItem<T extends { id: string; position: Position }>(
  siblings: readonly T[],
  draggedId: string,
  overId: string | null,
): Position {
  const ordered = siblings.filter((item) => item.id !== draggedId);
  if (overId === null) return positionForIndex(ordered, ordered.length);

  const index = ordered.findIndex((item) => item.id === overId);
  /*
   * -1 means the hovered card is the dragged card itself. Collision detection
   * already excludes the active id (`use-board-actions.ts`), so this is
   * unreachable in practice — but appending is the safe read, since landing at
   * index 0 would silently teleport the card to the top of its column.
   */
  return positionForIndex(ordered, index === -1 ? ordered.length : index);
}

/**
 * N positions for a contiguous run dropped onto `overId`, sharing one gap
 * (EI-194).
 *
 * The multi-select counterpart of `positionForDropOnItem`, and it must stay
 * that function's exact generalisation: at `count === 1` the two are required
 * to agree, or a one-card selection would land somewhere a plain drag would
 * not. There is a test pinning that.
 *
 * `draggedIds` excludes EVERY mover from the neighbour list, not just the one
 * under the cursor. Leaving the others in would let a mover become its own
 * run's neighbour and interleave the result with cards that are about to move
 * out from between them.
 */
export function positionsForDropOnItem<T extends { id: string; position: Position }>(
  siblings: readonly T[],
  draggedIds: ReadonlySet<string>,
  overId: string | null,
  count: number,
): Position[] {
  if (count <= 0) return [];

  const ordered = siblings.filter((item) => !draggedIds.has(item.id));
  const found = overId === null ? -1 : ordered.findIndex((item) => item.id === overId);
  const index = found === -1 ? ordered.length : found;

  const clamped = Math.max(0, Math.min(index, ordered.length));
  const before = clamped > 0 ? ordered[clamped - 1].position : null;
  const after = clamped < ordered.length ? ordered[clamped].position : null;
  return generateNKeysBetween(before, after, count);
}
