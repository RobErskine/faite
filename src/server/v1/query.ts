import { z } from "zod";
import { civilDateSchema, idSchema, todoStatusSchema, type Todo } from "@/lib/schema";

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
});

export type TodoQuery = z.infer<typeof todoQuerySchema>;

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
 * Applies the filters, then the window. Order matters: `offset`/`limit`
 * page through the FILTERED set, which is the only interpretation that lets
 * a caller page consistently.
 *
 * Input order is preserved — `listEntities` already returns board order, and
 * re-sorting here would be a second answer to "what order are todos in".
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

  const offset = query.offset ?? 0;
  if (offset === 0 && query.limit === undefined) return matched;

  return matched.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
}
