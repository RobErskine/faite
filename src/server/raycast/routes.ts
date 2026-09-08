import { createAuth, getSessionSafe } from "../auth";
import { RAYCAST_KEY_NAME, RAYCAST_KEY_PERMISSIONS } from "../auth-scopes";
import { corsHeaders, handleOptions } from "../cors";
import {
  decodeHandoffCode,
  encodeHandoffCode,
  RAYCAST_HANDOFF_INFO,
} from "../desktop/handoff-code";

/**
 * `/api/raycast/*` — the one-click account connect for the Raycast extension
 * (A18, EI-298). Same seam as every other route here: not a Next.js Route
 * Handler, for the `output: export` reason `worker.ts` explains.
 *
 * Two endpoints, two different callers, mirroring `/api/desktop/*`:
 *
 * - `/handoff` is called from the SYSTEM BROWSER (real `https://myfaite.app`
 *   origin, cookie session already present) by `app/raycast-handoff/page.tsx`
 *   right after a normal sign-in. It mints a real API key and hands back an
 *   encrypted, short-lived CODE — never the key — for the page to put in the
 *   `raycast://` deep link.
 * - `/exchange` is called from the EXTENSION (Node, no cookie, no Origin)
 *   once Raycast hands it that deep link. It trades the code for the key.
 *
 * ## Why a sibling of `desktop/routes.ts` rather than a generalization
 *
 * That route's body is ~15 lines, and the two grants genuinely differ: the
 * desktop key is full-equivalence (`sync`, `places`) because the shell
 * replicates the board; the Raycast key is `read`+`write` only, because a
 * third-party client has no local store to reconcile. A shared "handoff
 * factory" parameterized by scope, key name, HKDF info and deep-link target
 * would cost more to read than the duplication, and would put the one thing
 * that must never be confused — which client gets which scope — behind an
 * argument.
 *
 * What IS shared is the crypto, with its own domain separator
 * (`RAYCAST_HANDOFF_INFO`). See `handoff-code.ts` for why sharing the
 * separator instead would make the two flows' codes interchangeable, and
 * therefore make this narrower grant redeemable for the desktop's wider one.
 *
 * ## The code is TTL-bounded, not single-use
 *
 * Inherited from the desktop flow and restated rather than assumed: nothing
 * stops the same code being exchanged twice inside its 60s window. That bar
 * was set for a same-machine loopback handoff, and this is the same shape —
 * the code goes from the user's own browser to the user's own Raycast via the
 * OS's URL dispatch. It is not a general-purpose OAuth authorization-code
 * implementation and should not be reused as one.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

async function readCode(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  const code = (body as { code: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export async function handleRaycastRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  const auth = createAuth(env, request);

  if (url.pathname === "/api/raycast/handoff" && request.method === "POST") {
    // `getSessionSafe`, not `auth.api.getSession()` — see its doc comment.
    // This route is cookie-only in practice, but a stray `Authorization`
    // header sent here by mistake would otherwise throw rather than resolve
    // to `null`.
    const session = await getSessionSafe(auth, request);
    if (!session) return json({ error: "unauthenticated" }, 401, headers);

    // Deliberately NO `headers` on this call, and an EXPLICIT `userId`.
    // Copied verbatim from `desktop/routes.ts` because the reason is not
    // obvious and getting it wrong fails at runtime, not at compile time:
    // `permissions` is a server-only property, and `@better-auth/api-key`
    // decides "is this a server call" by checking `ctx.request || ctx.headers`
    // — ANY headers at all, not specifically a session cookie. Passing the
    // request's headers here would make this look like a public client
    // request and throw `SERVER_ONLY_PROPERTY` the moment `permissions` is
    // present. The session is already resolved above, so its id is supplied
    // directly.
    const created = await auth.api.createApiKey({
      body: {
        name: RAYCAST_KEY_NAME,
        permissions: RAYCAST_KEY_PERMISSIONS,
        userId: session.user.id,
      },
    });

    const code = await encodeHandoffCode(
      created.key,
      env.BETTER_AUTH_SECRET,
      RAYCAST_HANDOFF_INFO,
    );
    return json({ code }, 200, headers);
  }

  if (url.pathname === "/api/raycast/exchange" && request.method === "POST") {
    const code = await readCode(request);
    if (!code) return json({ error: "invalid-request" }, 400, headers);

    // The Raycast separator, so a desktop code presented here is rejected as
    // an ordinary auth-tag failure — see `handoff-code.ts`.
    const token = await decodeHandoffCode(code, env.BETTER_AUTH_SECRET, RAYCAST_HANDOFF_INFO);
    if (!token) return json({ error: "invalid-or-expired-code" }, 401, headers);

    return json({ token }, 200, headers);
  }

  return json({ error: "not-found" }, 404, headers);
}
