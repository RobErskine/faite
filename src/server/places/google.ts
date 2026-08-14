import type {
  AutocompleteRequest,
  DetailsRequest,
  PlaceSuggestion,
  ResolvedPlace,
} from "@/lib/places/wire";

/**
 * The only module that knows what Google's Places API (New) looks like — EI-83.
 *
 * Everything above this file speaks `PlaceSuggestion`/`ResolvedPlace`; Google's
 * response shapes never reach the route handler, let alone the browser. The
 * mappers are exported separately from the `fetch` wrappers so they can be
 * tested as pure functions, the same split `src/server/sync/` uses (a handler
 * needs live bindings, a parser does not).
 *
 * Read `docs/LOCATION.md` §5 before changing anything here. The API
 * surface changed materially in 2025 and most search results still describe
 * the deprecated version.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL_BASE = "https://places.googleapis.com/v1/places/";

/** Ask only for what `mapSuggestions` reads. Field masks take no spaces —
 * Google rejects the header outright if you add any. */
const AUTOCOMPLETE_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text",
  "suggestions.placePrediction.structuredFormat",
].join(",");

/**
 * **Essentials SKU. Do not add `displayName`.**
 *
 * Field masks are billed by the highest tier requested: `id`,
 * `formattedAddress` and `location` are all Place Details Essentials, but
 * `displayName` alone promotes the call to Place Details Pro. We don't need it
 * — the autocomplete suggestion's `structuredFormat.mainText` already gives us
 * the human name to pre-fill a nickname with.
 *
 * The trade-off, if you ever want to revisit it: terminating a session with a
 * Pro Details call makes every Autocomplete request in that session free,
 * whereas Essentials bills the first 12 and frees 13+. At a 350 ms debounce a
 * session is ~3-6 requests, so the two land within noise of each other and
 * Essentials has the larger free allotment. Flip this one constant if real
 * metrics disagree.
 */
const DETAILS_MASK = ["id", "formattedAddress", "location"].join(",");

/** Short: a suggestion that lands three keystrokes late is worthless. */
const AUTOCOMPLETE_TIMEOUT_MS = 4_000;
/** Longer: failing this forfeits the whole session's billing benefit
 * (`docs/LOCATION.md` §5). */
const DETAILS_TIMEOUT_MS = 6_000;

export type UpstreamResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A `path.through.nested.objects` reader that yields a string or `undefined`. */
function readString(source: unknown, ...path: string[]): string | undefined {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function readFiniteNumber(source: unknown, ...path: string[]): number | null {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[key];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

export function buildDetailsUrl(placeId: string, sessionToken: string): string {
  // `encodeURIComponent` on the path segment, and `searchParams` for the token
  // — the token is validated against SESSION_TOKEN_PATTERN upstream, but
  // building the query by hand is exactly how that guard gets quietly undone.
  const url = new URL(`${DETAILS_URL_BASE}${encodeURIComponent(placeId)}`);
  url.searchParams.set("sessionToken", sessionToken);
  return url.toString();
}

/**
 * Google's `suggestions[]` interleaves two variants: `placePrediction` (a real
 * place, has a `placeId`) and `queryPrediction` (a *search term* suggestion,
 * has no `placeId` at all). Query predictions must be **dropped**, not mapped
 * to an entry with an undefined id — one would render as a clickable row that
 * can never resolve to a place. This is the one real trap in the response
 * shape, and it is what `google.test.ts` guards hardest.
 */
export function mapSuggestions(raw: unknown): PlaceSuggestion[] {
  if (!isRecord(raw) || !Array.isArray(raw.suggestions)) return [];

  const suggestions: PlaceSuggestion[] = [];
  for (const entry of raw.suggestions) {
    if (!isRecord(entry)) continue;
    const prediction = entry.placePrediction;
    const placeId = readString(prediction, "placeId");
    if (!placeId) continue;

    // `structuredFormat` is the two-line split we want; `text.text` is the
    // single-line whole and the fallback when Google omits the split.
    const primary =
      readString(prediction, "structuredFormat", "mainText", "text") ??
      readString(prediction, "text", "text") ??
      "";
    if (!primary) continue;

    suggestions.push({
      placeId,
      primary,
      secondary: readString(prediction, "structuredFormat", "secondaryText", "text") ?? "",
    });
  }
  return suggestions;
}

/**
 * `null` only when the response is unusable — no id, or no address. A missing
 * `location` is NOT a failure: an address without coordinates is still worth
 * saving, and geofencing (the only feature that would need lat/lng) is
 * explicitly out of scope, see `docs/LOCATION.md`.
 */
export function mapDetails(raw: unknown): ResolvedPlace | null {
  const placeId = readString(raw, "id");
  const address = readString(raw, "formattedAddress");
  if (!placeId || !address) return null;

  return {
    placeId,
    address,
    lat: readFiniteNumber(raw, "location", "latitude"),
    lng: readFiniteNumber(raw, "location", "longitude"),
  };
}

/**
 * Maps an upstream status onto ours. Google's body is never forwarded — it can
 * name the API key's restrictions.
 *
 * A 400 from Google becomes a 502, not a 400: our own validation already
 * passed, so a rejected request means *we* built it wrong. Telling the client
 * it sent bad data would be a lie that sends someone debugging the wrong half.
 * 403 is the same story with a different cause — key restricted, API not
 * enabled, or billing off — a deployment fault, not a caller fault.
 */
export function upstreamFailure(status: number): { status: number; error: string } {
  // The one status worth passing through: the client latches on it and stops,
  // rather than retrying into a rate limit.
  if (status === 429) return { status: 429, error: "rate-limited" };
  if (status >= 500) return { status: 502, error: "upstream-unavailable" };
  return { status: 502, error: "upstream-error" };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

async function callGoogle(
  url: string,
  init: RequestInit,
  apiKey: string,
  timeoutMs: number,
  mask: string,
): Promise<UpstreamResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        ...init.headers,
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": mask,
      },
    });
  } catch (error) {
    // Network failure, DNS, or the timeout above firing as an AbortError.
    console.error("[places] upstream request failed", error);
    return { ok: false, status: 502, error: "upstream-unavailable" };
  }

  if (!response.ok) {
    // Logged, never returned: a 403 body names the key's restrictions, and
    // this line is how you find out the key is referrer-restricted (which
    // breaks every call from a Worker — see docs/GOOGLE-PLACES-SETUP.md §1).
    console.error(`[places] upstream responded ${response.status}: ${await response.text()}`);
    return { ok: false, ...upstreamFailure(response.status) };
  }

  return { ok: true, data: await response.json() };
}

export async function fetchAutocomplete(
  apiKey: string,
  request: AutocompleteRequest,
): Promise<UpstreamResult<PlaceSuggestion[]>> {
  const result = await callGoogle(
    AUTOCOMPLETE_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: request.input, sessionToken: request.sessionToken }),
    },
    apiKey,
    AUTOCOMPLETE_TIMEOUT_MS,
    AUTOCOMPLETE_MASK,
  );
  return result.ok ? { ok: true, data: mapSuggestions(result.data) } : result;
}

export async function fetchDetails(
  apiKey: string,
  request: DetailsRequest,
): Promise<UpstreamResult<ResolvedPlace>> {
  const result = await callGoogle(
    buildDetailsUrl(request.placeId, request.sessionToken),
    { method: "GET" },
    apiKey,
    DETAILS_TIMEOUT_MS,
    DETAILS_MASK,
  );
  if (!result.ok) return result;

  const place = mapDetails(result.data);
  // A 200 we can't read is still an upstream problem, not a caller one.
  if (!place) {
    console.error("[places] details response missing id or formattedAddress");
    return { ok: false, status: 502, error: "upstream-error" };
  }
  return { ok: true, data: place };
}
