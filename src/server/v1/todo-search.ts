import type { Todo } from "@/lib/schema";

/**
 * Word search over to-dos for MCP `search_todos` and `GET /api/v1/todos?q=`
 * (EI-340). First caller: Pointer, which turns a spoken phrase into "which
 * to-do did they mean" before `complete_todo`.
 *
 * NOT `src/lib/search.ts`. The palette matches the typed phrase as one
 * substring, which is right while someone types and wrong for speech: "the
 * dentist thing" must still find "Dentist appointment". So this matches WORDS,
 * any of them, with a little tolerance for how speech gets transcribed.
 *
 * Synonyms are deliberately the caller's job. A client model already knows
 * couch ≈ sofa ≈ loveseat; it sends all three as terms, and any one hitting is
 * a match. A dictionary here would be a worse copy of what the model knows,
 * and embeddings would need an index write on every push.
 */

/** Words that name nothing — "the thing about my dentist" is one real word. */
const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "into", "is", "it", "my",
  "of", "on", "or", "our", "that", "the", "thing", "this", "to", "up", "with",
]);

/** Lower-case, accents stripped, split on anything not a letter or digit. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Query terms → the distinct words worth matching on. */
export function queryWords(terms: string | string[]): string[] {
  const words = (Array.isArray(terms) ? terms : [terms]).flatMap(tokenize);
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)))];
}

/**
 * Optimal string alignment distance, capped: returns as soon as the answer is
 * known to exceed `max`. One transposition ("dnetist") counts as one edit —
 * the commonest slip in both typing and transcription.
 */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    rows[i] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return false;
  }
  return rows[a.length][b.length] <= max;
}

const EXACT = 3;
const PREFIX = 2;
const TYPO = 1;

/**
 * How well one query word matches one to-do word: exact, a prefix either way
 * ("vacuum" / "vacuuming", 3+ characters), or one edit when both are 5+
 * characters long. Short words get no typo tolerance — "cat" is one edit from
 * "car", "bat" and "cut", and that is not a match anyone meant.
 */
function wordScore(query: string, word: string): number {
  if (query === word) return EXACT;
  const [short, long] = query.length <= word.length ? [query, word] : [word, query];
  if (short.length >= 3 && long.startsWith(short)) return PREFIX;
  if (short.length >= 5 && editDistanceWithin(query, word, 1)) return TYPO;
  return 0;
}

const best = (query: string, words: string[]) =>
  words.reduce((top, word) => Math.max(top, wordScore(query, word)), 0);

/** A title hit outweighs any description hit for the same query word. */
function todoScore(todo: Todo, words: string[]): number {
  const title = tokenize(todo.title);
  const description = todo.description ? tokenize(todo.description) : [];
  let score = 0;
  for (const query of words) {
    const inTitle = best(query, title);
    score += inTitle > 0 ? inTitle * 10 : best(query, description);
  }
  return score;
}

/**
 * The to-dos matching any of `terms`, best first: match quality, then open
 * before done, then most recently updated. Input order is ignored — relevance
 * IS the order. No terms (or only stop words) matches nothing.
 */
export function rankTodoMatches(todos: Todo[], terms: string | string[]): Todo[] {
  const words = queryWords(terms);
  if (words.length === 0) return [];

  return todos
    .map((todo) => ({ todo, score: todoScore(todo, words) }))
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.todo.status !== "open") - Number(b.todo.status !== "open") ||
        b.todo.updatedAt.localeCompare(a.todo.updatedAt),
    )
    .map((hit) => hit.todo);
}
