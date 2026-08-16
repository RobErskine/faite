import { apiKey } from "@better-auth/api-key";

/**
 * API token scaffold for EI-50 P5 (scoped-down). NEW, ADDITIVE, INERT:
 * registering this plugin adds a D1 table and a set of `/api/auth/api-key/*`
 * endpoints, but changes the behaviour of NO existing route. Nothing in the
 * app calls these endpoints yet, and — the load-bearing detail —
 * `enableSessionForAPIKeys` stays `false` below, which means a valid API key
 * on a request NEVER causes `auth.api.getSession()` to return a session for
 * it. That is the one call `src/server/sync/routes.ts:27` and
 * `src/server/places/routes.ts:53` make, and it is untouched by this file.
 * Flipping that flag (or adding an explicit `auth.api.verifyApiKey()` call
 * to a new route) is the actual cutover, and is deliberately NOT done here —
 * see the desktop-shell milestone (D2) this is groundwork for.
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
    const header = ctx.request?.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
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

  // THE flag that keeps this whole plugin inert. See the file-level comment.
  enableSessionForAPIKeys: false,
});

export { API_KEY_ERROR_CODES } from "@better-auth/api-key";
