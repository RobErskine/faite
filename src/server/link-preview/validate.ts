/**
 * URL validation for `GET /api/link-preview` — pure, unit-tested.
 *
 * `global_fetch_strictly_public` (already in `wrangler.jsonc`) blocks the
 * Worker's outbound `fetch` from reaching private/internal addresses at
 * runtime, but this checks the URL shape explicitly anyway: the rule should
 * not depend on a compatibility flag surviving a future edit, and a bad
 * scheme (`file:`, `javascript:`) is rejected before a fetch is even
 * attempted.
 */

/** Sanity bound, not a spec — long enough for any real page, short enough
 * that a malformed request can't smuggle a large string through validation. */
const MAX_URL_LENGTH = 2048;

/**
 * Rejects the LITERAL private/loopback/link-local hosts an attacker would
 * type directly (`http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254`
 * for a cloud metadata endpoint). This is belt-and-suspenders: it does not
 * catch DNS rebinding (a public hostname that resolves to a private IP at
 * fetch time) — `global_fetch_strictly_public` in `wrangler.jsonc` is the
 * runtime-level defense for that, checked at the actual connection, not the
 * string. Keeping both means the guard here still holds if that compat flag
 * is ever removed.
 */
function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv6 literals arrive bracketed in URL.hostname, e.g. "[::1]".
  const ipv6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : null;
  if (ipv6) {
    if (ipv6 === "::1") return true; // loopback
    if (/^fe[89ab][0-9a-f]:/.test(ipv6)) return true; // link-local, fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(ipv6)) return true; // unique local, fc00::/7
    return false;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 127) return true; // loopback, 127.0.0.0/8
  if (a === 10) return true; // private, 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private, 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private, 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata, 169.254.0.0/16
  if (a === 0) return true; // "this network" / unspecified, 0.0.0.0/8
  return false;
}

/**
 * Normalizes and validates a candidate URL, or returns `null` for anything
 * `new URL()` refuses, a non-http(s) scheme, a private/loopback host, or a
 * URL over the length cap.
 *
 * The fragment is stripped: it never reaches the server on a real navigation
 * and two URLs differing only by fragment are the same page for caching
 * purposes.
 */
export function validateLinkPreviewUrl(raw: string | null): URL | null {
  if (!raw || raw.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isPrivateOrLocalHost(url.hostname)) return null;

  url.hash = "";
  return url;
}
