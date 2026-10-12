import { createAuth } from "../auth";
import { corsHeaders, handleOptions } from "../cors";

/**
 * `POST /api/smart-sort/suggest` — proposed lists for up to `MAX_TODO_IDS`
 * to-dos, for Quick sort to pre-select (EI-367). Body `{ todoIds: string[] }`,
 * answer `{ suggestions: { [todoId]: listId | null } }`.
 *
 * Writes nothing: a pre-selection is not a decision, and only the push hook
 * stores `suggestedListId`. Cookie session only, like `/api/duplicates/key` —
 * it spends the user's own TypeSafe credit, so an API token may not.
 *
 * 409 `no-key` when no Jev key is saved, so the client can stop asking; 502
 * when Jev fails, which the client treats as "no pre-selection".
 */

export const MAX_TODO_IDS = 50;

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

  const body = (await request.json().catch(() => null)) as { todoIds?: unknown } | null;
  const todoIds = body?.todoIds;
  if (
    !Array.isArray(todoIds) ||
    todoIds.length === 0 ||
    todoIds.length > MAX_TODO_IDS ||
    !todoIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 64)
  ) {
    return json({ error: "invalid-todo-ids" }, 422, headers);
  }

  const stub = env.USER_DO.get(env.USER_DO.idFromName(session.user.id));
  try {
    const result = await stub.suggestListsFor([...new Set(todoIds as string[])]);
    if (!result.connected) return json({ error: "no-key" }, 409, headers);
    return json({ suggestions: result.suggestions }, 200, headers);
  } catch (error) {
    console.warn("[faite] list suggestions failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "jev-unavailable" }, 502, headers);
  }
}
