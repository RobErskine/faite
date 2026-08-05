import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_MODE,
  THEME_MODE_IDS,
  THEME_MODES,
  normalizeTheme,
  resolveTheme,
} from "./theme";

describe("resolveTheme", () => {
  it("follows the OS when the mode is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets an explicit choice override the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("normalizeTheme", () => {
  it("falls back to the default for a legacy row with no theme key", () => {
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME_MODE);
  });

  it("falls back to the default for an unrecognized value", () => {
    expect(normalizeTheme("solarized")).toBe(DEFAULT_THEME_MODE);
  });

  it("passes through a recognized value", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("system")).toBe("system");
  });
});

describe("THEME_MODE_IDS", () => {
  it("has the same members as THEME_MODES, in order", () => {
    expect(THEME_MODE_IDS).toEqual(THEME_MODES.map((t) => t.id));
  });
});
