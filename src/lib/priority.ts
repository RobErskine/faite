import { byPosition } from "./ordering";
import type { Priority, Todo } from "./schema";

/**
 * Priority as a rail down the left edge of a card, rather than a chip.
 *
 * A `P1` chip with a flag glyph cost a whole badge row — 20px of height and a
 * pill's width — in a column whose floor is 168px. The rail spends nothing: it
 * lives inside the row's existing left padding.
 *
 * **Two channels, arranged so no level shares both.** Thickness is a coarse
 * three-step signal; hue carries the four-step read. The pair that shares a
 * thickness (P3/P4) sits far apart in hue *and* on the blue axis that survives
 * red-green colour blindness; the pair adjacent in hue (P1/P2) is separated by
 * thickness. A four-step width ramp would need either 4px, which shouts at the
 * column floor, or a 1.5px step, which rounds to 1 or 2 device pixels depending
 * on the display — a rail that changes thickness when you move the window to
 * another monitor.
 *
 * Colours are Radix step 9 as plain hex, the convention `lib/colors.ts` sets
 * out: step 9 is the solid-fill step, tuned to hold roughly equal weight
 * against a light and a dark backdrop, so one value serves both themes in an
 * app whose palette is otherwise `oklch(L 0 0)`. Deliberately *not* run through
 * `tint()` or `edge()` — a 12% or 35% wash of a 1px line is invisible in either
 * theme. The rail is a fill, which is what step 9 is for.
 *
 * Overlap with `ACCENT_COLORS` is accepted rather than worked around: all ten
 * accents are step 9 too, so any legible pick collides with one of them. What
 * separates the two ideas is form and place — an accent is a wash behind a tab
 * or a rule under a column header, a priority is an opaque spine on a card, and
 * a card never carries a tab accent.
 */
export interface PriorityRail {
  /** Rail thickness in px. */
  width: number;
  color: string;
  /** What a screen reader hears in place of the old `P1` chip. */
  label: string;
}

export const PRIORITY_RAILS: Record<Priority, PriorityRail> = {
  1: { width: 3, color: "#e5484d", label: "Priority 1, highest" },
  2: { width: 2, color: "#f76b15", label: "Priority 2" },
  3: { width: 1, color: "#3e63dd", label: "Priority 3" },
  // Amber (#ffb224) reads at roughly 1.7:1 on white, so a thin amber line looks
  // like a rendering artefact rather than a signal. Cyan holds in both themes.
  4: { width: 1, color: "#00a2c7", label: "Priority 4, lowest" },
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
 * P1 → P4, then unprioritised, with `position` breaking ties.
 *
 * The `byPosition` fallback is not decoration and must not be trimmed on the
 * grounds that `Array.prototype.sort` is stable. It is stable — but the
 * insertion order it would preserve is the store's, which is arbitrary. Without
 * the fallback two P2 cards would swap places whenever Dexie handed them back in
 * a different order.
 */
export function byPriorityThenPosition(a: Todo, b: Todo): number {
  const rank = priorityRank(a.priority) - priorityRank(b.priority);
  return rank !== 0 ? rank : byPosition(a, b);
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
