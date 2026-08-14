import { describe, expect, it } from "vitest";
import { buildDetailsUrl, mapDetails, mapSuggestions, upstreamFailure } from "./google";

function placePrediction(overrides: Record<string, unknown> = {}) {
  return {
    placePrediction: {
      placeId: "ChIJ_1",
      text: { text: "Blue Bottle Coffee, 300 Webster St, Oakland, CA" },
      structuredFormat: {
        mainText: { text: "Blue Bottle Coffee" },
        secondaryText: { text: "300 Webster St, Oakland, CA" },
      },
      ...overrides,
    },
  };
}

describe("mapSuggestions", () => {
  it("maps structuredFormat into primary/secondary", () => {
    expect(mapSuggestions({ suggestions: [placePrediction()] })).toEqual([
      {
        placeId: "ChIJ_1",
        primary: "Blue Bottle Coffee",
        secondary: "300 Webster St, Oakland, CA",
      },
    ]);
  });

  it("REGRESSION: drops queryPrediction entries, which have no placeId", () => {
    // Google interleaves both variants in one array. A query prediction is a
    // search *term*, not a place — mapped through, it would render as a
    // clickable row that can never resolve, and whose Details call would 404
    // and so never terminate the billing session.
    const raw = {
      suggestions: [
        { queryPrediction: { text: { text: "coffee near me" } } },
        placePrediction(),
        { queryPrediction: { text: { text: "coffee shops" } } },
      ],
    };
    const mapped = mapSuggestions(raw);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].placeId).toBe("ChIJ_1");
  });

  it("falls back to text.text when structuredFormat is absent", () => {
    const raw = { suggestions: [placePrediction({ structuredFormat: undefined })] };
    expect(mapSuggestions(raw)).toEqual([
      {
        placeId: "ChIJ_1",
        primary: "Blue Bottle Coffee, 300 Webster St, Oakland, CA",
        secondary: "",
      },
    ]);
  });

  it("defaults secondary to an empty string when only mainText is present", () => {
    const raw = {
      suggestions: [placePrediction({ structuredFormat: { mainText: { text: "Home" } } })],
    };
    expect(mapSuggestions(raw)[0]).toEqual({ placeId: "ChIJ_1", primary: "Home", secondary: "" });
  });

  it("drops an entry with no usable text at all", () => {
    const raw = {
      suggestions: [placePrediction({ text: undefined, structuredFormat: undefined })],
    };
    expect(mapSuggestions(raw)).toEqual([]);
  });

  it("returns [] for an absent, null, or non-array suggestions field", () => {
    for (const raw of [{}, { suggestions: null }, { suggestions: "nope" }, null, undefined, 42]) {
      expect(mapSuggestions(raw)).toEqual([]);
    }
  });
});

describe("mapDetails", () => {
  const raw = {
    id: "ChIJj61dQgK6j4AR4GeTYWZsKWw",
    formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
    location: { latitude: 37.422, longitude: -122.0841 },
  };

  it("round-trips a full response", () => {
    expect(mapDetails(raw)).toEqual({
      placeId: "ChIJj61dQgK6j4AR4GeTYWZsKWw",
      address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
      lat: 37.422,
      lng: -122.0841,
    });
  });

  it("keeps the place with null coordinates when location is absent", () => {
    // Not a failure: an address without coordinates is still worth saving, and
    // nothing in scope reads lat/lng (geofencing is explicitly out — §0).
    expect(mapDetails({ ...raw, location: undefined })).toMatchObject({ lat: null, lng: null });
  });

  it("nulls a non-finite coordinate rather than storing NaN", () => {
    const broken = { ...raw, location: { latitude: "37.4", longitude: Number.NaN } };
    expect(mapDetails(broken)).toMatchObject({ lat: null, lng: null });
  });

  it("returns null when id or formattedAddress is missing", () => {
    expect(mapDetails({ ...raw, id: undefined })).toBeNull();
    expect(mapDetails({ ...raw, formattedAddress: undefined })).toBeNull();
    expect(mapDetails({})).toBeNull();
    expect(mapDetails(null)).toBeNull();
  });
});

describe("buildDetailsUrl", () => {
  const TOKEN = "8f14e45f-ceea-467a-9575-9dc0c2a4d1b2";

  it("puts the session token in the sessionToken query parameter", () => {
    // THE billing assertion. Google terminates a session on the Details call
    // that carries the same token the autocompletes used; drop it here and
    // every session is abandoned, which reverts all of them to per-request
    // pricing — silently, with the feature still working perfectly.
    const url = new URL(buildDetailsUrl("ChIJ_1", TOKEN));
    expect(url.searchParams.get("sessionToken")).toBe(TOKEN);
  });

  it("targets the Places API (New) details endpoint", () => {
    const url = new URL(buildDetailsUrl("ChIJ_1", TOKEN));
    expect(url.origin).toBe("https://places.googleapis.com");
    expect(url.pathname).toBe("/v1/places/ChIJ_1");
  });

  it("percent-encodes the place id into the path", () => {
    const url = new URL(buildDetailsUrl("ChIJ/weird?id", TOKEN));
    expect(url.pathname).toBe("/v1/places/ChIJ%2Fweird%3Fid");
    expect(url.searchParams.get("sessionToken")).toBe(TOKEN);
  });
});

describe("upstreamFailure", () => {
  it("passes 429 through so the client can latch on it", () => {
    expect(upstreamFailure(429)).toEqual({ status: 429, error: "rate-limited" });
  });

  it("maps a Google 400 to 502, not 400", () => {
    // Our validation already passed, so a rejected request means WE built it
    // wrong. Returning 400 would blame the caller and send someone debugging
    // the browser instead of the field mask.
    expect(upstreamFailure(400).status).toBe(502);
  });

  it("maps 403 to 502 — a restricted key or disabled API is a deploy fault", () => {
    expect(upstreamFailure(403)).toEqual({ status: 502, error: "upstream-error" });
  });

  it("maps 5xx to upstream-unavailable", () => {
    expect(upstreamFailure(500)).toEqual({ status: 502, error: "upstream-unavailable" });
    expect(upstreamFailure(503)).toEqual({ status: 502, error: "upstream-unavailable" });
  });

  it("never returns a 2xx for any status", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
      expect(upstreamFailure(status).status).toBeGreaterThanOrEqual(400);
    }
  });
});
