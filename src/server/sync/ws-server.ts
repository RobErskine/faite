import { TRUSTED_ORIGINS } from "../auth";

/**
 * Server-side glue for the `/api/sync/ws` upgrade (P4/EI-49). Pure — the
 * decisions live here so they can be tested without a Worker, a socket, or a
 * session.
 */

/**
 * How the Worker hands its already-verified `session.user.id` to the Durable
 * Object.
 *
 * `stub.fetch(request)` does not carry the Worker's verified identity
 * through to the DO's `fetch()`, and the DO has no route to Better Auth's
 * D1-backed session store — nor should it; auth lives in the Worker
 * (ARCHITECTURE §2.12). A header is exactly as trustworthy as an RPC
 * argument here, and for the same reason: the `USER_DO` namespace is
 * reachable only from this Worker, so nothing else can set it. It also costs
 * no extra round trip, unlike provisioning the DO with its own identity via
 * a separate RPC before the upgrade.
 *
 * Lowercase because `Headers` normalises anyway, and matching the stored
 * form makes the `.get()` in `user-do.ts` obviously correct.
 */
export const USER_ID_HEADER = "x-faite-user-id";

/**
 * CSWSH (cross-site WebSocket hijacking) defense.
 *
 * **A WebSocket handshake bypasses CORS entirely.** The browser sends it
 * with cookies and no preflight, and `Access-Control-Allow-Origin` has no
 * bearing on whether the connection is established. So for `/api/sync/ws`
 * the `Origin` header is not advisory the way it is on the push/pull routes
 * (where `corsHeaders` merely decides whether to *annotate* the response) —
 * it is the only thing standing between evil.com and a logged-in user's
 * entire board. There is nothing equivalent in the codebase today because
 * until now every sync request went through `fetch`, which CORS does govern.
 *
 * Two accept conditions:
 *
 * 1. **Same-origin.** This is the common case and it is load-bearing beyond
 *    convenience: branch previews live at `*-faite.bfmw-dev.workers.dev`
 *    (`wrangler.jsonc` sets `preview_urls: true`) and are deliberately NOT in
 *    `TRUSTED_ORIGINS`, since `createAuth` derives its `baseURL` from the
 *    request origin instead. Checking the allow-list alone would 403 the
 *    WebSocket on every preview deploy while HTTP sync kept working — which
 *    presents as "hibernation is broken", not "the origin check is wrong".
 * 2. **On `TRUSTED_ORIGINS`.** Covers the cross-origin dev setup
 *    (`next dev` on :3000 against a preview worker on :8787) and
 *    `capacitor://localhost` at P7.
 *
 * An absent `Origin` is allowed. Browsers ALWAYS send `Origin` on a
 * WebSocket handshake — it is required by RFC 6455 for browser clients — so
 * "absent" means a non-browser client (curl, wscat, a native app), which
 * cannot be a confused-deputy victim and still has to present a valid
 * session cookie to have gotten this far. Do not "fix" this to reject: it
 * would break the wscat smoke test and every non-browser API consumer, and
 * buys nothing, because a browser cannot omit the header.
 */
export function isAllowedWsOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return true;
  if (TRUSTED_ORIGINS.includes(origin)) return true;
  try {
    return origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/** Case-insensitive, because the header value is not normalised the way names are. */
export function isWebSocketUpgrade(upgradeHeader: string | null): boolean {
  return upgradeHeader?.toLowerCase() === "websocket";
}
