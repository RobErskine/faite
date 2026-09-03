import { byPosition } from "./ordering";
import type { Priority, Todo } from "./schema";

/**
 * Priority as a rail down the left edge of a card, rather than a chip.
 *
 * A `P1` chip with a flag glyph cost a whole badge row — 20px of height and a
 * pill's width — in a column whose floor is 168px. The rail spends nothing: it
 * lives inside the row's existing left padding.
 *
 * **Achromatic, since the V milestone** (docs/DESIGN.md §7, decision A). The
 * rail used to carry a hue per level — red, orange, blue, cyan — and every one
 * of them was also a list preset in `lib/colors.ts`, and the red was also the
 * urgency red. A Tomato "VIP" list beside a red "In Overflow" badge beside a
 * red P1 rail could not be told apart. Now hue on the board means exactly two
 * things — "belongs to this list" and "needs a verdict" — and importance is
 * carried by form alone.
 *
 * **Two channels, arranged so no level shares both.** Thickness is the coarse
 * signal (3 / 2 / 1 / 1px); opacity and line style carry the rest. A four-step
 * width ramp was rejected: 4px shouts at the column floor, and a 1.5px step
 * rounds to 1 or 2 device pixels depending on the display — a rail that
 * changes thickness when you move the window to another monitor. The pair that
 * shares a thickness (P3/P4) is told apart by P4 being dotted, which survives
 * every colour-vision deficiency and both themes because it is not a colour.
 *
 * The rail is drawn in `--foreground`, so it inverts with the theme and always
 * holds full contrast against its column. `opacity` below is applied to the
 * span, not baked into a colour, so the same values serve both themes.
 */
export interface PriorityRail {
  /** Rail thickness in px. */
  width: number;
  /** 0–1. Applied to the rail span; the colour is always `--foreground`. */
  opacity: number;
  /** Dotted rather than solid — the second channel for the 1px pair. */
  dotted: boolean;
  /** What a screen reader hears in place of the old `P1` chip. */
  label: string;
}

export const PRIORITY_RAILS: Record<Priority, PriorityRail> = {
  1: { width: 3, opacity: 1, dotted: false, label: "Priority 1, highest" },
  2: { width: 2, opacity: 0.7, dotted: false, label: "Priority 2" },
  3: { width: 1, opacity: 0.5, dotted: false, label: "Priority 3" },
  4: { width: 1, opacity: 0.5, dotted: true, label: "Priority 4, lowest" },
};

/** `undefined` for an unprioritised to-do, so callers can render nothing. */
export function priorityRail(
  priority: Priority | null | undefined,
): PriorityRail | undefined {
  return priority ? PRIORITY_RAILS[priority] : undefined;
}

/**
 * Sort rank. Unprioritised is 5 — last, not first.
 *
 * An unprioritised to-do is not "priority zero", it is undecided, and undecided
 * work belongs below decided work. 5 rather than `Infinity` keeps the four real
 * levels as their own numbers and the arithmetic below integer.
 */
export const priorityRank = (priority: Priority | null | undefined): number =>
  priority ?? 5;

/**
 * P1 → P4, then unprioritised, with `position` breaking ties, and `id`
 * breaking those.
 *
 * The `byPosition` fallback is not decoration and must not be trimmed on the
 * grounds that `Array.prototype.sort` is stable. It is stable — but the
 * insertion order it would preserve is the store's, which is arbitrary. Without
 * the fallback two P2 cards would swap places whenever Dexie handed them back in
 * a different order.
 *
 * The final `id` tiebreak matters for recurrence: every occurrence of one
 * series shares the template's own `position` verbatim (see
 * `lib/recurrence-expand.ts`), so equal priority AND equal position is no
 * longer a one-in-a-million case. Without a total order here, two occurrences
 * of the same series would swap places on every render.
 */
export function byPriorityThenPosition(a: Todo, b: Todo): number {
  const rank = priorityRank(a.priority) - priorityRank(b.priority);
  if (rank !== 0) return rank;
  const byPos = byPosition(a, b);
  if (byPos !== 0) return byPos;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Unfinished work first; everything settled sinks below it.
 *
 * Wrapped around the two real comparators rather than folded into them,
 * because the tiebreaker differs by half — the calendar half orders by
 * priority, the planning half by hand (see the block comment in
 * `buildBoard`) — and only the leading status term is shared.
 *
 * `done` and `dropped` rank together. Once a card is off the list, whether it
 * was finished or abandoned changes how it READS, not where it sits; splitting
 * them into two tiers would put a card in a different place depending on which
 * way you dismissed it.
 */
const statusRank = (todo: Pick<Todo, "status">): number =>
  todo.status === "open" ? 0 : 1;

export function openFirst(
  tiebreak: (a: Todo, b: Todo) => number,
): (a: Todo, b: Todo) => number {
  return (a, b) => {
    const rank = statusRank(a) - statusRank(b);
    return rank !== 0 ? rank : tiebreak(a, b);
  };
}
