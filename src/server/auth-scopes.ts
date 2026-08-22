import { role } from "better-auth/plugins/access";
import type { Auth } from "./auth";
import { getSessionSafe } from "./auth";
import { extractBearerCredential } from "./bearer";

/**
 * Scope enforcement for API keys (A2, EI-227) — see `docs/API.md`'s "Key
 * scopes" section for the design this implements.
 *
 * `enableSessionForAPIKeys: true` (`auth-tokens.ts`) stays global and
 * untouched: `useSession()` — and therefore the whole app's signed-in UI —
 * must keep recognizing ANY valid key, desktop or narrow, as "signed in".
 * This module adds a SEPARATE, additional gate in front of the routes that
 * actually need one (`/api/sync/*`, `/api/places/*`, `/api/v1/*`), rather
 * than touching that global flag.
 */

export type ApiScope = "read" | "write" | "sync" | "places";

/** The literal name `/api/desktop/handoff` gives every key it mints —
 * `requireName: true` (`auth-tokens.ts`) makes this the one stable identity
 * marker a key carries that a caller cannot forge (`permissions` and `name`
 * are both server-only-settable; see `createApiKey`'s guard). Shared so
 * `desktop/routes.ts` and this file's name-based fallback below can't drift. */
export const DESKTOP_KEY_NAME = "Faite desktop";

/**
 * Granted to every key `/api/desktop/handoff` mints — full equivalence,
 * unchanged from before this ticket: the desktop shell is "this is me, on my
 * own device," matching D2a's decision #3 framing exactly.
 */
export const DESKTOP_KEY_PERMISSIONS: Record<string, ApiScope[]> = {
  api: ["read", "write", "sync", "places"],
};

/**
 * Pure: does this permission set satisfy `scope`? Split out from
 * `authorizeScope` so the actual access-control decision — the part a bug
 * here would turn into a real vulnerability — is unit-testable without a
 * live Better Auth + D1 instance.
 *
 * Reuses `better-auth/plugins/access`'s own `role().authorize()`, the exact
 * function `@better-auth/api-key`'s `validateApiKey` calls internally when a
 * caller passes a `permissions` argument — same semantics, no reimplementation.
 */
export function scopeGranted(permissions: Record<string, string[]> | null | undefined, scope: ApiScope): boolean {
  if (!permissions) return false;
  return role(permissions).authorize({ api: [scope] }).success;
}

/**
 * Pure: the full grant decision for a verified key, including the
 * migration-safety name fallback — split out for the same reason
 * `scopeGranted` is, and unit-tested directly rather than only through
 * `authorizeScope` (which needs a live Better Auth + D1 instance to call).
 *
 * A key named exactly `DESKTOP_KEY_NAME` is granted every scope regardless
 * of its stored `permissions` — the migration-safety net for every desktop
 * key minted BEFORE this ticket shipped `DESKTOP_KEY_PERMISSIONS` at
 * creation time. Without this, an already-installed desktop app's existing
 * key (created with only the old global `defaultPermissions`, `{ api:
 * ["read"] }`) would start getting 403'd on `/api/sync/*` the moment this
 * deployed — the exact "desktop shell still signs in and syncs" regression
 * the ticket calls out as the primary risk — until the user happened to log
 * out and back in. `name` is not user-suppliable data an attacker can spoof
 * to gain scope: both `name` and `permissions` are server-only properties
 * `createApiKey` rejects from a client request, and only
 * `/api/desktop/handoff` ever sets this name.
 */
export function keyGrantsScope(
  key: { name: string | null; permissions?: Record<string, string[]> | null },
  scope: ApiScope,
): boolean {
  return key.name === DESKTOP_KEY_NAME || scopeGranted(key.permissions, scope);
}

export type ScopeResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401; error: "unauthenticated" }
  | { ok: false; status: 403; error: "insufficient-scope" };

/**
 * Gates a route by SCOPE, never by "is this an API key" (EI-227's corrected
 * scope). A cookie session (no bearer credential at all) is unaffected —
 * full access, exactly as before this ticket, because a cookie carries no
 * narrower permission set to check.
 *
 * A bearer credential is verified with exactly ONE
 * `auth.api.verifyApiKey({ body: { key } })` call — deliberately with no
 * `headers` and no `permissions` in the body:
 *
 * - **No `headers`**: `enableSessionForAPIKeys`'s before-hook matches on
 *   `ctx.headers`, so passing the same `Authorization` header here would
 *   make Better Auth re-run its OWN implicit session validation for this
 *   call too. Whatever earlier `getSessionSafe`/`getSession()` call already
 *   resolved `useSession()` state for this request already consumed one
 *   usage/rate-limit unit against this key; a second `auth.api.*` call
 *   carrying the same header would silently consume a second one for a
 *   single incoming request.
 * - **No `permissions`**: passing one triggers the plugin's OWN internal
 *   check, which throws the identical `UNAUTHORIZED`/`KEY_NOT_FOUND` for
 *   "key doesn't exist" and "key lacks this permission" — indistinguishable
 *   from the caught error alone. `scopeGranted` re-runs that same check
 *   locally against the key's own returned `permissions`, so this function
 *   can tell "bad key" (401) apart from "valid key, wrong scope" (403),
 *   which the ticket's "Done when" list requires as two different statuses.
 *
 * The actual grant decision (including the desktop-name migration fallback)
 * is `keyGrantsScope`, above.
 */
export async function authorizeScope(auth: Auth, request: Request, scope: ApiScope): Promise<ScopeResult> {
  const bearer = extractBearerCredential(request.headers);
  if (!bearer) {
    const session = await getSessionSafe(auth, request);
    return session
      ? { ok: true, userId: session.user.id }
      : { ok: false, status: 401, error: "unauthenticated" };
  }

  const result = await auth.api.verifyApiKey({ body: { key: bearer } });
  if (!result.valid || !result.key) return { ok: false, status: 401, error: "unauthenticated" };

  if (!keyGrantsScope(result.key, scope)) return { ok: false, status: 403, error: "insufficient-scope" };

  return { ok: true, userId: result.key.referenceId };
}
