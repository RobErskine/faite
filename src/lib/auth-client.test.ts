import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAuthBaseURL } from "./auth-client";

/**
 * The guard that keeps a leaked dev override from taking production login down.
 *
 * `NEXT_PUBLIC_*` is inlined at build time and Next loads `.env.local` in every
 * environment, which is exactly how `http://localhost:8787` reached
 * https://myfaite.app and killed sign-in on a CORS preflight. The override moved
 * into the `dev` script; this is the mechanism that makes the convention safe to
 * get wrong.
 *
 * Pure, so no DOM: the function takes the hostname rather than reading
 * `window.location`. Importing this module does construct the real auth client at
 * module scope, but that only builds a Proxy — it issues no requests.
 */

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAuthBaseURL", () => {
  it("is same-origin when nothing is configured", () => {
    expect(resolveAuthBaseURL(undefined, "myfaite.app")).toBeUndefined();
    expect(resolveAuthBaseURL("", "myfaite.app")).toBeUndefined();
  });

  /* The outage, as a test. */
  it("ignores a localhost override on a page served from a real domain", () => {
    expect(resolveAuthBaseURL("http://localhost:8787", "myfaite.app")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring NEXT_PUBLIC_AUTH_URL"),
    );
  });

  it("honours a localhost override for a local page — the two-terminal dev flow", () => {
    expect(resolveAuthBaseURL("http://localhost:8787", "localhost")).toBe(
      "http://localhost:8787",
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("honours a real host override, which is how Capacitor reaches the API at P7", () => {
    expect(resolveAuthBaseURL("https://myfaite.app", "localhost")).toBe("https://myfaite.app");
  });

  it("treats 127.0.0.1 and ::1 as local, on both sides", () => {
    expect(resolveAuthBaseURL("http://127.0.0.1:8787", "myfaite.app")).toBeUndefined();
    expect(resolveAuthBaseURL("http://127.0.0.1:8787", "127.0.0.1")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(resolveAuthBaseURL("http://[::1]:8787", "[::1]")).toBe("http://[::1]:8787");
  });

  it("does not mistake a real host that merely contains 'localhost'", () => {
    // `localhost.evil.com` is a real, routable domain. The anchor and the
    // separator class are what stop it matching.
    expect(resolveAuthBaseURL("https://localhost.evil.com", "myfaite.app")).toBe(
      "https://localhost.evil.com",
    );
  });

  it("trusts the value during prerender, where there is no page origin", () => {
    expect(resolveAuthBaseURL("http://localhost:8787", null)).toBe("http://localhost:8787");
  });
});
