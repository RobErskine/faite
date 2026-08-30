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
