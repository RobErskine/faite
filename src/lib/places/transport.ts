import { apiUrl } from "@/lib/api-origin";
import type { AutocompleteResponse, PlaceSuggestion, ResolvedPlace } from "./wire";

/**
 * The client half of `/api/places/*` — EI-83.
 *
 * `credentials: "include"` because the proxy authenticates against Better
 * Auth's session cookie, and local dev is genuinely cross-origin.
 *
 * **Routed through `apiUrl()`, not a bare relative path.** `next dev` (:3000)
 * runs no Worker, so a relative `/api/places/...` there hits Next's 404
 * handler — which this transport maps to `PlacesUnavailableError`, which
 * `usePlaceSearch` then latches. The visible symptom is a typeahead that fires
 * exactly one request per mount and is silent forever after, which reads as a
 * broken hook rather than a missing backend. `apiUrl()` points these at the
 * `npm run preview` worker (:8787) in dev via `NEXT_PUBLIC_AUTH_URL`, exactly
 * as `auth-client.ts` already does, and is a no-op everywhere else.
 *
 * (`src/lib/sync/transport.ts` still uses bare relative paths and so still
 * 404s under `next dev`. Deliberately left alone: pointing dev sync at a real
 * Worker means writing to a real Durable Object, which is a bigger decision
 * than a read-only address lookup.)
 *
 * The error types are not decoration. Three of the four are *permanent* for
 * this page, and `usePlaceSearch` latches on them to stop calling a route that
 * costs money and is never going to answer.
 */

/** 401 — signed out. Permanent until sign-in; the field stays free text. */
export class PlacesAuthError extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "PlacesAuthError";
  }
}

/**
 * 501 (no API key on this deployment) or 404 (no `/api/*` at all, i.e.
 * `next dev`). Both are deployment facts, not transient failures — retrying
 * either just burns requests against a route that cannot succeed.
 */
export class PlacesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacesUnavailableError";
  }
}

/** 429 — latch and stop, rather than retrying into a rate limit. */
export class PlacesRateLimitedError extends Error {
  constructor() {
    super("rate-limited");
    this.name = "PlacesRateLimitedError";
  }
}

/** Anything else, including 502 upstream failures. Transient: keep trying. */
export class PlacesHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PlacesHttpError";
  }
}

async function placesFetch(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (response.status === 401) throw new PlacesAuthError();
  if (response.status === 501) throw new PlacesUnavailableError("places-not-configured");
  if (response.status === 404) throw new PlacesUnavailableError(`${path} does not exist here`);
  if (response.status === 429) throw new PlacesRateLimitedError();
  if (!response.ok) throw new PlacesHttpError(response.status, `${path} responded ${response.status}`);
  return response;
}

export async function fetchPlaceSuggestions(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const response = await placesFetch("/api/places/autocomplete", { input, sessionToken }, signal);
  const body: AutocompleteResponse = await response.json();
  return body.suggestions ?? [];
}

/**
 * The call that terminates a billing session. Deliberately takes no
 * `AbortSignal`: if this never lands, every autocomplete in the session
 * reverts to per-request pricing, so it must be allowed to finish even after
 * the popup that started it has closed. See `docs/LOCATION.md` §5.
 */
export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string,
): Promise<ResolvedPlace> {
  const response = await placesFetch("/api/places/details", { placeId, sessionToken });
  return response.json();
}
