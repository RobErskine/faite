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
 * **Three channels, and every level is unique on its own.** Thickness is the
 * coarse signal (3 / 2 / 1 / 1px); opacity trims the weight; and the RHYTHM —
 * solid, then progressively more broken — is what lets a level be read without
 * a neighbour to compare it against. That last one is the point: a width ramp
 * alone answers "which of these two is higher", never "what is this one".
 *
 * The rhythm runs solid → long dash → short dash → sparse dots, which is
 * legible as decreasing insistence before you know the scale. All of it is
 * form rather than color, so it survives every color-vision deficiency and
 * both themes.
 *
 * A four-step width ramp was rejected: 4px shouts at the column floor, and a
 * 1.5px step rounds to 1 or 2 device pixels depending on the display — a rail
 * that changes thickness when you move the window to another monitor. Rhythm
 * has no such problem, which is why the pair sharing a thickness (P3/P4) is
 * told apart by it.
 *
 * The rail is drawn in `--foreground`, so it inverts with the theme and always
 * holds full contrast against its column. `opacity` below is applied to the
 * span, not baked into a color, so the same values serve both themes.
 */
export interface PriorityRail {
  /** Rail thickness in px. */
  width: number;
  /** 0–1. Applied to the rail span; the color is always `--foreground`. */
  opacity: number;
  /**
   * The repeating rhythm, in CSS pixels: `on` of mark, `off` of gap. `null` is
   * an unbroken line.
   *
   * Chosen so each level reads differently at the rail's REAL size — roughly
   * 27px on a card — rather than only in a swatch. Every period is 9px or
   * under so at least three marks land in that height; a longer one shows two
   * and reads as solid, which is an encoding that is present and invisible.
   * `priority.test.ts` holds that ceiling, and caught a 12px P2 that did
   * exactly this.
   *
   * P2's 6/3 is mostly ink with clear breaks; P3's 4/3 is plainly a broken
   * line; P4's 2/5 is dots with air around them.
   */
  dash: { on: number; off: number } | null;
  /** What a screen reader hears in place of the old `P1` chip. */
  label: string;
}

export const PRIORITY_RAILS: Record<Priority, PriorityRail> = {
  1: { width: 3, opacity: 1, dash: null, label: "Priority 1, highest" },
  2: { width: 2, opacity: 0.8, dash: { on: 6, off: 3 }, label: "Priority 2" },
  3: { width: 1, opacity: 0.62, dash: { on: 4, off: 3 }, label: "Priority 3" },
  4: { width: 1, opacity: 0.5, dash: { on: 2, off: 5 }, label: "Priority 4, lowest" },
};

/**
 * The rail's fill as a `background-image`, or `null` for a solid one.
 *
 * Every surface that draws a rail as a SPAN goes through this — the board
 * card, the homepage's echo of it, the sheet's leading edge — so a rhythm
 * cannot be right in one place and stale in another.
 */
export function railBackgroundImage(rail: PriorityRail): string | null {
  if (!rail.dash) return null;
  const { on, off } = rail.dash;
  return `repeating-linear-gradient(to bottom, var(--foreground) 0 ${on}px, transparent ${on}px ${on + off}px)`;
}

/**
 * The nearest `border-style` for a rail's rhythm, for the two surfaces that
 * draw it as a BORDER rather than a span — the drag chip and the sheet's
 * priority tab.
 *
 * An approximation, and knowingly so: CSS offers three line styles where the
 * table above has four rhythms, so P2 and P3 both land on `dashed`. They still
 * read apart, because a browser scales its dash length with the border width
 * and those two differ (2px against 1px). A border cannot express 9/3 against
 * 5/3 exactly, and a span cannot follow a rounded corner — each surface uses
 * the form its shape allows.
 */
export function railBorderStyle(rail: PriorityRail): "solid" | "dashed" | "dotted" {
  if (!rail.dash) return "solid";
  return rail.dash.on <= 2 ? "dotted" : "dashed";
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
