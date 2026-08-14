// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  fetchPlaceDetails,
  fetchPlaceSuggestions,
  PlacesAuthError,
  PlacesHttpError,
  PlacesRateLimitedError,
  PlacesUnavailableError,
} from "@/lib/places/transport";
import { PLACE_SEARCH_DEBOUNCE_MS, usePlaceSearch } from "./use-place-search";

/**
 * **The billing file.** Every assertion here is about how much this feature
 * costs, not what it renders — see `use-place-search.ts`'s header and
 * `docs/LOCATION.md` §5. Every one of these can break while the
 * typeahead still looks and behaves perfectly; the bill is the only symptom.
 */

// Keep the real error classes — `isPermanent` narrows with `instanceof`, so
// mocking them into plain objects would silently disable the latch.
vi.mock("@/lib/places/transport", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/places/transport")>("@/lib/places/transport");
  return { ...actual, fetchPlaceSuggestions: vi.fn(), fetchPlaceDetails: vi.fn() };
});

const suggest = vi.mocked(fetchPlaceSuggestions);
const details = vi.mocked(fetchPlaceDetails);

const SUGGESTION = { placeId: "ChIJ_1", primary: "Blue Bottle", secondary: "300 Webster St" };
const RESOLVED = { placeId: "ChIJ_1", address: "300 Webster St, Oakland, CA", lat: 37.8, lng: -122.2 };

/**
 * Advances past the debounce and flushes the promise chain the effect started.
 *
 * `waitFor` is deliberately NOT used anywhere in this file: it polls on real
 * timers, so under `vi.useFakeTimers()` it never re-checks and every
 * assertion that reaches for it hangs until the test times out.
 */
async function settle(ms = PLACE_SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  // A second pass: the effect's `.then`/`.catch` is queued during the first.
  await act(async () => {});
}

function tokensUsed() {
  return suggest.mock.calls.map((call) => call[1]);
}

/**
 * Spies that must be undone by hand. `vi.clearAllMocks()` resets call records
 * but leaves a `spyOn` getter in place, and one leaked `navigator.onLine`
 * override silently disables every request in every test that follows it —
 * which reads as "the hook is broken" rather than "the test leaked".
 */
let spies: MockInstance[] = [];

function goOffline() {
  spies.push(vi.spyOn(navigator, "onLine", "get").mockReturnValue(false));
}

beforeEach(() => {
  vi.useFakeTimers();
  suggest.mockResolvedValue([SUGGESTION]);
  details.mockResolvedValue(RESOLVED);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const spy of spies) spy.mockRestore();
  spies = [];
  vi.clearAllMocks();
});

function render(initial = "") {
  return renderHook(
    ({ query, enabled }: { query: string; enabled: boolean }) =>
      usePlaceSearch(query, { enabled }),
    { initialProps: { query: initial, enabled: true } },
  );
}

describe("request volume", () => {
  it("REGRESSION: a burst of keystrokes produces exactly ONE request", async () => {
    // Un-debounced, this is one billable Google Autocomplete request per
    // keypress. It is the single largest cost lever in the feature.
    const { rerender } = render();

    for (const query of ["160", "1600", "1600 ", "1600 A", "1600 Amp"]) {
      rerender({ query, enabled: true });
      await settle(50);
    }
    await settle();

    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toBe("1600 Amp");
  });

  it("never calls out below MIN_QUERY_LENGTH", async () => {
    const { rerender } = render();
    for (const query of ["1", "16"]) {
      rerender({ query, enabled: true });
      await settle();
    }
    expect(suggest).not.toHaveBeenCalled();
  });

  it("never calls out while disabled — this is the saved-nickname short-circuit", async () => {
    const { rerender } = render();
    rerender({ query: "Home", enabled: false });
    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("does not re-request a query it already sent", async () => {
    const { rerender } = render();

    rerender({ query: "cafe", enabled: true });
    await settle();
    // Same text arriving again (a re-render, or type-delete-retype).
    rerender({ query: "cafe ", enabled: true });
    await settle();

    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it("does not call out when the browser reports it is definitely offline", async () => {
    goOffline();
    const { rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });
});

describe("session tokens", () => {
  it("reuses one token for every request in a session", async () => {
    const { rerender } = render();

    for (const query of ["cafe", "cafe n", "cafe near"]) {
      rerender({ query, enabled: true });
      await settle();
    }

    expect(suggest).toHaveBeenCalledTimes(3);
    expect(new Set(tokensUsed()).size).toBe(1);
  });

  it("mints a token that Google will accept", async () => {
    const { rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    // "URL and filename safe base64, at most 36 ASCII characters."
    expect(tokensUsed()[0]).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
  });

  it("REGRESSION: terminates the session with exactly one Details call on the SAME token", async () => {
    // The whole point. Autocomplete requests are only cheap when grouped into
    // a session that ends in one Details call carrying the same token; an
    // abandoned session reverts every request in it to per-request pricing.
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    await act(async () => {
      await result.current.resolve("ChIJ_1", "Blue Bottle, 300 Webster St");
    });

    expect(details).toHaveBeenCalledTimes(1);
    expect(details.mock.calls[0][1]).toBe(tokensUsed()[0]);
  });

  it("REGRESSION: mints a NEW token for the next session", async () => {
    // Reusing a token across two completed sessions makes Google invalidate it
    // and bill everything in BOTH per-request — worse than never having used
    // session tokens at all.
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    await act(async () => {
      await result.current.resolve("ChIJ_1", "Blue Bottle, 300 Webster St");
    });

    rerender({ query: "hardware store", enabled: true });
    await settle();

    const [first, second] = tokensUsed();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("discards the token on reset, so an abandoned session never leaks into the next", async () => {
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    act(() => result.current.reset());

    rerender({ query: "bakery", enabled: true });
    await settle();

    const [first, second] = tokensUsed();
    expect(second).not.toBe(first);
  });

  it("REGRESSION: picking a suggestion does not open a second, doomed session", async () => {
    // Base UI fills the input with the picked item's text synchronously
    // (`fillInputOnItemPress` is hardcoded true), which flows straight back in
    // as a new query. Unsuppressed, every pick costs one extra request AND
    // opens a session that can only ever be abandoned.
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();
    expect(suggest).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.resolve("ChIJ_1", "Blue Bottle, 300 Webster St");
    });

    // The input now holds the filled label, then the canonical address.
    rerender({ query: "Blue Bottle, 300 Webster St", enabled: true });
    await settle();
    rerender({ query: RESOLVED.address, enabled: true });
    await settle();

    expect(suggest).toHaveBeenCalledTimes(1);
  });
});

describe("results", () => {
  it("exposes suggestions and reports ready", async () => {
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    expect(result.current.suggestions).toEqual([SUGGESTION]);
    expect(result.current.status).toBe("ready");
  });

  it("clears stale rows when the query drops below the floor", async () => {
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();
    expect(result.current.suggestions).toHaveLength(1);

    rerender({ query: "c", enabled: true });
    await settle();

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.status).toBe("idle");
  });

  it("REGRESSION: a stale response never overwrites a newer one", async () => {
    // Abort covers most of this; a response already sitting in the microtask
    // queue when the abort fires still resolves, which is what the monotonic
    // request id catches.
    const slow = { placeId: "old", primary: "Stale", secondary: "" };
    let releaseSlow: (value: typeof slow[]) => void = () => {};
    suggest.mockImplementationOnce(
      () => new Promise((resolve) => { releaseSlow = resolve; }),
    );

    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    rerender({ query: "bakery", enabled: true });
    await settle();
    expect(result.current.suggestions).toEqual([SUGGESTION]);

    // The first request finally answers, long after it was superseded.
    await act(async () => releaseSlow([slow]));

    expect(result.current.suggestions).toEqual([SUGGESTION]);
  });
});

describe("degradation", () => {
  const permanent = [
    { name: "401 signed out", error: () => new PlacesAuthError() },
    { name: "501 no key", error: () => new PlacesUnavailableError("places-not-configured") },
    { name: "429 rate limited", error: () => new PlacesRateLimitedError() },
  ];

  for (const { name, error } of permanent) {
    it(`latches unavailable on ${name} and stops calling`, async () => {
      suggest.mockRejectedValue(error());
      const { result, rerender } = render();

      rerender({ query: "cafe", enabled: true });
      await settle();
      expect(result.current.status).toBe("unavailable");

      rerender({ query: "bakery", enabled: true });
      await settle();
      rerender({ query: "hardware", enabled: true });
      await settle();

      // One doomed request, then silence. The field is still usable as free
      // text — the product rule is "you can still type an address, we just
      // don't match it", so this must never surface as an error.
      expect(suggest).toHaveBeenCalledTimes(1);
      expect(result.current.suggestions).toEqual([]);
    });
  }

  it("stays quiet, but keeps trying, on a transient upstream failure", async () => {
    suggest.mockRejectedValueOnce(new PlacesHttpError(502, "upstream"));
    const { result, rerender } = render();

    rerender({ query: "cafe", enabled: true });
    await settle();
    expect(result.current.status).toBe("idle");
    expect(result.current.suggestions).toEqual([]);

    rerender({ query: "bakery", enabled: true });
    await settle();

    expect(suggest).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("ready");
  });

  it("resolves to null instead of throwing when Details fails", async () => {
    details.mockRejectedValue(new PlacesHttpError(502, "upstream"));
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();

    let resolved: unknown = "unset";
    await act(async () => {
      resolved = await result.current.resolve("ChIJ_1", "Blue Bottle");
    });

    // The caller keeps the optimistic text it already showed; a failed lookup
    // must never become an error dialog over a field that still works.
    expect(resolved).toBeNull();
  });

  it("does not call Details at all once unavailable", async () => {
    suggest.mockRejectedValue(new PlacesAuthError());
    const { result, rerender } = render();
    rerender({ query: "cafe", enabled: true });
    await settle();
    expect(result.current.status).toBe("unavailable");

    await act(async () => {
      await result.current.resolve("ChIJ_1", "Blue Bottle");
    });

    expect(details).not.toHaveBeenCalled();
  });
});
