import { describe, expect, it } from "vitest";
import { fileOriginFor, isFileOriginRequest, isIsolated } from "./origin";

const at = (href: string) => new URL(href);
const APP = at("https://myfaite.app/board");
const PROD = "https://files.myfaite.app";

describe("fileOriginFor", () => {
  it("sends bytes to the configured user-content origin", () => {
    // The point of EI-244: cross-origin, so the same-origin policy isolates
    // a previewed PDF without the sandbox attribute that breaks rendering.
    expect(fileOriginFor(APP, PROD)).toBe(PROD);
    expect(isIsolated(APP, PROD)).toBe(true);
  });

  it("falls back to same-origin when unset, which is local development", () => {
    // NOT derived from the hostname: `wrangler dev` reports the production
    // host for `url.hostname`, the `Host` header and `request.cf` alike, so
    // a derived answer would redirect local dev to a host that does not
    // resolve. `.dev.vars` blanks this instead.
    for (const unset of [undefined, "", "   "]) {
      expect(fileOriginFor(at("http://localhost:8787/board"), unset)).toBe("http://localhost:8787");
      expect(isIsolated(at("http://localhost:8787/board"), unset)).toBe(false);
    }
  });

  it("does not report isolation when pointed back at the app's own origin", () => {
    // A misconfiguration worth catching: same string, no isolation, and the
    // docs would otherwise still claim there is.
    expect(isIsolated(APP, "https://myfaite.app")).toBe(false);
  });

  it("tolerates a trailing slash rather than emitting a double one", () => {
    expect(fileOriginFor(APP, `${PROD}/`)).toBe(PROD);
  });
});

describe("isFileOriginRequest", () => {
  it("recognises the user-content host", () => {
    expect(isFileOriginRequest(at("https://files.myfaite.app/a/token"))).toBe(true);
  });

  it("does not mistake the app host for it", () => {
    expect(isFileOriginRequest(APP)).toBe(false);
  });

  it("is not fooled by a lookalike host", () => {
    // A prefix or suffix test here would be a real hole.
    expect(isFileOriginRequest(at("https://files.myfaite.app.evil.test/a/t"))).toBe(false);
    expect(isFileOriginRequest(at("https://notfiles.myfaite.app/a/t"))).toBe(false);
  });
});
