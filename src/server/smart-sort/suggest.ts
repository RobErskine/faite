import { askJev, describeTodo, JEV_MODEL, type JevResponse, type TodoText } from "../duplicates/check";

/**
 * Smart sorting (EI-367) — which of the user's lists a Backlog to-do belongs
 * in, as a proposal the user confirms. Kept free of SQLite and the Durable
 * Object, like `duplicates/check.ts`, so it is tested with a fake `fetch`. The
 * DO glue (choosing the to-dos, writing `suggestedListId` through `push()`) is
 * in `user-do.ts`; the design is `docs/SMART-SORT.md`.
 *
 * One Jev **Choice** per to-do: the options are the user's lists plus `none`.
 * A Choice fits here where duplicates needed Nouls — exactly one list is
 * wanted, and `none` gives the model a way to say nothing fits
 * (https://docs.typesafe.ai/primitives/choice.md). All the to-dos go in one
 * `state` array and question i points at `todos[i]`, so the list
 * descriptions are the only thing repeated per question.
 */

/** A proposal is stored only at or above this Choice `confidence` and when
 * the choice is a list, not `none`. A start, not a measurement: a wrong
 * proposal costs one dismiss, and nothing moves without the user, so it errs
 * toward proposing (https://docs.typesafe.ai/confidence.md). */
export const SUGGEST_THRESHOLD = 0.5;
/** A Choice takes up to 255 options; one is `none`. Past this the account is
 * skipped rather than shown a partial set it would not know about. */
export const MAX_LIST_OPTIONS = 254;
/** Questions per request. Each carries every list's description, so this is
 * kept small; chunks run in parallel. */
export const QUESTIONS_PER_REQUEST = 10;
const NONE = "none";
const DESCRIPTION_MAX = 300;

export interface ListOption {
  id: string;
  name: string;
  /** The tab the list sits on — "Work › Inbox" and "Home › Inbox" are two
   * different answers. */
  tabName: string | null;
  description: string | null;
}

/**
 * Option keys the model reads as names (`groceries`, `home_projects`), unique
 * and never `none`. The model sees them, so they come from the list's name
 * rather than its id; code maps them back.
 */
export function optionKeys(lists: ListOption[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const list of lists) {
    const base =
      list.name
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "list";
    let key = base === NONE ? "list_none" : base;
    for (let n = 2; keys.has(key); n++) key = `${base}_${n}`;
    keys.set(key, list.id);
  }
  return keys;
}

function optionText(list: ListOption): string {
  const where = list.tabName ? `The "${list.name}" list, on the "${list.tabName}" tab.` : `The "${list.name}" list.`;
  const description = list.description?.trim().slice(0, DESCRIPTION_MAX);
  return description ? `${where} ${description}` : where;
}

/** One request's body, for `todos` (at most `QUESTIONS_PER_REQUEST`). Dates
 * are left out: which list a task belongs in does not depend on them. */
export function buildSuggestRequest(todos: TodoText[], lists: ListOption[], keys: Map<string, string>) {
  const listById = new Map(lists.map((list) => [list.id, list]));
  const criteria: Record<string, string> = {};
  for (const [key, id] of keys) criteria[key] = optionText(listById.get(id)!);
  criteria[NONE] = "None of these lists clearly fits this to-do.";

  return {
    model: JEV_MODEL,
    state: { todos: todos.map(describeTodo) },
    questions: Object.fromEntries(
      todos.map((_, i) => [
        `q${i}`,
        {
          type: "choice",
          instructions: `Which of the user's to-do lists does the to-do \`todos[${i}]\` belong in? Choose \`${NONE}\` unless one list clearly fits.`,
          criteria,
        },
      ]),
    ),
  };
}

/** The list id for each question, or null for `none`, an unknown key, or a
 * confidence under `SUGGEST_THRESHOLD`. */
export function parseSuggestions(response: JevResponse, count: number, keys: Map<string, string>): (string | null)[] {
  return Array.from({ length: count }, (_, i) => {
    const answer = response.answers?.[`q${i}`];
    if (!answer || typeof answer.confidence !== "number" || answer.confidence < SUGGEST_THRESHOLD) return null;
    return (answer.choice && keys.get(answer.choice)) || null;
  });
}

/**
 * A proposed list id per to-do, in order, or null where nothing fits well
 * enough. Returns all nulls without calling Jev when there are no lists or too
 * many. Throws on any Jev failure — the caller logs it and proposes nothing.
 */
export async function suggestLists(
  apiKey: string,
  todos: TodoText[],
  lists: ListOption[],
  fetchImpl: typeof fetch = fetch,
): Promise<(string | null)[]> {
  if (todos.length === 0) return [];
  if (lists.length === 0 || lists.length > MAX_LIST_OPTIONS) return todos.map(() => null);

  const keys = optionKeys(lists);
  const chunks: TodoText[][] = [];
  for (let i = 0; i < todos.length; i += QUESTIONS_PER_REQUEST) {
    chunks.push(todos.slice(i, i + QUESTIONS_PER_REQUEST));
  }
  const responses = await Promise.all(
    chunks.map((chunk) => askJev(apiKey, buildSuggestRequest(chunk, lists, keys), fetchImpl)),
  );
  return responses.flatMap((response, i) => parseSuggestions(response, chunks[i].length, keys));
}
