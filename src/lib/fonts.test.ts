import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_PAIRING,
  FONT_PAIRING_IDS,
  normalizeFontPairing,
} from "./fonts";
import { settingsSchema } from "./schema";

describe("normalizeFontPairing", () => {
  it("passes a pairing this build ships through unchanged", () => {
    for (const id of FONT_PAIRING_IDS) {
      expect(normalizeFontPairing(id)).toBe(id);
    }
  });

  /*
    The V milestone removed Precision and Systematic. Rows synced from an
    older device still carry them, and a settings row that fails to parse
    takes the board down with it — so a removed id reads as the default.
  */
  it("maps a removed pairing to the default", () => {
    expect(normalizeFontPairing("precision")).toBe(DEFAULT_FONT_PAIRING);
    expect(normalizeFontPairing("systematic")).toBe(DEFAULT_FONT_PAIRING);
  });

  it("maps garbage and absence to the default", () => {
    expect(normalizeFontPairing(undefined)).toBe(DEFAULT_FONT_PAIRING);
    expect(normalizeFontPairing(null)).toBe(DEFAULT_FONT_PAIRING);
    expect(normalizeFontPairing(42)).toBe(DEFAULT_FONT_PAIRING);
    expect(normalizeFontPairing("comic-sans")).toBe(DEFAULT_FONT_PAIRING);
  });
});

describe("settingsSchema.fontPairing", () => {
  const base = { ownerId: "local-user", updatedAt: "2026-09-03T00:00:00.000Z" };

  it("defaults a missing value", () => {
    expect(settingsSchema.parse(base).fontPairing).toBe(DEFAULT_FONT_PAIRING);
  });

  it("keeps a supplied, shipping value", () => {
    expect(settingsSchema.parse({ ...base, fontPairing: "hyperlegible" }).fontPairing).toBe(
      "hyperlegible",
    );
  });

  it("does not fail the whole row on a removed pairing", () => {
    const parsed = settingsSchema.safeParse({ ...base, fontPairing: "precision" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("expected ok");
    expect(parsed.data.fontPairing).toBe(DEFAULT_FONT_PAIRING);
  });
});
