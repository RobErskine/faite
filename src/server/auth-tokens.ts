import { apiKey, type ApiKeyConfigurationOptions } from "@better-auth/api-key";
import { extractBearerCredential } from "./bearer";

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
 * **Scopes ARE enforced (A2, EI-227) — but not here, and not by narrowing
 * this flag.** `enableSessionForAPIKeys` stays global on purpose: narrowing
 * it, or checking `permissions` inside Better Auth's own session hook, would
 * be exactly the "route-local check" mistake the paragraph above describes —
 * `useSession()` needs EVERY valid key to resolve to a session, desktop or
 * narrow. The actual gate lives one layer up, in `src/server/auth-scopes.ts`:
 * `authorizeScope()` is called BY `/api/sync/*`, `/api/places/*`, and
 * `/api/v1/*` themselves, in addition to (not instead of) the session this
 * plugin resolves. A desktop-handoff key is created with
 * `auth-scopes.ts`'s `DESKTOP_KEY_PERMISSIONS` (full: read/write/sync/
 * places) — unchanged behaviour, no regression. `defaultPermissions` below
 * (`{ api: ["read"] }`) is what any OTHER key gets — the narrow default a
 * user-generated key (A3) needs, satisfying `/api/v1` reads and rejected by
 * `authorizeScope` everywhere else.
 *
 * `customAPIKeyGetter` below checks both places a key can arrive: the
 * ordinary `Authorization: Bearer` header, and — for the one request shape
 * that cannot set headers at all — the WebSocket handshake's
 * `Sec-WebSocket-Protocol` value. Delegates to `bearer.ts`'s
 * `extractBearerCredential`, which `auth-scopes.ts`'s `authorizeScope()` also
 * uses — one extraction, so this plugin's own session hook and the scope
 * gate can never disagree about whether a request "has a key" at all.
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
 *
 * **Two named configurations (EI-259), not one.** The plugin accepts an
 * array of configurations, each with its own `permissions.defaultPermissions`
 * — and `configId` (which one applies) is a plain, CLIENT-settable field on
 * `createApiKeyBodySchema`, deliberately absent from the plugin's
 * server-only-property guard that blocks `permissions` itself from ever
 * being set by a request carrying headers. So `authClient.apiKey.create({
 * name, configId: "read-write" })` lets Settings' UI choose between two
 * FIXED permission sets by name, without the browser ever touching
 * `permissions` directly — the "Write" checkbox in `api-keys-section.tsx`
 * is this and nothing more. One entry MUST be named `"default"`: every key
 * issued before this ticket has `config_id = 'default'` stored
 * (`drizzle/auth/0001_fast_venom.sql`), and `resolveConfiguration` falls
 * back to that literal name and throws if no configuration has it.
 *
 * Every other option (`customAPIKeyGetter`, `enableSessionForAPIKeys`, …)
 * must be identical across both entries — the session hook
 * (`enableSessionForAPIKeys`) loops over EVERY configuration and validates
 * each key against its OWN entry's settings, so a divergent one would make a
 * `read-write` key behave differently just by which config resolved it.
 * Built from one shared `baseConfig` object so that can't drift.
 *
 * **`npm run auth:schema` will propose a migration you should NOT take.**
 * With more than one configuration, the CLI's own schema generator can no
 * longer read a single `rateLimit` to seed `apikey`'s SQL column DEFAULTs,
 * so it falls back to its own hardcoded 10 req / 24h instead of this file's
 * 120 req / 60s. That is a DB-level column default only — every real insert
 * (`index.mjs`'s `createApiKey` endpoint) writes `rateLimitMax`/
 * `rateLimitTimeWindow` explicitly from the resolved config's own
 * `rateLimit` (verified: `rateLimitMax ?? opts.rateLimit.maxRequests`, never
 * left to fall through to the column default), so the generated migration
 * is inert — and also pure noise, since nothing here asked for a rate-limit
 * change. Confirmed by generating and reverting it while building EI-259.
 * Do not commit whatever `auth:schema` proposes for the `apikey` table
 * without checking it's an actual, intended change first.
 *
 * The SAME fallback shows up in `npm run openapi:generate`'s output, but
 * THIS one IS committed: `openapi/openapi.json` (the internal doc, not the
 * public `openapi/v1.json`) documents `rateLimitTimeWindow`/`rateLimitMax`'s
 * schema-level `default` as 86400000/10 for the identical reason — cosmetic
 * only, since (as above) every real key write carries an explicit value —
 * but EI-226's CI drift check compares against whatever is actually
 * generated, so this one has to be regenerated and committed, unlike the
 * migration.
 */
// SECONDS (see the `keyExpiration` comment inside `baseConfig` below for why
// that unit matters here specifically) — 90 days.
export const DEFAULT_KEY_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 90;

// The two — and only two — permission sets a user-generated key can ever
// carry (EI-259). Exported so `api-keys-section.tsx`'s Write checkbox and
// `auth-tokens.test.ts` both read the same values this file uses to build
// `apiTokenPlugin`, rather than a second hardcoded copy drifting from it.
// Never add `sync` or `places` here — those stay reachable only via the
// desktop-handoff key's own explicit `DESKTOP_KEY_PERMISSIONS`
// (`auth-scopes.ts`), which overrides whichever config resolves a key.
export const USER_KEY_PERMISSIONS = {
  default: { api: ["read"] },
  "read-write": { api: ["read", "write"] },
} satisfies Record<string, { api: string[] }>;

const baseConfig: Omit<ApiKeyConfigurationOptions, "configId" | "permissions"> = {
  // A verified token reads "faite_xxxxxxxx…" instead of a bare hex blob —
  // legible in a `curl -H "Authorization: Bearer faite_…"`, and matches
  // Better Auth's own recommendation to suffix the prefix with `_`.
  defaultPrefix: "faite_",

  // A key with no name is a key nobody can identify in a revocation list six
  // months from now. Cheap to require at creation, expensive to reconstruct
  // later — same reasoning `todoSchema.title` requires a value.
  requireName: true,

  // `ctx.headers`, NOT `ctx.request?.headers` — see `extractBearerCredential`'s
  // own doc comment (`bearer.ts`) for why the two are not interchangeable
  // here, found live against a real Durable Object rather than by a unit test.
  customAPIKeyGetter: (ctx) => extractBearerCredential(ctx.headers),

  // Tokens expire by default rather than living forever the moment they're
  // forgotten about in a script — 90 days is a starting guess, not a
  // researched number; the D2 cutover should revisit it. `disableCustomExpiresTime`
  // is left `false` so a caller can request something shorter (never longer,
  // per `maxExpiresIn`).
  //
  // `defaultExpiresIn` is SECONDS — the plugin calls
  // `getDate(defaultExpiresIn, "sec")` — while `minExpiresIn`/`maxExpiresIn`
  // below are DAYS. Passing `1000 * 60 * 60 * 24 * 90` (milliseconds) here
  // once shipped keys that expire in the year 2273: `maxExpiresIn` only
  // checks a CALLER-supplied `expiresIn`, never the default, so nothing
  // caught it (EI-260). Exported as a constant, not inlined, so a test can
  // pin the value and catch a units regression without a live plugin
  // instance — see `auth-tokens.test.ts`.
  keyExpiration: {
    defaultExpiresIn: DEFAULT_KEY_EXPIRES_IN_SECONDS,
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

  // THE cutover flag. See the file-level comment for what "global" costs.
  enableSessionForAPIKeys: true,
};

export const apiTokenPlugin = apiKey([
  {
    ...baseConfig,
    configId: "default",
    // The floor every OTHER key gets — `/api/v1` reads only, rejected by
    // `authorizeScope` everywhere else. Never widen this default; widen by
    // choosing the `read-write` configId instead (EI-259).
    permissions: { defaultPermissions: USER_KEY_PERMISSIONS.default },
  },
  {
    ...baseConfig,
    configId: "read-write",
    // What Settings' "Write" checkbox asks for. Still deliberately coarse —
    // one "api" resource, not per-entity-kind — and still never `sync` or
    // `places`: those stay reachable only by the desktop-handoff key's own
    // explicit `permissions` (`auth-scopes.ts`'s `DESKTOP_KEY_PERMISSIONS`),
    // which overrides whichever config resolves it.
    permissions: { defaultPermissions: USER_KEY_PERMISSIONS["read-write"] },
  },
]);

export { API_KEY_ERROR_CODES } from "@better-auth/api-key";
