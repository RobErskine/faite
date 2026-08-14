"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchPlaceDetails,
  fetchPlaceSuggestions,
  PlacesAuthError,
  PlacesRateLimitedError,
  PlacesUnavailableError,
} from "@/lib/places/transport";
import { MIN_QUERY_LENGTH, type PlaceSuggestion, type ResolvedPlace } from "@/lib/places/wire";
import { useDebouncedValue } from "@/lib/use-debounced-value";

/**
 * The Google Places lookup behind both address fields — EI-83.
 *
 * Shared by `AddressAutocomplete` (Settings → Places) and `LocationField` (the
 * to-do sheet), which need different *lists* but the identical network, token
 * and debounce behaviour. One implementation, because the interesting part
 * here is not the UI: **every autocomplete request is billable**, and the
 * rules that keep them cheap are easy to get subtly, silently wrong — the
 * feature works perfectly either way, the bill is what differs.
 *
 * Two of those rules, from `docs/LOCATION.md` §5:
 *
 *   - A session is a run of Autocomplete requests sharing one token, ended by
 *     exactly one Place Details call carrying the same token. **Abandoned**
 *     (no terminating Details call) reverts every request in it to per-request
 *     pricing.
 *   - **Reusing** a token across two completed sessions makes Google
 *     invalidate it and bill everything in both per-request.
 *
 * So: mint on the first request that actually goes out, reuse while typing,
 * spend on exactly one Details call, then discard. Never reuse.
 */

/** Long enough to collapse typing, short enough not to feel laggy. */
export const PLACE_SEARCH_DEBOUNCE_MS = 350;

export type PlaceSearchStatus = "idle" | "loading" | "ready" | "unavailable";

export interface PlaceSearch {
  suggestions: PlaceSuggestion[];
  status: PlaceSearchStatus;
  /**
   * Terminates the billing session: one Details call, spending the token.
   *
   * `inputText` is whatever the input shows *now* — Base UI fills it
   * synchronously on a pick (`fillInputOnItemPress` is hardcoded true, see
   * `docs/PICKERS.md` §1). It and the resolved address are both suppressed
   * from triggering a fresh lookup, because otherwise selecting a suggestion
   * immediately opens a second, doomed session searching for the text it just
   * filled in — a wasted request whose session can only ever be abandoned.
   *
   * Resolves to `null` rather than throwing: a failed lookup must degrade to
   * the free text already on screen, never to an error dialog.
   */
  resolve: (placeId: string, inputText: string) => Promise<ResolvedPlace | null>;
  /**
   * Abandon the session without a pick, for a caller that knows one is
   * definitely over — a saved form, a closed sheet.
   *
   * **Do not wire this to blur.** Blur can fire as part of clicking a
   * suggestion, and discarding the token there leaves the Details call
   * carrying a token Google never saw during autocomplete: the session it was
   * supposed to terminate is abandoned instead, and every request in it
   * reverts to per-request pricing. Clearing the field already drops the token
   * on its own.
   */
  reset: () => void;
}

/**
 * Permanent for this page: signed out, no key on this deployment, no `/api/*`
 * at all (`next dev`), or rate-limited. Retrying any of them just spends
 * requests on a route that will not answer, so the hook latches instead.
 */
function isPermanent(error: unknown): boolean {
  return (
    error instanceof PlacesAuthError ||
    error instanceof PlacesUnavailableError ||
    error instanceof PlacesRateLimitedError
  );
}

/** Module-level so "no suggestions" is always the same reference — consumers
 * feed it straight into a `useMemo` dependency list. */
const NO_SUGGESTIONS: PlaceSuggestion[] = [];

/** The last answer received, tagged with the query it answers. */
interface Outcome {
  query: string;
  suggestions: PlaceSuggestion[];
  /** False after a transient failure: settled, but with nothing to show. */
  ok: boolean;
}

export function usePlaceSearch(query: string, options?: { enabled?: boolean }): PlaceSearch {
  const enabled = options?.enabled ?? true;
  const debouncedQuery = useDebouncedValue(query.trim(), PLACE_SEARCH_DEBOUNCE_MS);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  /** Text produced BY a selection, which must not start a new lookup. */
  const [suppressed, setSuppressed] = useState<ReadonlySet<string>>(() => new Set());

  /** The current session's token, or null between sessions. */
  const tokenRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Monotonic, so a response that resolves out of order can be discarded. */
  const requestIdRef = useRef(0);
  /** The last query actually sent, so a re-render never re-sends it. */
  const lastQueryRef = useRef<string | null>(null);
  /** Mirrors `unavailable` for `resolve`, which must not re-run on it. */
  const unavailableRef = useRef(false);

  // Only the `false` value is trusted — it means definitely offline. We never
  // gate ON `onLine === true`, which lies behind captive portals. Read rather
  // than subscribed to: the next keystroke re-evaluates it, and a typeahead
  // that fires a burst of requests the instant a network returns is exactly
  // the failure mode this hook exists to avoid.
  const online = typeof navigator === "undefined" || navigator.onLine !== false;

  const searchable =
    enabled &&
    online &&
    !unavailable &&
    debouncedQuery.length >= MIN_QUERY_LENGTH &&
    !suppressed.has(debouncedQuery);

  useEffect(() => {
    if (!searchable) {
      lastQueryRef.current = null;
      // An empty field is the one unambiguous "this session is over" signal —
      // no pick is coming, so hold no token into the next one. Blur is NOT
      // such a signal: it can fire as part of clicking a suggestion, and
      // discarding the token there would strand the Details call on a token
      // Google never saw, abandoning the session it was meant to terminate.
      if (debouncedQuery.length === 0) tokenRef.current = null;
      return;
    }

    if (debouncedQuery === lastQueryRef.current) return;

    lastQueryRef.current = debouncedQuery;

    // Abort the previous lookup before starting another: at most one
    // autocomplete is ever in flight per field.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    // Minted HERE — at the first request that actually goes out — rather than
    // on focus. Same session boundary, but focus-without-typing can never mint
    // a token that is then discarded unspent.
    tokenRef.current ??= crypto.randomUUID();

    fetchPlaceSuggestions(debouncedQuery, tokenRef.current, controller.signal)
      .then((suggestions) => {
        // Belt and braces with `abort`: a response already sitting in the
        // microtask queue when the abort fires still resolves.
        if (requestId !== requestIdRef.current) return;
        setOutcome({ query: debouncedQuery, suggestions, ok: true });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        if (isPermanent(error)) {
          unavailableRef.current = true;
          setUnavailable(true);
          return;
        }
        // Transient (502, network). Recorded as settled-but-not-ok so the UI
        // falls silent rather than claiming "no matches" — the field is still
        // perfectly usable as free text. The dedupe is cleared so the same
        // query can be retried.
        console.error("[places] suggestion lookup failed", error);
        lastQueryRef.current = null;
        setOutcome({ query: debouncedQuery, suggestions: NO_SUGGESTIONS, ok: false });
      });

    return () => {
      controller.abort();
      // Clearing the dedupe alongside the abort is what keeps StrictMode's
      // deliberate mount → cleanup → mount from wedging the field: without it
      // the second run sees its own query already recorded, returns early, and
      // no suggestions ever arrive in development.
      if (lastQueryRef.current === debouncedQuery) lastQueryRef.current = null;
    };
  }, [debouncedQuery, searchable]);

  /**
   * Both outputs are DERIVED, never stored. Storing them would mean clearing
   * them synchronously inside the effect on every query that must not search
   * (too short, disabled, suppressed) — a cascading re-render on each
   * keystroke, and the kind of stale-list bug where the rows on screen answer
   * a query the field no longer holds. Here that is structurally impossible:
   * an `Outcome` is only ever shown against the exact query it answers.
   */
  const settled = outcome !== null && outcome.query === debouncedQuery;
  const suggestions = searchable && settled ? outcome.suggestions : NO_SUGGESTIONS;
  const status: PlaceSearchStatus = unavailable
    ? "unavailable"
    : !searchable
      ? "idle"
      : !settled
        ? "loading"
        : outcome.ok
          ? "ready"
          : "idle";

  const resolve = useCallback(
    async (placeId: string, inputText: string): Promise<ResolvedPlace | null> => {
      if (unavailableRef.current) return null;

      const token = (tokenRef.current ??= crypto.randomUUID());
      // Spend it. One Details call per token, always — see the header comment.
      tokenRef.current = null;

      // The session is over: stop any in-flight autocomplete. Suppressing the
      // filled-in text is what drops the list, via `searchable`.
      abortRef.current?.abort();
      abortRef.current = null;
      requestIdRef.current++;
      lastQueryRef.current = null;
      setSuppressed(new Set([inputText.trim()]));

      try {
        const place = await fetchPlaceDetails(placeId, token);
        // The canonical address lands in the input next; suppress it too.
        setSuppressed(new Set([inputText.trim(), place.address.trim()]));
        return place;
      } catch (error) {
        if (isPermanent(error)) {
          unavailableRef.current = true;
          setUnavailable(true);
        } else {
          console.error("[places] details lookup failed", error);
        }
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    // Discards the token, abandoning the session. Its autocompletes revert to
    // per-request pricing — unavoidable, and far cheaper than the alternative
    // of holding the token for the next session, which invalidates it and
    // bills BOTH sessions per-request.
    tokenRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current++;
    lastQueryRef.current = null;
    setOutcome(null);
  }, []);

  return { suggestions, status, resolve, reset };
}
