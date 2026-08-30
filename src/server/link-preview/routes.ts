import { createAuth, getSessionSafe } from "../auth";
import { corsHeaders, handleOptions } from "../cors";
import { fetchLinkPreviewMeta } from "./fetch-meta";
import { validateLinkPreviewUrl } from "./validate";

/**
 * `/api/link-preview` — metadata for the Notes-field link-preview card.
 *
 * Same seam as `/api/places/*` and not a Next.js Route Handler for the same
 * reason (`output: export` forbids one that reads `Request`). See
 * `docs/ARCHITECTURE.md` §2.12.
 *
 * Session only, no API-key scope: this is a UI affordance for the app's own
 * Notes field, not a public capability, so `getSessionSafe` (never
 * `auth.api.getSession()` directly, which throws on a garbage
 * `Authorization` header — see its doc comment in `auth.ts`) is enough.
 *
 * Never echoes `error.message` — same rule as the attachment routes. A
 * failed fetch returns 200 with `{ ok: false }` so the client draws the
 * fallback card instead of treating it as a request error.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/**
 * Re-applies per-caller CORS headers onto an otherwise origin-independent
 * response. `new Headers(init)` rather than `Object.entries(init)` because
 * `corsHeaders` is typed `HeadersInit` — a union that includes `Headers` and
 * `string[][]`, neither of which `Object.entries` accepts.
 */
function withCors(response: Response, cors: HeadersInit): Response {
  const merged = new Headers(response.headers);
  new Headers(cors).forEach((value, key) => merged.set(key, value));
  return new Response(response.body, { status: response.status, headers: merged });
}

const CACHE_CONTROL = "public, max-age=86400";

export async function handleLinkPreviewRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);

  if (url.pathname !== "/api/link-preview" || request.method !== "GET") {
    return json({ error: "not-found" }, 404, headers);
  }

  const session = await getSessionSafe(createAuth(env, request), request);
  if (!session) return json({ ok: false, error: "unauthenticated" }, 401, headers);

  const target = validateLinkPreviewUrl(url.searchParams.get("url"));
  if (!target) return json({ ok: false, error: "invalid-url" }, 400, headers);

  // Keyed on the normalized target URL, not the incoming request — two
  // different callers asking about the same page share one cache entry.
  const cacheKey = new Request(`https://link-preview.cache.internal/${target.toString()}`);
  const cache = caches.default;

  // **CORS headers are deliberately NOT part of the cached entry**, and are
  // re-applied per request on both paths below.
  //
  // They are per-CALLER, the cache entry is per-TARGET-URL, and mixing the
  // two poisons the cache: `corsHeaders` echoes the requesting origin, so
  // whichever origin happened to miss the cache first would have its
  // `Access-Control-Allow-Origin` replayed to every later caller. Locally
  // that is not hypothetical — `npm run dev` (:3000) and `npm run preview`
  // (:8787) are both trusted origins hitting the same Worker, so warming
  // this route from :8787 then loading the board on :3000 failed CORS on a
  // response that was otherwise completely correct.
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, headers);

  const result = await fetchLinkPreviewMeta(target);
  const body = result.ok ? { ok: true, meta: result.meta } : { ok: false };

  // Cacheable form: no CORS headers, no `Vary: Origin` — origin-independent.
  const cacheable = json(body, 200, {
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": "application/json",
  });

  // A public page's OG tags are not user data, so caching the RESPONSE
  // (not just the upstream fetch) is safe, and it means a repeat request
  // never re-runs the Worker-side fetch at all — not even a conditional one.
  await cache.put(cacheKey, cacheable.clone());

  return withCors(cacheable, headers);
}
