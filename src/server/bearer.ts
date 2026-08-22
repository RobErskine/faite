import { extractWsBearerToken } from "./desktop/ws-bearer";

/**
 * The one place a bearer credential is read off a request: `Authorization:
 * Bearer …`, or — the one shape that cannot set headers at all — the
 * WebSocket handshake's `Sec-WebSocket-Protocol`.
 *
 * Split into its own module (no dependency on `auth.ts` or `auth-scopes.ts`)
 * because both need it and neither should depend on the other: `auth-tokens.ts`
 * calls it from `customAPIKeyGetter` (Better Auth's own extraction hook,
 * consulted while building the session), and `auth-scopes.ts` calls it again,
 * independently, to decide whether a route needs a scope check at all. Two
 * independently drifting copies would mean the plugin's session hook and the
 * scope gate could disagree about whether a request "has a key."
 *
 * Takes a bare `Headers`, NOT a `Request` — every caller in `src/server` only
 * ever has `ctx.headers`/`request.headers`, since `auth.api.getSession({
 * headers })` (the "headers-only" call shape every route here uses) leaves a
 * hook's `ctx.request` `undefined`. A `Request`-typed parameter would compile
 * fine and then silently find nothing the moment it's called from that
 * context — found live against a real Durable Object, not by a unit test.
 */
export function extractBearerCredential(headers: Headers | null | undefined): string | null {
  const header = headers?.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return extractWsBearerToken(headers?.get("sec-websocket-protocol") ?? null);
}
