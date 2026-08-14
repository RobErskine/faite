/**
 * The contract between the `/api/places/*` proxy (`src/server/places/`) and its
 * only client (`src/components/places/use-place-search.ts`) — EI-83.
 *
 * Shared rather than mirrored, for the same reason `src/lib/sync/wire.ts` is:
 * two copies of a wire format have no test that can catch them diverging.
 *
 * **Zero DOM globals in this file.** `tsc -p tsconfig.worker.json` typechecks
 * everything the worker imports under a DOM-less `lib`, so a stray `Request`,
 * `FormData` or `navigator` reference here breaks the worker build rather than
 * this file — see `.ai/lessons.md`.
 *
 * Nothing here describes Google's own shapes. Those stay inside
 * `src/server/places/google.ts`: the browser never sees a Google response, only
 * the two lean records below.
 */

/**
 * Below this, don't call Google at all. Two characters match half the planet,
 * and every request is billable — see `docs/LOCATION.md` §5.
 */
export const MIN_QUERY_LENGTH = 3;

/** Google's own cap is far higher; this is an abuse guard, not a fidelity one. */
export const MAX_QUERY_LENGTH = 200;

/**
 * Google: "a URL and filename safe base64 string with at most 36 ASCII
 * characters in length". A `crypto.randomUUID()` qualifies.
 *
 * This is not cosmetic validation. The token is interpolated into the Place
 * Details **query string** (`buildDetailsUrl`), so a token carrying `&`, a
 * space, or a newline is a request-forgery vector against googleapis.com.
 */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;

/**
 * One row in the typeahead. `primary`/`secondary` are Google's
 * `structuredFormat` halves — "Blue Bottle Coffee" / "300 Webster St, Oakland".
 *
 * `primary` doubles as the nickname pre-fill when saving, which is precisely
 * why the Place Details field mask does NOT ask for `displayName`: that one
 * field would promote every Details call from the Essentials SKU to Pro.
 */
export interface PlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

/** What a terminating Place Details call yields — the shape `Place` stores. */
export interface ResolvedPlace {
  placeId: string;
  address: string;
  /** Null when Google returned no `location`; an address without coordinates
   * is still worth saving, so this is not a failure. */
  lat: number | null;
  lng: number | null;
}

export interface AutocompleteRequest {
  input: string;
  sessionToken: string;
}

export interface DetailsRequest {
  placeId: string;
  sessionToken: string;
}

export interface AutocompleteResponse {
  suggestions: PlaceSuggestion[];
}

/**
 * The one-line form of a suggestion, for the input's own value.
 *
 * Shared by both call sites because it is load-bearing rather than cosmetic:
 * Base UI writes `itemToStringValue`'s result into the input **synchronously**
 * on a pick (`fillInputOnItemPress` is hardcoded true — `docs/PICKERS.md` §1),
 * so this is the optimistic address the user sees until Place Details returns
 * the canonical one. The two must agree on the string, or the suppression in
 * `usePlaceSearch.resolve` misses and the pick opens a second lookup.
 */
export function formatSuggestion(suggestion: PlaceSuggestion): string {
  return [suggestion.primary, suggestion.secondary].filter(Boolean).join(", ");
}
