/**
 * Where `/raycast-handoff` is allowed to send a one-time code (EI-310).
 *
 * Pure and dependency-free so it can be tested directly — this is the
 * security boundary of the Raycast sign-in flow, and the same reasoning
 * `auth-scopes.ts` gives for splitting `scopeGranted` out of
 * `authorizeScope` applies: the part that decides access should be reachable
 * by a test without standing up everything around it.
 *
 * **Why this matters.** The redirect carries a credential-bearing code. Before
 * EI-310 the target was a hardcoded `raycast://` deep link, which made the
 * question moot. Now that `redirect_uri` is a request parameter, honoring a
 * caller-supplied value would be textbook authorization-code interception:
 * any page could send a signed-in user to `/raycast-handoff` with its own
 * redirect and collect a working API key on the way back.
 *
 * `OAuth.RedirectMethod.Web` always redirects to
 * `https://raycast.com/redirect` (with a `packageName` query param), so this
 * allow-list is complete rather than a starting point.
 */

const ALLOWED_ORIGIN = "https://raycast.com";
const ALLOWED_PATHNAME = "/redirect";

/**
 * Compares ORIGIN and PATHNAME, never the whole URL — the query string
 * legitimately varies (`?packageName=Extension`), so a string equality check
 * would reject every real request.
 *
 * Using `URL` rather than a prefix test is deliberate: `startsWith("https://raycast.com")`
 * would accept `https://raycast.com.evil.test/redirect`, and a `includes()`
 * check would accept almost anything.
 */
export function isAllowedRaycastRedirect(target: string | null | undefined): target is string {
  if (!target) return false;

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    // Not a URL at all — a relative path, a bare word, or junk.
    return false;
  }

  return url.origin === ALLOWED_ORIGIN && url.pathname === ALLOWED_PATHNAME;
}
