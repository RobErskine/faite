import { createAuth } from "../auth";
import { authorizeScope } from "../auth-scopes";
import { corsHeaders, handleOptions } from "../cors";
import { fetchAutocomplete, fetchDetails } from "./google";
import { parseAutocompleteRequest, parseDetailsRequest } from "./validate";

/**
 * `/api/places/*` — the Google Places proxy for EI-83.
 *
 * Same seam as `/api/auth/*` and `/api/sync/*`: not a Next.js Route Handler,
 * because `output: export` (the Capacitor build target) forbids one that reads
 * `Request`. See `docs/ARCHITECTURE.md` §2.12.
 *
 * **Why a proxy at all**, rather than calling Google from the browser: the key
 * stays a Worker secret and never enters the client bundle, and Google's HTTP
 * referrer restrictions cannot cover `capacitor://localhost` (already in
 * `TRUSTED_ORIGINS`) — so a browser-side key could not be restricted anyway.
 * The corollary, which trips people up: a Worker's outbound `fetch` sends no
 * `Referer` header either, so the key must NOT be referrer-restricted or every
 * call here 403s. Restrict it by API instead. See `docs/GOOGLE-PLACES-SETUP.md` §1.
 *
 * This route spends real money per call, which is what drives the two guards
 * below and the session-token discipline in `use-place-search.ts`.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export async function handlePlacesRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);

  // Checked BEFORE the session, deliberately. A deployment with no key set is
  // a configuration state, not a runtime fault and not an auth problem — 501
  // lets the client latch "this will never work here, stop asking and fall
  // back to plain text" apart from a transient failure worth retrying.
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return json({ error: "places-not-configured" }, 501, headers);

  // A session is required because this proxy spends the account owner's money
  // on every call; unauthenticated it is an open, uncapped geocoder, and CORS
  // does not protect it (a non-browser caller ignores it entirely).
  //
  // The product rule this implements: a signed-out user can still type a
  // manual address, we just don't match it against the Places API. So 401 is
  // never a nag — the client degrades to a plain text input, which is exactly
  // what the field was before this feature existed.
  //
  // `authorizeScope(auth, request, "places")` (A2, EI-227), not a bare
  // session check: a cookie session behaves exactly as before (unauthenticated
  // → 401), but an API-key-carrying request must ALSO hold the `places`
  // permission — this is a paid Google API, and a narrow user-generated key
  // (A3) must not be able to spend the account owner's money by default. See
  // `auth-scopes.ts`.
  const auth = await authorizeScope(createAuth(env, request), request, "places");
  if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

  try {
    if (url.pathname === "/api/places/autocomplete" && request.method === "POST") {
      const parsed = parseAutocompleteRequest(await request.json());
      if (!parsed) return json({ error: "invalid-request" }, 400, headers);

      const result = await fetchAutocomplete(apiKey, parsed);
      return result.ok
        ? json({ suggestions: result.data }, 200, headers)
        : json({ error: result.error }, result.status, headers);
    }

    if (url.pathname === "/api/places/details" && request.method === "POST") {
      const parsed = parseDetailsRequest(await request.json());
      if (!parsed) return json({ error: "invalid-request" }, 400, headers);

      // The terminating call of an autocomplete session. It carries the same
      // token the autocompletes used, which is what makes them billable as one
      // session instead of individually — see `docs/LOCATION.md` §5.
      const result = await fetchDetails(apiKey, parsed);
      return result.ok
        ? json(result.data, 200, headers)
        : json({ error: result.error }, result.status, headers);
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    // Includes a malformed JSON body from `request.json()`. Mapped here rather
    // than allowed to escape into the OpenNext fallthrough this branch preempts.
    console.error("places route error", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}
