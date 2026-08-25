import { describe, expect, it } from "vitest";
import { mintToken, URL_TTL_MS, verifyToken, type TokenPayload } from "./signing";

const SECRET = "a-test-secret-of-quite-sufficient-length-for-hkdf";
const NOW = Date.parse("2026-08-25T12:00:00.000Z");

const payload = (over: Partial<TokenPayload> = {}): TokenPayload => ({
  userId: "user-1",
  attachmentId: "att-1",
  expiresAt: NOW + URL_TTL_MS,
  preview: false,
  ...over,
});

describe("mint / verify round trip", () => {
  it("accepts a token it just minted", async () => {
    const token = await mintToken(payload(), SECRET);
    const result = await verifyToken(token, SECRET, NOW);
    expect(result).toEqual({ ok: true, payload: payload() });
  });

  it("carries the preview flag, which decides inline vs attachment", async () => {
    const token = await mintToken(payload({ preview: true }), SECRET);
    const result = await verifyToken(token, SECRET, NOW);
    expect(result.ok && result.payload.preview).toBe(true);
  });

  it("produces one opaque path segment with no slashes or padding", async () => {
    const token = await mintToken(payload(), SECRET);
    expect(token).not.toMatch(/[/+=]/);
    expect(token.split(".")).toHaveLength(2);
  });
});

describe("forgery", () => {
  it("REFUSES a token signed with a different secret", async () => {
    const token = await mintToken(payload(), "some-other-secret-entirely-different");
    expect(await verifyToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("REFUSES a payload edited to point at another user's attachment", async () => {
    // The whole point. Swap the body for one naming a different user and
    // keep the original MAC — this must not authenticate.
    const token = await mintToken(payload(), SECRET);
    const forgedBody = btoa(JSON.stringify(payload({ userId: "victim" })))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const forged = `${forgedBody}.${token.split(".")[1]}`;
    expect(await verifyToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("REFUSES a token whose expiry was pushed out by hand", async () => {
    const token = await mintToken(payload({ expiresAt: NOW + 1000 }), SECRET);
    const forgedBody = btoa(JSON.stringify(payload({ expiresAt: NOW + 10 ** 12 })))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const forged = `${forgedBody}.${token.split(".")[1]}`;
    expect(await verifyToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("REFUSES a flipped bit in the signature", async () => {
    const token = await mintToken(payload(), SECRET);
    const [body, mac] = token.split(".");
    const flipped = mac[0] === "A" ? "B" + mac.slice(1) : "A" + mac.slice(1);
    expect(await verifyToken(`${body}.${flipped}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("REFUSES structurally broken input rather than throwing", async () => {
    for (const bad of ["", ".", "nodot", ".leading", "trailing.", "!!!.???"]) {
      const result = await verifyToken(bad, SECRET, NOW);
      expect(result.ok, `expected refusal for ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("expiry", () => {
  it("accepts right up to the deadline and refuses after it", async () => {
    const token = await mintToken(payload({ expiresAt: NOW + 1000 }), SECRET);
    expect((await verifyToken(token, SECRET, NOW + 999)).ok).toBe(true);
    expect(await verifyToken(token, SECRET, NOW + 1000)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyToken(token, SECRET, NOW + 5000)).toEqual({ ok: false, reason: "expired" });
  });

  it("keeps the window short — these URLs are not meant to be shareable", async () => {
    // A URL pasted into a chat should be dead before anyone opens it.
    expect(URL_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});
