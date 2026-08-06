import { describe, expect, it } from "vitest";
import { TRUSTED_ORIGINS } from "../auth";
import { isAllowedWsOrigin, isWebSocketUpgrade, USER_ID_HEADER } from "./ws-server";

const PROD = "https://myfaite.app/api/sync/ws";
const PREVIEW = "https://feat-live-push-faite.bfmw-dev.workers.dev/api/sync/ws";
const LOCAL = "http://localhost:8787/api/sync/ws";

describe("isAllowedWsOrigin — CSWSH defense", () => {
  /**
   * This is a security boundary, not a convenience check. A WebSocket
   * handshake is sent with cookies, without a preflight, and CORS has no say
   * in whether it succeeds — so unlike `/api/sync/push`, where `corsHeaders`
   * only decides how to annotate a response, this predicate is the only
   * thing between evil.com and a signed-in user's entire board.
   */
  it("REGRESSION: rejects a hostile cross-site origin", () => {
    expect(isAllowedWsOrigin("https://evil.com", PROD)).toBe(false);
    expect(isAllowedWsOrigin("http://evil.com", PROD)).toBe(false);
    expect(isAllowedWsOrigin("null", PROD)).toBe(false);
  });

  it("rejects a lookalike that merely contains the real host", () => {
    expect(isAllowedWsOrigin("https://myfaite.app.evil.com", PROD)).toBe(false);
    expect(isAllowedWsOrigin("https://evil.com/?https://myfaite.app", PROD)).toBe(false);
    expect(isAllowedWsOrigin("https://notmyfaite.app", PROD)).toBe(false);
  });

  it("rejects the right host on the wrong scheme or port", () => {
    // `URL.origin` includes all three components, which is the point.
    expect(isAllowedWsOrigin("http://myfaite.app", PROD)).toBe(false);
    expect(isAllowedWsOrigin("http://localhost:9999", LOCAL)).toBe(false);
  });

  it("accepts same-origin", () => {
    expect(isAllowedWsOrigin("https://myfaite.app", PROD)).toBe(true);
    expect(isAllowedWsOrigin("http://localhost:8787", LOCAL)).toBe(true);
  });

  it("REGRESSION: accepts a branch preview, which is same-origin but NOT on the allow-list", () => {
    // `preview_urls: true` in wrangler.jsonc puts every branch at
    // *-faite.bfmw-dev.workers.dev, and those are deliberately absent from
    // TRUSTED_ORIGINS because createAuth derives baseURL from the request
    // origin instead. Checking only the allow-list would 403 the socket on
    // every preview while HTTP sync kept working — which reads as
    // "hibernation is broken", not "the origin check is wrong".
    expect(TRUSTED_ORIGINS).not.toContain("https://feat-live-push-faite.bfmw-dev.workers.dev");
    expect(isAllowedWsOrigin("https://feat-live-push-faite.bfmw-dev.workers.dev", PREVIEW)).toBe(true);
  });

  it("accepts every origin on the shared allow-list, cross-origin included", () => {
    // The `next dev` (:3000) against preview-worker (:8787) setup, and
    // capacitor://localhost at P7.
    for (const origin of TRUSTED_ORIGINS) {
      expect(isAllowedWsOrigin(origin, PROD)).toBe(true);
    }
  });

  it("allows an absent Origin, because a browser cannot omit it", () => {
    // RFC 6455 requires browser clients to send Origin, so absent means a
    // non-browser client (wscat, curl, a native app) — which cannot be a
    // confused deputy and still had to present a valid session cookie to get
    // this far. Rejecting here would break the smoke test and buy nothing.
    expect(isAllowedWsOrigin(null, PROD)).toBe(true);
  });

  it("rejects rather than throws on an unparseable request URL", () => {
    expect(() => isAllowedWsOrigin("https://evil.com", "not a url")).not.toThrow();
    expect(isAllowedWsOrigin("https://evil.com", "not a url")).toBe(false);
  });
});

describe("isWebSocketUpgrade", () => {
  it("matches case-insensitively, since header VALUES are not normalised", () => {
    expect(isWebSocketUpgrade("websocket")).toBe(true);
    expect(isWebSocketUpgrade("WebSocket")).toBe(true);
    expect(isWebSocketUpgrade("WEBSOCKET")).toBe(true);
  });

  it("rejects anything else, including absent", () => {
    expect(isWebSocketUpgrade(null)).toBe(false);
    expect(isWebSocketUpgrade("")).toBe(false);
    expect(isWebSocketUpgrade("h2c")).toBe(false);
    expect(isWebSocketUpgrade("websocket, h2c")).toBe(false);
  });
});

describe("USER_ID_HEADER", () => {
  it("is lowercase, matching how Headers normalises names", () => {
    expect(USER_ID_HEADER).toBe(USER_ID_HEADER.toLowerCase());
  });

  it("is namespaced, so it cannot collide with a platform header", () => {
    expect(USER_ID_HEADER.startsWith("x-faite-")).toBe(true);
  });
});
