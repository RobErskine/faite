import { describe, expect, it } from "vitest";
import { DESKTOP_KEY_NAME, DESKTOP_KEY_PERMISSIONS, keyGrantsScope, scopeGranted } from "./auth-scopes";

/**
 * `scopeGranted` is the one function standing between a narrow,
 * user-generated API key (A3) and full account access — a bug here is a
 * real vulnerability, not a cosmetic bug, so every scope this ticket's
 * "Done when" list names gets a direct assertion, not just a happy path.
 */
describe("scopeGranted", () => {
  it("grants a scope the key's permissions explicitly list", () => {
    expect(scopeGranted({ api: ["read"] }, "read")).toBe(true);
  });

  it("denies a scope the key's permissions do not list — the narrow-key case", () => {
    expect(scopeGranted({ api: ["read"] }, "sync")).toBe(false);
    expect(scopeGranted({ api: ["read"] }, "places")).toBe(false);
    expect(scopeGranted({ api: ["read"] }, "write")).toBe(false);
  });

  it("denies every scope when permissions are null or undefined", () => {
    expect(scopeGranted(null, "read")).toBe(false);
    expect(scopeGranted(undefined, "read")).toBe(false);
  });

  it("denies every scope when the api resource is present but empty", () => {
    expect(scopeGranted({ api: [] }, "read")).toBe(false);
  });

  it("denies every scope when permissions name a different resource entirely", () => {
    expect(scopeGranted({ somethingElse: ["read"] }, "read")).toBe(false);
  });

  it("DESKTOP_KEY_PERMISSIONS grants every scope this ticket gates — no regression", () => {
    for (const scope of ["read", "write", "sync", "places"] as const) {
      expect(scopeGranted(DESKTOP_KEY_PERMISSIONS, scope)).toBe(true);
    }
  });

  it("the default narrow permission set (api: [\"read\"]) grants read but nothing else", () => {
    const defaultPermissions = { api: ["read"] };
    expect(scopeGranted(defaultPermissions, "read")).toBe(true);
    expect(scopeGranted(defaultPermissions, "sync")).toBe(false);
    expect(scopeGranted(defaultPermissions, "places")).toBe(false);
  });
});

describe("keyGrantsScope", () => {
  it("a narrow user key with no desktop name is gated purely by its permissions", () => {
    const key = { name: "my personal key", permissions: { api: ["read"] } };
    expect(keyGrantsScope(key, "read")).toBe(true);
    expect(keyGrantsScope(key, "sync")).toBe(false);
  });

  it("REGRESSION: a pre-A2 desktop key (name matches, but permissions are still the old narrow default) is granted every scope anyway", () => {
    // Exactly the shape of a key minted by /api/desktop/handoff BEFORE this
    // ticket started passing DESKTOP_KEY_PERMISSIONS at creation time — it
    // only ever got the plugin's global `defaultPermissions`. Without the
    // name fallback, this key would 403 on /api/sync/* the moment A2
    // deployed, which is exactly the "desktop shell still signs in and
    // syncs" regression the ticket names as the primary risk.
    const preA2DesktopKey = { name: DESKTOP_KEY_NAME, permissions: { api: ["read"] } };
    for (const scope of ["read", "write", "sync", "places"] as const) {
      expect(keyGrantsScope(preA2DesktopKey, scope)).toBe(true);
    }
  });

  it("a desktop-named key with null permissions is still granted every scope", () => {
    const key = { name: DESKTOP_KEY_NAME, permissions: null };
    expect(keyGrantsScope(key, "sync")).toBe(true);
  });
});
