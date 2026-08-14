import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPlaceDetails,
  fetchPlaceSuggestions,
  PlacesAuthError,
  PlacesHttpError,
  PlacesRateLimitedError,
  PlacesUnavailableError,
} from "./transport";

const TOKEN = "8f14e45f-ceea-467a-9575-9dc0c2a4d1b2";

function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchPlaceSuggestions", () => {
  it("posts to the proxy and returns the suggestions", async () => {
    const suggestions = [{ placeId: "ChIJ_1", primary: "Home", secondary: "1 Main St" }];
    const fetchMock = stubFetch(200, { suggestions });

    await expect(fetchPlaceSuggestions("1 Main", TOKEN)).resolves.toEqual(suggestions);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/places/autocomplete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ input: "1 Main", sessionToken: TOKEN });
  });

  it("sends credentials — the proxy authenticates against the Better Auth cookie", () => {
    // Without this, every request is anonymous and 401s, and local dev
    // (:3000 → :8787) is cross-origin so the cookie is not sent by default.
    const fetchMock = stubFetch(200, { suggestions: [] });
    void fetchPlaceSuggestions("cafe", TOKEN);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  it("tolerates a response with no suggestions field", async () => {
    stubFetch(200, {});
    await expect(fetchPlaceSuggestions("cafe", TOKEN)).resolves.toEqual([]);
  });

  it("REGRESSION: routes through apiUrl so `next dev` reaches the preview worker", async () => {
    // A bare relative path 404s on :3000 (no Worker there), which latches the
    // hook as permanently unavailable — one request per mount, then silence.
    vi.stubEnv("NEXT_PUBLIC_AUTH_URL", "http://localhost:8787");
    const fetchMock = stubFetch(200, { suggestions: [] });

    await fetchPlaceSuggestions("cafe", TOKEN);

    const [path] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("http://localhost:8787/api/places/autocomplete");
    vi.unstubAllEnvs();
  });

  it("forwards the AbortSignal so a stale in-flight lookup can be cancelled", () => {
    const fetchMock = stubFetch(200, { suggestions: [] });
    const controller = new AbortController();
    void fetchPlaceSuggestions("cafe", TOKEN, controller.signal);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

describe("fetchPlaceDetails", () => {
  it("posts the placeId and the session token that terminates the session", async () => {
    const place = { placeId: "ChIJ_1", address: "1 Main St", lat: 1, lng: 2 };
    const fetchMock = stubFetch(200, place);

    await expect(fetchPlaceDetails("ChIJ_1", TOKEN)).resolves.toEqual(place);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/places/details");
    expect(JSON.parse(init.body as string)).toEqual({ placeId: "ChIJ_1", sessionToken: TOKEN });
  });

  it("takes no AbortSignal — it must land even after the popup closes", () => {
    // If this call is cancelled the session is abandoned, and every
    // autocomplete in it reverts to per-request pricing. See §4 of
    // docs/LOCATION.md §5.
    const fetchMock = stubFetch(200, {});
    void fetchPlaceDetails("ChIJ_1", TOKEN);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeUndefined();
  });
});

/**
 * Three of these four are PERMANENT for the page, and `usePlaceSearch` latches
 * on them so it stops calling a billable route that is never going to answer.
 * Collapsing them into one error type would remove the ability to tell
 * "retry later" from "stop asking".
 */
describe("status mapping", () => {
  const cases = [
    { status: 401, error: PlacesAuthError, why: "signed out" },
    { status: 501, error: PlacesUnavailableError, why: "no API key on this deployment" },
    { status: 404, error: PlacesUnavailableError, why: "no /api/* at all — i.e. next dev" },
    { status: 429, error: PlacesRateLimitedError, why: "rate limited" },
    { status: 502, error: PlacesHttpError, why: "upstream failure — transient" },
    { status: 500, error: PlacesHttpError, why: "internal error — transient" },
  ];

  for (const { status, error, why } of cases) {
    it(`maps ${status} to ${error.name} (${why})`, async () => {
      stubFetch(status, { error: "x" });
      await expect(fetchPlaceSuggestions("cafe", TOKEN)).rejects.toBeInstanceOf(error);
    });
  }

  it("carries the status on PlacesHttpError so a caller can tell transients apart", async () => {
    stubFetch(502, {});
    await expect(fetchPlaceSuggestions("cafe", TOKEN)).rejects.toMatchObject({ status: 502 });
  });
});
