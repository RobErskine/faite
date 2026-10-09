import { createAuth } from "../auth";
import { corsHeaders, handleOptions } from "../cors";

/**
 * `/api/duplicates/key` — save, inspect and remove the caller's own TypeSafe
 * Jev key (EI-346).
 *
 * Same seam as `/api/email/*`: a cookie session only, never an API token —
 * a script holding a Faite token has no business replacing the user's
 * third-party key. Scoped to `session.user.id`; nothing here takes a user id
 * from the request.
 *
 * The key goes in and never comes back out: GET reports only whether one is
 * saved and its last four characters.
 */

const MAX_KEY_LENGTH = 512;

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export async function handleDuplicatesRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  if (url.pathname !== "/api/duplicates/key") return json({ error: "not-found" }, 404, headers);

  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401, headers);
  const stub = env.USER_DO.get(env.USER_DO.idFromName(session.user.id));

  try {
    if (request.method === "GET") {
      return json(await stub.jevKeyStatus(), 200, headers);
    }
    if (request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { apiKey?: unknown } | null;
      const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
      if (!apiKey || apiKey.length > MAX_KEY_LENGTH) return json({ error: "invalid-key" }, 422, headers);
      const check = await stub.setJevKey(apiKey);
      if (check === "invalid") return json({ error: "rejected-by-jev" }, 422, headers);
      return json({ ...(await stub.jevKeyStatus()), check }, 200, headers);
    }
    if (request.method === "DELETE") {
      await stub.clearJevKey();
      return json(await stub.jevKeyStatus(), 200, headers);
    }
    return json({ error: "method-not-allowed" }, 405, headers);
  } catch (error) {
    console.error("[faite] duplicates key route failed", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}
