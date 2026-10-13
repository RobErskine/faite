import { createAuth } from "../auth";
import { corsHeaders, handleOptions } from "../cors";

/**
 * `POST /api/smart-sort/suggest` — proposed lists for up to `MAX_TODOS`
 * to-dos. Body `{ todos: [{ id, title, description? }] }`, answer
 * `{ suggestions: { [id]: listId | null } }`.
 *
 * Two callers: the board, the moment it creates a Backlog to-do (EI-373), and
 * Quick sort on open (EI-370). It takes the to-do's TEXT, not an id, because
 * a board create has not synced yet — waiting for it to is the delay this
 * route exists to skip. `id` is only echoed back as the answer's key.
 *
 * Writes nothing; the caller decides what to do with the answer. Cookie
 * session only, like `/api/duplicates/key` — it spends the user's own
 * TypeSafe credit, so an API token may not.
 *
 * 409 `no-key` when no Jev key is saved, so the client can stop asking; 502
 * when Jev fails, which the client treats as "no pre-selection".
 */

export const MAX_TODOS = 50;
const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 500;
/** Matches the engine's own cut (`describeTodo`), with room to spare. */
const MAX_DESCRIPTION_LENGTH = 2_000;

interface TodoText {
  id: string;
  title: string;
  description: string | null;
}

/** The validated body, or null for anything malformed. */
function parseTodos(body: unknown): TodoText[] | null {
  const todos = (body as { todos?: unknown } | null)?.todos;
  if (!Array.isArray(todos) || todos.length === 0 || todos.length > MAX_TODOS) return null;
  const parsed: TodoText[] = [];
  const seen = new Set<string>();
  for (const todo of todos) {
    const { id, title, description } = (todo ?? {}) as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
    if (typeof title !== "string" || title.trim() === "" || title.length > MAX_TITLE_LENGTH) return null;
    if (description != null && (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH)) {
      return null;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    parsed.push({ id, title, description: (description as string | null | undefined) ?? null });
  }
  return parsed;
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export async function handleSmartSortRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  if (url.pathname !== "/api/smart-sort/suggest") return json({ error: "not-found" }, 404, headers);
  if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405, headers);

  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401, headers);

  const todos = parseTodos(await request.json().catch(() => null));
  if (!todos) return json({ error: "invalid-todos" }, 422, headers);

  const stub = env.USER_DO.get(env.USER_DO.idFromName(session.user.id));
  try {
    const result = await stub.suggestListsFor(todos);
    if (!result.connected) return json({ error: "no-key" }, 409, headers);
    return json({ suggestions: result.suggestions }, 200, headers);
  } catch (error) {
    console.warn("[faite] list suggestions failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "jev-unavailable" }, 502, headers);
  }
}
