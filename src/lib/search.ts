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
 * per keystroke, so the normalisation is hoisted to the caller.
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
