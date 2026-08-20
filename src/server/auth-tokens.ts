import { apiKey } from "@better-auth/api-key";
import { extractWsBearerToken } from "./desktop/ws-bearer";

/**
 * API token scaffold for EI-50 P5 (scoped-down), cut over for D2a
 * (`docs/DESKTOP.md` §9): the desktop shell mints one of these keys via
 * `/api/desktop/handoff` and presents it on every subsequent request.
 *
 * `enableSessionForAPIKeys: true` (flipped below) is the actual cutover, and
 * it is deliberately GLOBAL, not scoped to `/api/sync/*`: a valid key now
 * satisfies `auth.api.getSession()` at every endpoint that calls it,
 * including Better Auth's own `/api/auth/get-session` — which is exactly
 * what makes `useSession()` (and therefore the whole app's signed-in UI:
 * `SessionProvider`, `app-header.tsx`, everywhere) recognize a desktop-shell
 * login as signed-in, not just the sync transport underneath it. A
 * route-local check (an earlier draft of this file had `sync/routes.ts`
 * call `verifyApiKey()` itself) would have left `useSession()` blind to a
 * successful desktop login — sync would authenticate while the header still
 * offered "Sign in". One mechanism, every consumer, is the point.
 *
 * **The real cost of "global," stated rather than hidden:** a desktop key is
 * meant to be full-session-equivalent — that's the correct semantic for "this
 * is me, on my own device," matching decision #3's "bearer tokens, not
 * cookies" framing exactly. But `permissions`/`defaultPermissions` below are
 * NOT enforced by anything in this codebase today (no call site passes a
 * `permissions` argument to `verifyApiKey`), so if this plugin ever grows a
 * SECOND consumer — e.g. EI-50's original vision of a user-generated,
 * intentionally scoped read-only external API token — that token would ALSO
 * be full-session-equivalent the moment it's created, not the narrow "read"
 * scope its own `defaultPermissions` implies. Revisit `enableSessionForAPIKeys`
 * (narrow it to specific routes, or start actually checking `permissions`)
 * before shipping that second consumer, not after.
 *
 * `customAPIKeyGetter` below checks both places a key can arrive: the
 * ordinary `Authorization: Bearer` header, and — for the one request shape
 * that cannot set headers at all — the WebSocket handshake's
 * `Sec-WebSocket-Protocol` value (`desktop/ws-bearer.ts`). This is what lets
 * `sync/routes.ts`'s pre-upgrade check for `/api/sync/ws` stay a single
 * `getSession()` call too, same as every other route.
 *
 * Why Better Auth's own plugin rather than a hand-rolled table: docs/API.md
 * asked to check fit before hand-rolling, and it fits well —
 *   - **generated**: `customKeyGenerator` left at the default (crypto-random,
 *     `defaultKeyLength` bytes, `defaultPrefix` prepended below).
 *   - **stored hashed, not plaintext**: `disableKeyHashing` defaults to
 *     `false` and is left alone; the plaintext key is returned to the caller
 *     exactly once, at `createApiKey` time, and never again — `getApiKey`/
 *     `listApiKeys` return everything else (name, prefix, `start`, expiry,
 *     usage) but not `key`.
 *   - **associated with a user**: `referenceId` defaults to the session
 *     user's id (see `references` below) — one key always belongs to exactly
 *     one Faite account, addressing that account's Durable Object.
 *   - **validated**: `auth.api.verifyApiKey({ key })` looks the hash up,
 *     checks `enabled`/`expiresAt`/rate limit, and returns the key row (sans
 *     `key`) or a typed error — see `API_KEY_ERROR_CODES` re-exported below
 *     for the shape a future route would map to HTTP statuses.
 *
 * Presented over `Authorization: Bearer <token>` rather than the plugin's
 * `x-api-key` default, via `customAPIKeyGetter` — matching ordinary REST/MCP
 * bearer-token convention (and docs/API.md's framing of this as "bearer
 * auth") rather than introducing a second header convention. The default
 * `x-api-key` header still works too; `apiKeyHeaders` is left at its default
 * so nothing is removed, only added to.
 */
export const apiTokenPlugin = apiKey({
  // A verified token reads "faite_xxxxxxxx…" instead of a bare hex blob —
  // legible in a `curl -H "Authorization: Bearer faite_…"`, and matches
  // Better Auth's own recommendation to suffix the prefix with `_`.
  defaultPrefix: "faite_",

  // A key with no name is a key nobody can identify in a revocation list six
  // months from now. Cheap to require at creation, expensive to reconstruct
  // later — same reasoning `todoSchema.title` requires a value.
  requireName: true,

  customAPIKeyGetter: (ctx) => {
    // `ctx.headers`, NOT `ctx.request?.headers` — the plugin's own default
    // getter reads `ctx.headers` too (see `getApiKeyFromConfig` in
    // `@better-auth/api-key`'s source). The two are NOT interchangeable:
    // `ctx.request` is only set when an endpoint is dispatched from a real
    // `Request` (Better Auth's own HTTP router). `sync/routes.ts` calls
    // `auth.api.getSession({ headers: request.headers })` — headers only,
    // no `request` — which is `dispatchAuthEndpoint`'s documented "canonical
    // hook runner" path (`auth.api.*` and the router both reach it), but
    // leaves `ctx.request` `undefined`. Reading `ctx.request?.headers` here
    // made this getter silently find nothing for every `/api/sync/*` call,
    // while still working for the one call site (`worker.ts`'s `/api/auth`
    // branch) that dispatches via a real `Request` — caught by testing
    // against a real Durable Object, not by the unit tests, which never
    // exercise the "headers-only" call shape.
    const header = ctx.headers?.get("authorization");
    if (header?.startsWith("Bearer ")) {
      const token = header.slice("Bearer ".length).trim();
      if (token.length > 0) return token;
    }
    // No Authorization header — try the WebSocket-upgrade carrier. Absent on
    // every ordinary request (browsers never send this header outside a
    // socket handshake), so this is a no-op fallback everywhere except
    // `/api/sync/ws`.
    return extractWsBearerToken(ctx.headers?.get("sec-websocket-protocol") ?? null);
  },

  // Tokens expire by default rather than living forever the moment they're
  // forgotten about in a script — 90 days is a starting guess, not a
  // researched number; the D2 cutover should revisit it. `disableCustomExpiresTime`
  // is left `false` so a caller can request something shorter (never longer,
  // per `maxExpiresIn`).
  keyExpiration: {
    defaultExpiresIn: 1000 * 60 * 60 * 24 * 90,
    minExpiresIn: 1,
    maxExpiresIn: 365,
  },

  // Per-KEY throttling. Deliberately separate from — and not a substitute
  // for — the per-USER limit docs/API.md flags as still open ("Rate limits
  // keyed on what?"): the DO's own ~1,000 req/s soft ceiling is per Durable
  // Object (i.e. per user, across every key and every session that user
  // has), while this is per INDIVIDUAL token. Both are real and this only
  // covers one of them; see docs/API.md before wiring a route that relies on
  // this alone.
  rateLimit: {
    enabled: true,
    timeWindow: 1000 * 60,
    maxRequests: 120,
  },

  // Lets a key carry e.g. `{ purpose: "mcp-desktop" }` — nothing reads this
  // yet, but a caller-supplied label is cheap to allow now and expensive to
  // retrofit onto already-issued keys later.
  enableMetadata: true,

  // Scopes. Deliberately coarse (read/write on one "api" resource) rather
  // than per-entity-kind — this is a starting shape to prove the plugin
  // fits, not the final scope design. `defaultPermissions` is what a key
  // gets when the caller doesn't ask for narrower ones at creation.
  permissions: {
    defaultPermissions: {
      api: ["read"],
    },
  },

  // THE cutover flag. See the file-level comment for what "global" costs.
  enableSessionForAPIKeys: true,
});

export { API_KEY_ERROR_CODES } from "@better-auth/api-key";
