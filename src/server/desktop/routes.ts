import { createAuth, getSessionSafe } from "../auth";
import { corsHeaders, handleOptions } from "../cors";
import { decodeHandoffCode, encodeHandoffCode } from "./handoff-code";

/**
 * `/api/desktop/*` — D2a's login handoff. Same seam as `/api/auth/*` and
 * `/api/sync/*` in `worker.ts`: not a Next.js Route Handler, for the same
 * `output: export` reason (see `worker.ts`'s file comment).
 *
 * Two endpoints, two different callers:
 *
 * - `/handoff` is called from the SYSTEM BROWSER (real `https://myfaite.app`
 *   origin, same-origin, cookie session already present) right after a
 *   normal sign-in. It mints a real API key and hands back an encrypted,
 *   short-lived code — never the key itself — for the browser to put in the
 *   `faite://auth-callback` redirect.
 * - `/exchange` is called from the DESKTOP APP (`tauri://localhost`,
 *   genuinely cross-origin, no cookie) once it receives that deep link. It
 *   trades the code for the real key. This is the only place the plaintext
 *   key crosses the wire a second time, and it never touches a URL or
 *   browser history — see `docs/DESKTOP.md` §9 and `handoff-code.ts`'s file
 *   comment for why the indirection exists at all.
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

export async function handleDesktopRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  const auth = createAuth(env, request);

  if (url.pathname === "/api/desktop/handoff" && request.method === "POST") {
    // `getSessionSafe`, not `auth.api.getSession()` directly — see its own
    // doc comment (`auth.ts`). This route is normally cookie-only (called
    // from the system browser), but a malformed `Authorization` header sent
    // here by mistake would still throw rather than resolve to `null`.
    const session = await getSessionSafe(auth, request);
    if (!session) return json({ error: "unauthenticated" }, 401, headers);

    // Named for the eventual revocation UI (EI-50/auth-tokens.ts's own
    // "requireName" comment: an unnamed key is one nobody can identify six
    // months from now). No explicit `userId` — passing one here is not just
    // unnecessary but rejected outright when a session is present (see
    // `@better-auth/api-key`'s own guard), since the point is to bind the
    // key to whoever this cookie actually belongs to.
    const created = await auth.api.createApiKey({
      body: { name: "Faite desktop" },
      headers: request.headers,
    });

    const code = await encodeHandoffCode(created.key, env.BETTER_AUTH_SECRET);
    return json({ code }, 200, headers);
  }

  if (url.pathname === "/api/desktop/exchange" && request.method === "POST") {
    const code = await readCode(request);
    if (!code) return json({ error: "invalid-request" }, 400, headers);

    const token = await decodeHandoffCode(code, env.BETTER_AUTH_SECRET);
    if (!token) return json({ error: "invalid-or-expired-code" }, 401, headers);

    return json({ token }, 200, headers);
  }

  return json({ error: "not-found" }, 404, headers);
}
