import { describe, expect, it } from "vitest";
import { DEFAULT_KEY_EXPIRES_IN_SECONDS, USER_KEY_PERMISSIONS } from "./auth-tokens";

/**
 * `apiTokenPlugin` itself doesn't expose the configuration array it was
 * built from — `apiKey(...)` closes over it — so these pin the two
 * constants `auth-tokens.ts` actually uses to build it, rather than
 * reaching into the plugin's internals.
 */
describe("DEFAULT_KEY_EXPIRES_IN_SECONDS", () => {
  it("is 90 days in SECONDS (EI-260) — the plugin reads this field as seconds, not milliseconds", () => {
    // Regression pin: `1000 * 60 * 60 * 24 * 90` (milliseconds) was passed
    // here before EI-260 and, read as seconds by the plugin, produced a
    // ~246-year expiry.
    expect(DEFAULT_KEY_EXPIRES_IN_SECONDS).toBe(7_776_000);
  });
});

describe("USER_KEY_PERMISSIONS", () => {
  it("has exactly the two configIds the plugin's array uses: default and read-write", () => {
    expect(Object.keys(USER_KEY_PERMISSIONS).sort()).toEqual(["default", "read-write"]);
  });

  it("default is read-only", () => {
    expect(USER_KEY_PERMISSIONS.default).toEqual({ api: ["read"] });
  });

  it("read-write grants read and write, and nothing else", () => {
    expect(USER_KEY_PERMISSIONS["read-write"]).toEqual({ api: ["read", "write"] });
  });

  it("neither user-key permission set ever includes sync or places (EI-227 boundary)", () => {
    for (const permissions of Object.values(USER_KEY_PERMISSIONS)) {
      expect(permissions.api).not.toContain("sync");
      expect(permissions.api).not.toContain("places");
    }
  });
});
