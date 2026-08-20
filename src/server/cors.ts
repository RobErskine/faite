import { TRUSTED_ORIGINS } from "./auth";

/**
 * CORS for both worker-owned seams — `/api/auth/*` and `/api/sync/*`.
 *
 * Cross-origin is not an edge case here, it is the normal local workflow:
 * `next dev` serves the UI on :3000 while the worker (and therefore all of
 * `/api/*`) only exists under `npm run preview` on :8787, and Capacitor's
 * WebView at P7 is a third origin again. Better Auth does NOT emit these
 * headers itself — `trustedOrigins` gates CSRF and redirect targets, not
 * responses — so without this the browser kills the preflight and every
 * sign-in fails as an opaque "Failed to fetch".
 *
 * One allow-list (`TRUSTED_ORIGINS`, src/server/auth.ts) and one
 * implementation, so the two seams cannot drift.
 */

/** Echoes the origin rather than `*`: both clients send `credentials:
 * "include"`, and the wildcard is illegal with credentials. An origin off the
 * allow-list gets `{}` — no header, not a header saying "no". */
export function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !TRUSTED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request.headers.get("Origin")),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      // Authorization (D2a): the desktop shell's bearer token on
      // `/api/sync/push`/`/api/sync/pull`/etc. — genuinely cross-origin from
      // `tauri://localhost`, unlike the cookie-based browser case, so it
      // needs to clear preflight.
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

/**
 * Adds the headers to a response built elsewhere — i.e. Better Auth's, which
 * `/api/sync/*` never needs because it builds its own responses.
 *
 * Copies via `new Response(body, response)` because a handler's headers are
 * immutable. That form carries every existing header through, `Set-Cookie`
 * included — do not "simplify" it into rebuilding the header list by hand, or
 * sign-in returns 200 and silently sets no session.
 */
export function withCors(response: Response, origin: string | null): Response {
  const headers = corsHeaders(origin);
  if (!Object.keys(headers).length) return response;

  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) out.headers.set(key, value);
  return out;
}
