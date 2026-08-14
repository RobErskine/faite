const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
const POINTS_AT_LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

/**
 * Where the Worker-owned backend lives, or `undefined` for "same origin".
 *
 * **This governs every `/api/*` seam, not just auth** — `/api/auth/*`,
 * `/api/places/*`, and anything added beside them. `next dev` (:3000) serves
 * the UI but runs no Worker at all, so a relative `/api/...` there hits Next's
 * 404 handler and the caller sees a route that "doesn't exist". Pointing at
 * the separately-running `npm run preview` worker (:8787) is what makes those
 * routes reachable while keeping HMR.
 *
 * The env var is still named `NEXT_PUBLIC_AUTH_URL` for historical reasons —
 * auth was the first seam to need it. Renaming it would mean touching the
 * `dev` script, the Capacitor plan, and every doc that mentions it, for no
 * behavioural gain.
 *
 * Unset in production and in `npm run preview` itself: same origin, so
 * `undefined` resolves relative to wherever the page is served.
 *
 * **The localhost guard is not paranoia; it is a postmortem.** `NEXT_PUBLIC_*` is
 * inlined into the client bundle at BUILD time, and Next loads `.env.local` in
 * every environment including production. So a dev override sitting in
 * `.env.local` shipped to https://myfaite.app, where the login page posted to
 * `http://localhost:8787` and every sign-in died on a CORS preflight. The
 * override now lives in the `dev` script instead — but that is a convention, and a
 * convention is one `.env.local` line away from failing the same way.
 *
 * So a localhost target is only honoured for a page that is itself local. A bundle
 * served from a real domain ignores it and falls back to same-origin, which is
 * correct for every deployment this app has.
 *
 * Capacitor is deliberately unaffected: `capacitor://localhost` has hostname
 * `localhost`, so that page counts as local and its override still applies — and
 * at P7 the override points at the real API host anyway, so it is never a
 * candidate for stripping.
 *
 * Takes its inputs rather than reading them, so the decision is testable without a
 * DOM and without touching the Better Auth client — whose returned object is a
 * Proxy that turns unknown property reads into HTTP requests, so introspecting it
 * to check what it resolved is not an option.
 *
 * @param configured the raw `NEXT_PUBLIC_AUTH_URL`, if any
 * @param hostname the page's hostname, or null when there is no page (prerender)
 */
export function resolveApiBaseURL(
  configured: string | undefined,
  hostname: string | null,
): string | undefined {
  if (!configured) return undefined;

  // No page to compare against, and nothing server-side signs in. Trust it.
  if (hostname === null) return configured;

  if (POINTS_AT_LOCALHOST.test(configured) && !LOCAL_HOSTS.test(hostname)) {
    console.warn(
      `[faite] Ignoring NEXT_PUBLIC_AUTH_URL="${configured}": this page is served ` +
        `from "${hostname}", so a localhost auth backend is unreachable. Falling back ` +
        `to same-origin. A dev override has leaked into a production build.`,
    );
    return undefined;
  }

  return configured;
}

/**
 * Absolute URL for a Worker-owned `/api/*` path, or the path itself when the
 * backend is same-origin (production, `npm run preview`, Capacitor at P7).
 *
 * Returning the bare path rather than an absolute same-origin URL is
 * deliberate: it keeps the common case byte-identical to a plain `fetch(path)`
 * and avoids `window` access during a prerender.
 */
export function apiUrl(path: string): string {
  const base = resolveApiBaseURL(
    process.env.NEXT_PUBLIC_AUTH_URL,
    typeof window === "undefined" ? null : window.location.hostname,
  );
  return base ? new URL(path, base).toString() : path;
}
