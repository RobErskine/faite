import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareVersions, evaluateUpdate, parseVersionPolicy } from "@/lib/desktop/version";
import { DESKTOP_VERSION_POLICY } from "./version";

/** The version baked into the `.app` bundle — the ceiling for anything the
 * server can call "the newest build". */
function bundledVersion(): string {
  const conf: { version: string } = JSON.parse(
    // `.pathname`, not the URL itself: this file is also typechecked under
    // `tsconfig.worker.json`, where `URL` is the Workers one and does not
    // satisfy node's `PathOrFileDescriptor`. Same shape as `site.test.ts`.
    readFileSync(new URL("../../../src-tauri/tauri.conf.json", import.meta.url).pathname, "utf8"),
  );
  return conf.version;
}

/**
 * The policy is three hand-edited strings that decide whether a shipped app
 * still works. `evaluateUpdate` refuses to block on a version it cannot read
 * (see its doc comment), so a typo here would not brick anything — it would
 * do something worse and quieter: silently disable the check for everyone.
 * These tests are the tripwire for that.
 */
describe("the shipped desktop version policy", () => {
  it("is a policy the client will accept", () => {
    expect(parseVersionPolicy({ ...DESKTOP_VERSION_POLICY })).toEqual(DESKTOP_VERSION_POLICY);
  });

  it("states both versions in a form the comparison can read", () => {
    expect(compareVersions(DESKTOP_VERSION_POLICY.latest, "0.0.0")).not.toBeNull();
    expect(compareVersions(DESKTOP_VERSION_POLICY.minimum, "0.0.0")).not.toBeNull();
  });

  it("never sets a minimum above the newest build anyone can install", () => {
    // Inverted, this locks every user out with nothing to upgrade TO.
    expect(compareVersions(DESKTOP_VERSION_POLICY.minimum, DESKTOP_VERSION_POLICY.latest)).toBeLessThanOrEqual(0);
  });

  it("never announces a version that has not been built yet", () => {
    // `latest` above `tauri.conf.json`'s version means the server is telling
    // every user to go install something that does not exist. Bumping the
    // policy is the LAST step of a release, not the first.
    expect(compareVersions(DESKTOP_VERSION_POLICY.latest, bundledVersion())).toBeLessThanOrEqual(0);
  });

  it("leaves the newest build alone", () => {
    expect(evaluateUpdate(DESKTOP_VERSION_POLICY.latest, DESKTOP_VERSION_POLICY)).toEqual({
      status: "current",
    });
  });
});
