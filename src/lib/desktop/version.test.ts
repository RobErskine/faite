import { describe, expect, it } from "vitest";
import {
  compareVersions,
  evaluateUpdate,
  parseVersionPolicy,
  type DesktopVersionPolicy,
} from "./version";

const POLICY: DesktopVersionPolicy = {
  latest: "0.3.0",
  minimum: "0.2.0",
  downloadUrl: "https://myfaite.app/download",
};

describe("compareVersions", () => {
  it("orders by each numeric segment in turn", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
  });

  it("treats a missing trailing segment as zero", () => {
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
  });

  it("ignores a leading v and any pre-release or build suffix", () => {
    expect(compareVersions("v0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("0.3.0-beta.1", "0.3.0")).toBe(0);
    expect(compareVersions("0.3.0+build.7", "0.3.0")).toBe(0);
  });

  it("returns null rather than guessing at a non-version", () => {
    expect(compareVersions("nightly", "0.1.0")).toBeNull();
    expect(compareVersions("0.1.0", "")).toBeNull();
  });
});

describe("evaluateUpdate", () => {
  it("reports current on the newest build", () => {
    expect(evaluateUpdate("0.3.0", POLICY)).toEqual({ status: "current" });
  });

  it("reports current on a build newer than the server knows about", () => {
    // A local `tauri build` while `latest` still names the last release.
    expect(evaluateUpdate("0.4.0", POLICY)).toEqual({ status: "current" });
  });

  it("reports outdated between the minimum and the latest", () => {
    expect(evaluateUpdate("0.2.0", POLICY)).toEqual({
      status: "outdated",
      installed: "0.2.0",
      latest: "0.3.0",
      downloadUrl: POLICY.downloadUrl,
    });
  });

  it("reports blocked below the minimum", () => {
    expect(evaluateUpdate("0.1.9", POLICY)).toEqual({
      status: "blocked",
      installed: "0.1.9",
      latest: "0.3.0",
      downloadUrl: POLICY.downloadUrl,
    });
  });

  it("never blocks on a version it cannot read", () => {
    // A typo in a constant must not brick every running copy of the app.
    expect(evaluateUpdate("dev", POLICY)).toEqual({ status: "current" });
    // An unreadable floor only takes the BLOCK off the table — a readable
    // `latest` still gets to say an update exists.
    expect(evaluateUpdate("0.1.0", { ...POLICY, minimum: "oops" }).status).toBe("outdated");
    expect(evaluateUpdate("0.1.0", { latest: "x", minimum: "y", downloadUrl: POLICY.downloadUrl })).toEqual({
      status: "current",
    });
  });
});

describe("parseVersionPolicy", () => {
  it("accepts a well-formed policy", () => {
    expect(parseVersionPolicy({ ...POLICY })).toEqual(POLICY);
  });

  it("rejects a missing or non-string field", () => {
    expect(parseVersionPolicy({ latest: "0.3.0", minimum: "0.2.0" })).toBeNull();
    expect(parseVersionPolicy({ ...POLICY, latest: 3 })).toBeNull();
    expect(parseVersionPolicy(null)).toBeNull();
    expect(parseVersionPolicy("0.3.0")).toBeNull();
  });

  it("rejects a download URL that is not on the app's own origin", () => {
    // The Tauri opener allow-list would refuse it anyway; this makes the
    // refusal a quiet no-op instead of a failed invoke at click time.
    expect(parseVersionPolicy({ ...POLICY, downloadUrl: "https://evil.test/download" })).toBeNull();
    expect(parseVersionPolicy({ ...POLICY, downloadUrl: "https://myfaite.app.evil.test/x" })).toBeNull();
  });
});

describe("parseVersionPolicy — the EI-255 assets block", () => {
  const ASSETS = {
    version: "fa1daf8e6f9c",
    minShellVersion: "0.1.0",
    manifestUrl: "https://myfaite.app/api/desktop/assets/manifest.json",
    archiveUrl: "https://myfaite.app/api/desktop/assets/faite-assets-fa1daf8e6f9c.tar.gz",
  };

  it("reads a well-formed block", () => {
    expect(parseVersionPolicy({ ...POLICY, assets: ASSETS })).toEqual({ ...POLICY, assets: ASSETS });
  });

  it("accepts a policy with no assets block at all", () => {
    expect(parseVersionPolicy({ ...POLICY })).toEqual(POLICY);
  });

  // The point of the whole block being optional: a client that knows about
  // bundles must still work against a server that has published none.
  it("leaves `assets` undefined rather than inventing one", () => {
    expect(parseVersionPolicy({ ...POLICY })?.assets).toBeUndefined();
  });

  /**
   * The load-bearing test. `/api/desktop/version` does two jobs, and telling a
   * genuinely obsolete client to stop syncing is the more important one. A typo
   * in the asset fields must cost the bundle, never the version check.
   */
  it.each([
    ["a missing version", { ...ASSETS, version: "" }],
    ["a non-string version", { ...ASSETS, version: 7 }],
    ["an unparseable minShellVersion", { ...ASSETS, minShellVersion: "latest" }],
    ["an off-origin manifest", { ...ASSETS, manifestUrl: "https://evil.example/manifest.json" }],
    ["an off-origin archive", { ...ASSETS, archiveUrl: "https://evil.example/bundle.tar.gz" }],
    ["a non-object block", "nope"],
    ["a null block", null],
  ])("drops the bundle but keeps the policy given %s", (_label, assets) => {
    const parsed = parseVersionPolicy({ ...POLICY, assets });
    expect(parsed).toEqual(POLICY);
    expect(parsed?.assets).toBeUndefined();
  });

  // Same reasoning as `downloadUrl`, only sharper: these bytes are fetched and
  // then executed as the app's own frontend.
  it("refuses a host that merely starts with the site origin", () => {
    const parsed = parseVersionPolicy({
      ...POLICY,
      assets: { ...ASSETS, archiveUrl: "https://myfaite.app.evil.example/bundle.tar.gz" },
    });
    expect(parsed?.assets).toBeUndefined();
  });
});
