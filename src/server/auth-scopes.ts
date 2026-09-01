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

/**
 * The display-name prefix every desktop-handoff key gets — `"Faite desktop
 * — <hostname>"` (EI-261) once a device name is available, or the bare
 * prefix otherwise. Display only. It is NOT a security boundary and must
 * never be treated as one — see the SECURITY note on `scopeGranted` below
 * for why a name-based scope check was removed rather than added to.
 */
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
 *
 * **SECURITY (EI-261): `permissions` is the ONLY field this module may ever
 * trust for a scope decision.** A name-based fallback (`key.name ===
 * DESKTOP_KEY_NAME`) lived here from A2 through EI-260, on the belief that
 * `name` — like `permissions` — was a server-only-settable field a client
 * couldn't forge. That belief was wrong: `@better-auth/api-key`'s
 * `SERVER_ONLY_PROPERTY` guard on both `create` and `update` covers
 * `permissions`, `refillAmount`/`refillInterval`, and the rate-limit fields
 * — `name` was never in that list on either endpoint. Two live exploits
 * followed directly from that: `authClient.apiKey.create({ name: "Faite
 * desktop" })` mints a brand-new key with that literal name and only the
 * narrow default `permissions`, or `authClient.apiKey.update({ keyId:
 * <any key you already own>, name: "Faite desktop" })` retroactively
 * upgrades one — either way the fallback then granted it full `read`/
 * `write`/`sync`/`places` access, including `/api/sync/reset`, with no
 * `permissions` change at all. Confirmed against live production data
 * before removing it: of 5 "Faite desktop"-named rows, 2 genuinely
 * depended on the fallback (real pre-A2 keys with only `{"api":["read"]}"`
 * stored) — those needed a re-sign-in to mint a correctly-scoped
 * replacement once this shipped. Do not reintroduce any variant of this
 * (an exact match, a `startsWith`, a stored `metadata` flag) — `metadata`
 * has the identical hole (also missing from the update guard). `permissions`
 * is the one field the plugin actually protects; there is no substitute.
 */
export function scopeGranted(permissions: Record<string, string[]> | null | undefined, scope: ApiScope): boolean {
  if (!permissions) return false;
  return role(permissions).authorize({ api: [scope] }).success;
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
 * The actual grant decision is `scopeGranted`, above — see its SECURITY
 * note for why this calls it directly rather than through a wrapper that
 * also considers the key's name.
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

  if (!scopeGranted(result.key.permissions, scope)) return { ok: false, status: 403, error: "insufficient-scope" };

  return { ok: true, userId: result.key.referenceId };
}
