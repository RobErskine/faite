import { describe, expect, it } from "vitest";
import { WS_BEARER_PROTOCOL_PREFIX } from "@/lib/sync/wire";
import { extractBearerCredential } from "./bearer";

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("extractBearerCredential", () => {
  it("reads an ordinary Authorization header", () => {
    expect(extractBearerCredential(headers({ authorization: "Bearer faite_abc123" }))).toBe(
      "faite_abc123",
    );
  });

  it("is case-insensitive on the header name (Headers itself normalizes this)", () => {
    expect(extractBearerCredential(headers({ Authorization: "Bearer faite_abc123" }))).toBe(
      "faite_abc123",
    );
  });

  it("rejects a non-Bearer scheme", () => {
    expect(extractBearerCredential(headers({ authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
  });

  it("rejects an empty Bearer token", () => {
    expect(extractBearerCredential(headers({ authorization: "Bearer " }))).toBeNull();
  });

  it("falls back to the WebSocket-upgrade carrier when there is no Authorization header", () => {
    expect(
      extractBearerCredential(headers({ "sec-websocket-protocol": `${WS_BEARER_PROTOCOL_PREFIX}abc123` })),
    ).toBe("abc123");
  });

  it("prefers Authorization over the WebSocket carrier when both are present", () => {
    expect(
      extractBearerCredential(
        headers({
          authorization: "Bearer from-header",
          "sec-websocket-protocol": `${WS_BEARER_PROTOCOL_PREFIX}from-ws`,
        }),
      ),
    ).toBe("from-header");
  });

  it("returns null with no headers at all", () => {
    expect(extractBearerCredential(null)).toBeNull();
    expect(extractBearerCredential(undefined)).toBeNull();
    expect(extractBearerCredential(headers({}))).toBeNull();
  });
});
