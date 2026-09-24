import type { Todo } from "@/lib/schema";

/**
 * Substring search over to-dos, for the command palette.
 *
 * Deliberately NOT fuzzy. cmdk applies its own subsequence scoring on top of
 * whatever we render, and a substring match is always a subsequence match — so
 * matching on substrings here guarantees every row we hand cmdk survives its
 * filter. A fuzzier matcher would silently drop rows this module considers
 * hits, which reads as a broken search rather than a strict one.
 *
 * Ranking is by *where* the query landed, not by a blended score. Someone
 * typing "gro" wants "Groceries" before "Buy eggs at the grocery store", and a
 * fixed tier order is both predictable and trivial to reason about.
 */

/** Match tiers, best first. Lower sorts earlier. */
const TITLE_PREFIX = 0;
const TITLE_WORD_PREFIX = 1;
const TITLE_SUBSTRING = 2;
const DESCRIPTION_SUBSTRING = 3;

/** Keeps the palette a glance rather than a scroll. */
export const SEARCH_LIMIT = 8;

/**
 * Which tier a to-do matches at, or null when it does not match at all.
 *
 * `query` must already be trimmed and lower-cased — this runs once per to-do
 * per keystroke, so the normalization is hoisted to the caller.
 */
function tier(todo: Todo, query: string): number | null {
  const title = todo.title.toLowerCase();

  if (title.startsWith(query)) return TITLE_PREFIX;
  if (title.split(/\s+/).some((word) => word.startsWith(query))) {
    return TITLE_WORD_PREFIX;
  }
  if (title.includes(query)) return TITLE_SUBSTRING;
  if (todo.description?.toLowerCase().includes(query)) {
    return DESCRIPTION_SUBSTRING;
  }
  return null;
}

/** Trimmed + lower-cased — the shape every matcher in this module assumes. */
export const normalizeQuery = (query: string): string => query.trim().toLowerCase();

/**
 * Does this to-do match `query` at all?
 *
 * The palette RANKS by `tier` because a fixed order is the whole point there.
 * A column filter only needs the yes/no and must never re-order — reordering
 * mid-column would scramble the hand-arranged `position` order the moment you
 * typed a character, and un-scramble it when you cleared. So it takes this.
 *
 * `query` must already be `normalizeQuery`d and non-empty.
 */
export function matchesQuery(todo: Todo, query: string): boolean {
  return tier(todo, query) !== null;
}

/** Open work outranks finished work at the same tier. */
const statusRank = (todo: Todo): number => (todo.status === "open" ? 0 : 1);

/**
 * Highest-ranked to-dos matching `query`, capped at `limit`.
 *
 * Returns [] for an empty query rather than every to-do: the palette shows its
 * command list until the user actually types something to search for.
 */
export function searchTodos(
  query: string,
  todos: Todo[],
  limit: number = SEARCH_LIMIT,
): Todo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const hits: { todo: Todo; tier: number }[] = [];
  for (const todo of todos) {
    if (todo.deletedAt) continue;
    const t = tier(todo, q);
    if (t !== null) hits.push({ todo, tier: t });
  }

  hits.sort(
    (a, b) =>
      a.tier - b.tier ||
      statusRank(a.todo) - statusRank(b.todo) ||
      // Recently touched first. Timestamps are ISO strings, so they compare
      // lexicographically without parsing.
      b.todo.updatedAt.localeCompare(a.todo.updatedAt),
  );

  return hits.slice(0, limit).map((hit) => hit.todo);
}

/**
 * At most one row per recurring series — the NEXT occurrence, not the history.
 *
 * A repeating to-do's settled occurrences are real rows (`recurrenceParentId`
 * set, materialized the moment they were ticked), while the one that is
 * actually coming up is usually a VIRTUAL card that `expandRecurrences()`
 * synthesizes for the board and never writes down. Handed the raw table,
 * search therefore showed a weekly chore as a column of its own completed
 * Wednesdays and never as the Wednesday to come (EI-341). Feed this the
 * expansion's output instead (see `searchableTodos` in `use-board-data.ts`)
 * and each series collapses to the single card the board itself is showing.
 *
 * Which one survives, per series:
 *
 * 1. The earliest OPEN occurrence by `scheduledDate`. That is "next" whether
 *    it is days away, due today, or overdue and sitting in Overflow — the
 *    same card the board renders. Undated sorts last (a series occurrence
 *    always has a date; the ORIGIN row a series was grown from, via
 *    `createSeriesFromTodo`, need not) and `id` breaks the tie, so the result
 *    does not depend on the order the caller happened to build its array in.
 * 2. Failing that — every occurrence settled and the next one past the
 *    rendered day window, which is what a yearly series looks like on a
 *    30-day board — the most recently updated settled row. Strictly a
 *    fallback: one row of history beats a to-do that cannot be found at all.
 *
 * To-dos with no `recurrenceParentId` pass through untouched, order
 * preserved, which is what keeps an ordinary completed to-do searchable
 * exactly as before. Soft-deleted rows are dropped outright: the expansion
 * deliberately carries tombstoned children (it needs them to detect that a
 * series moved past a slot) and a skipped occurrence must not win its group.
 */
export function collapseRecurringSeries(todos: Todo[]): Todo[] {
  const winners = new Map<string, Todo>();
  const out: Todo[] = [];
  /** Group id -> its slot in `out`, so a later winner replaces in place. */
  const slots = new Map<string, number>();

  for (const todo of todos) {
    if (todo.deletedAt) continue;

    const seriesId = todo.recurrenceParentId;
    if (!seriesId) {
      out.push(todo);
      continue;
    }

    const held = winners.get(seriesId);
    if (!held) {
      winners.set(seriesId, todo);
      slots.set(seriesId, out.length);
      out.push(todo);
      continue;
    }

    if (beats(todo, held)) {
      winners.set(seriesId, todo);
      out[slots.get(seriesId)!] = todo;
    }
  }

  return out;
}

/** Does `candidate` outrank `held` as the one row its series gets? */
function beats(candidate: Todo, held: Todo): boolean {
  const candidateOpen = candidate.status === "open";
  const heldOpen = held.status === "open";
  if (candidateOpen !== heldOpen) return candidateOpen;

  if (candidateOpen) {
    // Earliest first, undated last.
    if (candidate.scheduledDate !== held.scheduledDate) {
      if (!candidate.scheduledDate) return false;
      if (!held.scheduledDate) return true;
      return candidate.scheduledDate < held.scheduledDate;
    }
    return candidate.id < held.id;
  }

  // Both settled: most recently touched, `id` breaking the tie for the same
  // reason as above — a stable answer regardless of input order.
  if (candidate.updatedAt !== held.updatedAt) {
    return candidate.updatedAt > held.updatedAt;
  }
  return candidate.id < held.id;
}
