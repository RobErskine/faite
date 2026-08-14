import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH } from "@/lib/places/wire";
import { parseAutocompleteRequest, parseDetailsRequest } from "./validate";

const TOKEN = "8f14e45f-ceea-467a-9575-9dc0c2a4d1b2";

describe("parseAutocompleteRequest", () => {
  it("accepts a well-formed request", () => {
    expect(parseAutocompleteRequest({ input: "1600 Amphi", sessionToken: TOKEN })).toEqual({
      input: "1600 Amphi",
      sessionToken: TOKEN,
    });
  });

  it("trims the input before validating it", () => {
    expect(parseAutocompleteRequest({ input: "  cafe  ", sessionToken: TOKEN })?.input).toBe("cafe");
  });

  it("rejects a whitespace-only input rather than spending a billable request on it", () => {
    expect(parseAutocompleteRequest({ input: "   ", sessionToken: TOKEN })).toBeNull();
    expect(parseAutocompleteRequest({ input: "", sessionToken: TOKEN })).toBeNull();
  });

  it("accepts exactly MAX_QUERY_LENGTH and rejects one past it", () => {
    const at = "a".repeat(MAX_QUERY_LENGTH);
    expect(parseAutocompleteRequest({ input: at, sessionToken: TOKEN })?.input).toBe(at);
    expect(parseAutocompleteRequest({ input: `${at}a`, sessionToken: TOKEN })).toBeNull();
  });

  it("rejects a missing or non-string input", () => {
    expect(parseAutocompleteRequest({ sessionToken: TOKEN })).toBeNull();
    expect(parseAutocompleteRequest({ input: 42, sessionToken: TOKEN })).toBeNull();
    expect(parseAutocompleteRequest({ input: null, sessionToken: TOKEN })).toBeNull();
  });

  it("returns null for garbage rather than throwing", () => {
    for (const body of [null, undefined, 42, "input", [], { input: "x" }]) {
      expect(parseAutocompleteRequest(body)).toBeNull();
    }
  });
});

describe("parseDetailsRequest", () => {
  it("accepts a well-formed request", () => {
    const placeId = "ChIJj61dQgK6j4AR4GeTYWZsKWw";
    expect(parseDetailsRequest({ placeId, sessionToken: TOKEN })).toEqual({
      placeId,
      sessionToken: TOKEN,
    });
  });

  it("rejects an empty or oversized placeId", () => {
    expect(parseDetailsRequest({ placeId: "", sessionToken: TOKEN })).toBeNull();
    expect(parseDetailsRequest({ placeId: "x".repeat(256), sessionToken: TOKEN })).toBeNull();
  });

  it("returns null for garbage rather than throwing", () => {
    for (const body of [null, undefined, 0, "place", []]) {
      expect(parseDetailsRequest(body)).toBeNull();
    }
  });
});

/**
 * The session token is the one field here whose shape is a security property:
 * it is interpolated into the Place Details query string. A token carrying `&`
 * or a newline would let a caller append their own parameters to a request
 * made with OUR api key. Both parsers share the schema, so both are asserted.
 */
describe("session token validation", () => {
  const accepts = (sessionToken: string) => [
    parseAutocompleteRequest({ input: "cafe", sessionToken }),
    parseDetailsRequest({ placeId: "ChIJ", sessionToken }),
  ];

  it("accepts a real crypto.randomUUID()", () => {
    const uuid = crypto.randomUUID();
    expect(uuid.length).toBeLessThanOrEqual(36);
    for (const parsed of accepts(uuid)) expect(parsed).not.toBeNull();
  });

  it("accepts a 36-char URL-safe base64 string, Google's documented maximum", () => {
    for (const parsed of accepts(`${"aA0_-".repeat(7)}z`)) expect(parsed).not.toBeNull();
  });

  it("REGRESSION: rejects query-string injection characters", () => {
    // `&key=…`, `?`, a newline, or a space would each let a caller reshape the
    // request `buildDetailsUrl` makes with our billable API key.
    for (const token of ["abc&key=evil", "abc?x=1", "abc def", "abc\ndef", "abc/def", "abc=", "a+b"]) {
      for (const parsed of accepts(token)) expect(parsed).toBeNull();
    }
  });

  it("rejects an empty token and one past 36 characters", () => {
    for (const parsed of accepts("")) expect(parsed).toBeNull();
    for (const parsed of accepts("a".repeat(37))) expect(parsed).toBeNull();
  });

  it("rejects a missing or non-string token", () => {
    expect(parseAutocompleteRequest({ input: "cafe" })).toBeNull();
    expect(parseDetailsRequest({ placeId: "ChIJ", sessionToken: 42 })).toBeNull();
  });
});
