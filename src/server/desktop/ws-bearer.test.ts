import { describe, expect, it } from "vitest";
import { WS_BEARER_PROTOCOL_PREFIX } from "@/lib/sync/wire";
import { extractWsBearerToken } from "./ws-bearer";

describe("extractWsBearerToken", () => {
  it("extracts the token from a single offered subprotocol", () => {
    expect(extractWsBearerToken(`${WS_BEARER_PROTOCOL_PREFIX}abc123`)).toBe("abc123");
  });

  it("finds the token among other comma-separated subprotocols", () => {
    expect(extractWsBearerToken(`chat, ${WS_BEARER_PROTOCOL_PREFIX}abc123, v2`)).toBe("abc123");
  });

  it("rejects absent, empty, and prefix-with-no-token", () => {
    expect(extractWsBearerToken(null)).toBeNull();
    expect(extractWsBearerToken("")).toBeNull();
    expect(extractWsBearerToken(WS_BEARER_PROTOCOL_PREFIX)).toBeNull();
  });

  it("ignores subprotocols that merely contain the prefix, not start with it", () => {
    expect(extractWsBearerToken(`not-${WS_BEARER_PROTOCOL_PREFIX}abc123`)).toBeNull();
  });
});
