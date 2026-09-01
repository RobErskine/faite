import { describe, expect, it } from "vitest";
import { DESKTOP_KEY_NAME, DESKTOP_KEY_PERMISSIONS, scopeGranted } from "./auth-scopes";

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

  it("EI-259: the 'read-write' user-key config (api: [\"read\", \"write\"]) grants both, but never sync/places", () => {
    const readWritePermissions = { api: ["read", "write"] };
    expect(scopeGranted(readWritePermissions, "read")).toBe(true);
    expect(scopeGranted(readWritePermissions, "write")).toBe(true);
    expect(scopeGranted(readWritePermissions, "sync")).toBe(false);
    expect(scopeGranted(readWritePermissions, "places")).toBe(false);
  });
});

/**
 * SECURITY (EI-261): `scopeGranted` used to have a `keyGrantsScope` wrapper
 * that also granted every scope to any key named exactly `DESKTOP_KEY_NAME`
 * — removed because `name` turned out to be fully client-settable (see the
 * SECURITY note on `scopeGranted` in `auth-scopes.ts`). These pin that the
 * name is now inert: a key named `DESKTOP_KEY_NAME` with narrow permissions
 * gets exactly what its `permissions` say, nothing more — the two concrete
 * exploits (`apiKey.create({ name: "Faite desktop" })` and
 * `apiKey.update({ ..., name: "Faite desktop" })`) both collapse to this
 * shape, so proving it here proves both are closed.
 */
describe("scopeGranted ignores name entirely (EI-261 regression)", () => {
  it("a key named exactly DESKTOP_KEY_NAME with only read gets only read", () => {
    // Would have been the direct `apiKey.create({ name: DESKTOP_KEY_NAME })`
    // exploit: mint a brand-new key with the desktop name and the plugin's
    // ordinary narrow default permissions.
    expect(DESKTOP_KEY_NAME).toBe("Faite desktop");
    expect(scopeGranted({ api: ["read"] }, "read")).toBe(true);
    for (const scope of ["write", "sync", "places"] as const) {
      expect(scopeGranted({ api: ["read"] }, scope)).toBe(false);
    }
  });

  it("null permissions grant nothing, regardless of what the key is named", () => {
    // Would have been the fallback's most permissive case — a desktop-named
    // key with no permissions row at all still got full access before.
    expect(scopeGranted(null, "sync")).toBe(false);
  });

  it("DESKTOP_KEY_PERMISSIONS still grants full access on its own merits — not because of the name", () => {
    for (const scope of ["read", "write", "sync", "places"] as const) {
      expect(scopeGranted(DESKTOP_KEY_PERMISSIONS, scope)).toBe(true);
    }
  });
});
