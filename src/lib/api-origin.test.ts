// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, resolveApiBaseURL } from "./api-origin";

/**
 * `resolveApiBaseURL`'s own decision table lives in `auth-client.test.ts`,
 * which pins it under its original name. This file covers `apiUrl`, the part
 * every `/api/*` transport actually calls.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.pushState({}, "", "/");
});

describe("apiUrl", () => {
  it("returns the bare path when no override is configured", () => {
    // Production and `npm run preview`: same origin, so a relative path is
    // both correct and byte-identical to what a plain fetch would send.
    vi.stubEnv("NEXT_PUBLIC_AUTH_URL", "");
    expect(apiUrl("/api/places/autocomplete")).toBe("/api/places/autocomplete");
  });

  it("REGRESSION: points at the preview worker under `next dev`", () => {
    // `next dev` (:3000) runs no Worker at all, so a relative /api/* path hits
    // Next's 404 handler. The transport maps 404 to PlacesUnavailableError and
    // `usePlaceSearch` latches on it — so the symptom is a typeahead that
    // fires one request per mount then goes silent, which looks like a broken
    // hook rather than a missing backend.
    vi.stubEnv("NEXT_PUBLIC_AUTH_URL", "http://localhost:8787");
    expect(apiUrl("/api/places/autocomplete")).toBe(
      "http://localhost:8787/api/places/autocomplete",
    );
  });

  it("ignores a localhost override on a page served from a real domain", () => {
    // The `.env.local` postmortem, reached through apiUrl rather than the
    // resolver directly — see api-origin.ts's header.
    vi.stubEnv("NEXT_PUBLIC_AUTH_URL", "http://localhost:8787");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostname = vi.spyOn(window.location, "hostname", "get").mockReturnValue("myfaite.app");

    expect(apiUrl("/api/places/details")).toBe("/api/places/details");

    hostname.mockRestore();
  });
});

describe("resolveApiBaseURL", () => {
  it("is the same function auth-client re-exports", async () => {
    // One implementation, not two: the localhost guard inside it is a
    // postmortem, and a forked copy is how that postmortem repeats.
    const { resolveAuthBaseURL } = await import("./auth-client");
    expect(resolveAuthBaseURL).toBe(resolveApiBaseURL);
  });
});
