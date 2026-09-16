import { z } from "zod";
import { civilDateSchema, idSchema, todoSchema, todoStatusSchema, type Todo } from "@/lib/schema";
import { projectRow, splitCsv } from "./fields";
import { rankTodoMatches } from "./todo-search";

/**
 * Query filtering for `GET /api/v1/todos` (A13, EI-293).
 *
 * **Filtering happens in JS over already-parsed rows, not in SQL.** Three
 * reasons, in order of weight:
 *
 * 1. **`labelIds` is a JSON text column.** SQLite cannot index into it
 *    cleanly, and the `LIKE '%"id"%'` workaround is fragile against ids that
 *    are substrings of one another. Doing it in JS after `JSON.parse` is the
 *    same call `user-do.ts` already makes for the same column.
 * 2. **Zero injection surface.** Nothing a caller supplies is ever
 *    interpolated into SQL — the DO's read RPC takes no query at all.
 * 3. **It is testable without a Durable Object.** `filterTodos` below is
 *    pure, which is what `query.test.ts` exercises.
 *
 * The cost is that the DO always reads every row. That is what
 * `listEntities` already does for the board itself, so this adds no new
 * pressure — revisit if a single account's todo count ever makes the read
 * itself the problem, not the filter.
 */

/**
 * NOTE: `limit` has **no default**, deliberately.
 *
 * `GET /api/v1/todos` shipped in A2 (EI-227) returning every non-deleted
 * todo, and `openapi/v1.json` has been published with that contract since
 * A7. Giving `limit` a default — even a generous one — would silently
 * truncate every existing consumer's result set, which is a breaking change
 * dressed up as a nicety: an account with 500 todos would start seeing 200
 * with no error and no signal. Omitting `limit` still returns everything.
 *
 * A caller that wants pages asks for them. `max` is a ceiling on what a
 * caller may REQUEST, not a cap on what omitting it returns.
 */
export const todoQuerySchema = z.object({
  status: todoStatusSchema.optional(),
  listId: idSchema.optional(),
  scheduledDate: civilDateSchema.optional(),
  /** Matches a todo carrying this label among its `labelIds`. */
  labelId: idSchema.optional(),
  /** ISO-8601 instant. Todos with `updatedAt` strictly greater are returned —
   * the cheap "what changed since I last looked" a polling client wants.
   * Compared as strings, which is correct for ISO-8601 UTC and is the same
   * assumption `hlc-core.ts` documents for its own zero-padded stamps. */
  updatedSince: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** EI-340. Search terms, comma-separated — synonyms welcome. */
  q: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Search terms, comma-separated (e.g. `couch,sofa,loveseat`). A to-do matches if any word " +
        "matches its title or description — exactly, by prefix, or with one typo in words of 5+ " +
        "letters. When present, results are ordered by relevance instead of board order.",
    ),
  /** EI-340. Comma-separated field names; empty keeps every field. */
  fields: z
    .string()
    .min(1)
    .optional()
    .describe("Comma-separated field names to return, e.g. `id,title,status`. Default: every field."),
});

export type TodoQuery = z.infer<typeof todoQuerySchema>;

const TODO_FIELDS = Object.keys(todoSchema.shape) as [keyof Todo, ...(keyof Todo)[]];
export const todoFieldSchema = z.enum(TODO_FIELDS);
export type TodoField = z.infer<typeof todoFieldSchema>;

/** What MCP `list_todos` and `search_todos` return unless `fields` says
 * otherwise — enough for a model to tell two to-dos apart and act on one. */
export const SLIM_TODO_FIELDS: TodoField[] = [
  "id",
  "title",
  "status",
  "scheduledDate",
  "deadline",
  "listId",
  "priority",
];

/** `?fields=` → validated names, or `null` for an unknown field. */
export function parseTodoFields(fields: string | undefined): TodoField[] | null {
  const parsed = z.array(todoFieldSchema).safeParse(splitCsv(fields));
  return parsed.success ? parsed.data : null;
}

export const projectTodos = (todos: Todo[], fields: TodoField[], omitNull: boolean) =>
  todos.map((todo) => projectRow(todo, fields, omitNull));

/**
 * Parses a URL's query string. Returns `null` for a malformed value so the
 * caller can map that to a 400 — same convention as `./validate.ts` and
 * `sync/validate.ts`: parse to `null`, never throw.
 *
 * An absent parameter is absent, not empty: `?status=` (no value) is a
 * malformed status, not "no status filter". Callers that mean "no filter"
 * omit the key.
 */
export function parseTodoQuery(params: URLSearchParams): TodoQuery | null {
  const raw: Record<string, string> = {};
  for (const key of Object.keys(todoQuerySchema.shape)) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }

  const parsed = todoQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Applies the filters, then the search ranking, then the window. Order
 * matters: `offset`/`limit` page through the FILTERED set, which is the only
 * interpretation that lets a caller page consistently.
 *
 * Without `q`, input order is preserved — `listEntities` already returns board
 * order, and re-sorting here would be a second answer to "what order are todos
 * in". With `q`, relevance is the order (`rankTodoMatches`).
 */
export function filterTodos(todos: Todo[], query: TodoQuery): Todo[] {
  const matched = todos.filter((todo) => {
    if (query.status !== undefined && todo.status !== query.status) return false;
    if (query.listId !== undefined && todo.listId !== query.listId) return false;
    if (query.scheduledDate !== undefined && todo.scheduledDate !== query.scheduledDate) {
      return false;
    }
    if (query.labelId !== undefined && !todo.labelIds.includes(query.labelId)) return false;
    if (query.updatedSince !== undefined && !(todo.updatedAt > query.updatedSince)) return false;
    return true;
  });

  const ranked = query.q === undefined ? matched : rankTodoMatches(matched, splitCsv(query.q));

  const offset = query.offset ?? 0;
  if (offset === 0 && query.limit === undefined) return ranked;

  return ranked.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
}
