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
 * **Four levels, four line styles — the four CSS actually has.** Double,
 * solid, dashed, dotted, for P1 to P4, with thickness stepping down alongside
 * (5 / 3 / 2 / 2px) to reinforce it. Every level is identifiable on its own,
 * with no neighbour to compare against: a width ramp alone answers "which of
 * these two is higher", never "what is this one".
 *
 * Double leads because it reads as emphasis before you know the scale — the
 * same instinct as a double underline — and because it is the one style that
 * NEEDS width to exist at all: two lines and a gap is three pixels at minimum,
 * and at 5px it is two clear 2px strokes. Solid, dashed and dotted then run
 * from continuous to most broken.
 *
 * Mapping onto CSS's own four styles is not a coincidence, it is the point.
 * The drag chip and the sheet's priority tab draw the mark as a real border,
 * and with four rhythms and three styles they used to have to approximate.
 * Now every surface draws exactly the same four things.
 *
 * All of it is form rather than color, so it survives every color-vision
 * deficiency and both themes (docs/DESIGN.md §7, decision A).
 *
 * The rail is drawn in `--foreground`, so it inverts with the theme and always
 * holds full contrast against its column. `opacity` below is applied to the
 * span, not baked into a color, so the same values serve both themes.
 */
export type RailStyle = "double" | "solid" | "dashed" | "dotted";

export interface PriorityRail {
  /** Rail thickness in px. */
  width: number;
  /** 0–1. Applied to the rail span; the color is always `--foreground`. */
  opacity: number;
  /**
   * Which of CSS's four line styles this level is. The name IS the
   * `border-style` value, so the border surfaces pass it straight through
   * and the span surfaces rebuild it with a gradient.
   */
  style: RailStyle;
  /** What a screen reader hears in place of the old `P1` chip. */
  label: string;
}

export const PRIORITY_RAILS: Record<Priority, PriorityRail> = {
  1: { width: 5, opacity: 1, style: "double", label: "Priority 1, highest" },
  2: { width: 3, opacity: 0.9, style: "solid", label: "Priority 2" },
  3: { width: 2, opacity: 0.75, style: "dashed", label: "Priority 3" },
  4: { width: 2, opacity: 0.6, style: "dotted", label: "Priority 4, lowest" },
};

/**
 * The vertical rhythms a span uses to draw `dashed` and `dotted`, in CSS
 * pixels of ink and gap.
 *
 * Every period is 9px or under, because a card rail is only ~27px tall: a
 * longer period lands two marks and reads as solid, which is an encoding that
 * is present and invisible. `priority.test.ts` holds that ceiling.
 */
export const RAIL_RHYTHMS = {
  dashed: { on: 6, off: 3 },
  dotted: { on: 2, off: 3 },
} as const;

/**
 * The rail's fill as a `background-image`, for the surfaces that draw it as a
 * SPAN — the board card, the homepage's echo of it, the sheet's leading edge.
 * `null` means solid: the caller paints a flat color.
 *
 * - `double` runs ACROSS the width: two strokes with a gap between, which is
 *   what a double border is.
 * - `dashed` and `dotted` run DOWN it, repeating.
 */
export function railBackgroundImage(rail: PriorityRail): string | null {
  const ink = "var(--foreground)";
  switch (rail.style) {
    case "solid":
      return null;
    case "double": {
      // Two equal strokes around a gap of whatever is left — 2 / 1 / 2 at
      // 5px. `floor` keeps the strokes on whole pixels so they stay sharp.
      const stroke = Math.floor((rail.width - 1) / 2);
      const far = rail.width - stroke;
      return `linear-gradient(to right, ${ink} 0 ${stroke}px, transparent ${stroke}px ${far}px, ${ink} ${far}px)`;
    }
    case "dashed":
    case "dotted": {
      const { on, off } = RAIL_RHYTHMS[rail.style];
      return `repeating-linear-gradient(to bottom, ${ink} 0 ${on}px, transparent ${on}px ${on + off}px)`;
    }
  }
}

/**
 * The rail as a `border-style`, for the two surfaces that draw it as a
 * BORDER — the drag chip and the sheet's priority tab.
 *
 * Exact, not an approximation: the four levels ARE CSS's four line styles.
 */
export function railBorderStyle(rail: PriorityRail): RailStyle {
  return rail.style;
}

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
