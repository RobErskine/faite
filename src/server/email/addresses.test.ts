import { describe, expect, it } from "vitest";
import {
  decideIngest,
  ingestAddress,
  localPartHash,
  newLocalPart,
  nextRateWindow,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  splitRecipient,
  type IngestAddressRow,
} from "./addresses";

const DOMAIN = "in.myfaite.app";
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);

function row(overrides: Partial<IngestAddressRow> = {}): IngestAddressRow {
  return {
    id: "addr-1",
    userId: "user-1",
    revokedAt: null,
    windowStart: null,
    windowCount: 0,
    ...overrides,
  };
}

describe("newLocalPart", () => {
  it("is 16 Crockford base32 characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(newLocalPart()).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
    }
  });

  it("omits the characters Crockford drops so it survives transcription", () => {
    const sample = Array.from({ length: 200 }, newLocalPart).join("");
    for (const banned of ["i", "l", "o", "u"]) {
      expect(sample).not.toContain(banned);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, newLocalPart));
    expect(seen.size).toBe(500);
  });
});

describe("splitRecipient", () => {
  it("returns the local part as the lookup key", () => {
    expect(splitRecipient(`k7m2x9qp4vw8n3rt@${DOMAIN}`, DOMAIN)).toEqual({
      key: "k7m2x9qp4vw8n3rt",
      tag: null,
    });
  });

  it("normalizes case — no mail client honours a case-sensitive local part", () => {
    expect(splitRecipient("K7M2X9QP4VW8N3RT@IN.MyFaite.App", DOMAIN)).toEqual({
      key: "k7m2x9qp4vw8n3rt",
      tag: null,
    });
  });

  it("strips a +tag for lookup but preserves it", () => {
    expect(splitRecipient(`k7m2x9qp4vw8n3rt+family@${DOMAIN}`, DOMAIN)).toEqual({
      key: "k7m2x9qp4vw8n3rt",
      tag: "family",
    });
  });

  it("keeps only the first + as the separator", () => {
    expect(splitRecipient(`abc+a+b@${DOMAIN}`, DOMAIN)?.tag).toBe("a+b");
  });

  it("treats a trailing bare + as no tag", () => {
    expect(splitRecipient(`abc+@${DOMAIN}`, DOMAIN)).toEqual({ key: "abc", tag: null });
  });

  it("rejects another domain — a catch-all only catches its own", () => {
    expect(splitRecipient("abc@myfaite.app", DOMAIN)).toBeNull();
    expect(splitRecipient("abc@evil.example", DOMAIN)).toBeNull();
  });

  it("rejects a local part that could not be one of ours", () => {
    expect(splitRecipient(`ab c@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(splitRecipient(`a'b@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(splitRecipient(`@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(splitRecipient(`+tag@${DOMAIN}`, DOMAIN)).toBeNull();
    expect(splitRecipient("not-an-address", DOMAIN)).toBeNull();
  });

  it("splits on the LAST @, so a quoted @ in the local part cannot smuggle a domain", () => {
    expect(splitRecipient(`abc@evil.example@${DOMAIN}`, DOMAIN)).toBeNull();
  });
});

describe("nextRateWindow", () => {
  it("opens a window on the first message", () => {
    expect(nextRateWindow({ windowStart: null, windowCount: 0 }, NOW)).toEqual({
      allowed: true,
      next: { windowStart: NOW, windowCount: 1 },
    });
  });

  it("counts up inside the window", () => {
    expect(nextRateWindow({ windowStart: NOW, windowCount: 5 }, NOW + 60_000)).toEqual({
      allowed: true,
      next: { windowStart: NOW, windowCount: 6 },
    });
  });

  it("rejects at the cap", () => {
    const result = nextRateWindow({ windowStart: NOW, windowCount: RATE_LIMIT }, NOW + 1000);
    expect(result.allowed).toBe(false);
  });

  it("does not let a rejected message extend its own lockout", () => {
    const over = { windowStart: NOW, windowCount: RATE_LIMIT };
    expect(nextRateWindow(over, NOW + 1000).next).toEqual(over);
  });

  it("rolls over once the window has fully elapsed", () => {
    expect(
      nextRateWindow({ windowStart: NOW, windowCount: RATE_LIMIT }, NOW + RATE_WINDOW_MS),
    ).toEqual({ allowed: true, next: { windowStart: NOW + RATE_WINDOW_MS, windowCount: 1 } });
  });

  it("does not roll over one millisecond early", () => {
    expect(
      nextRateWindow({ windowStart: NOW, windowCount: RATE_LIMIT }, NOW + RATE_WINDOW_MS - 1)
        .allowed,
    ).toBe(false);
  });
});

describe("decideIngest", () => {
  it("rejects an address that never existed", () => {
    expect(decideIngest(null, NOW)).toEqual({ ok: false, reason: "unknown-address" });
  });

  it("rejects a revoked address — a burned one must never come back", () => {
    expect(decideIngest(row({ revokedAt: new Date(NOW - 1000) }), NOW)).toEqual({
      ok: false,
      reason: "revoked-address",
    });
  });

  it("rejects over the rate cap", () => {
    expect(
      decideIngest(row({ windowStart: NOW, windowCount: RATE_LIMIT }), NOW + 1000),
    ).toEqual({ ok: false, reason: "rate-limited" });
  });

  it("resolves a live address to its user and the window to commit", () => {
    expect(decideIngest(row(), NOW)).toEqual({
      ok: true,
      addressId: "addr-1",
      userId: "user-1",
      next: { windowStart: NOW, windowCount: 1 },
    });
  });

  it("checks revocation BEFORE the rate window, so a burned address never reveals its usage", () => {
    const burnedAndOverCap = row({
      revokedAt: new Date(NOW - 1000),
      windowStart: NOW,
      windowCount: RATE_LIMIT,
    });
    expect(decideIngest(burnedAndOverCap, NOW).ok).toBe(false);
    expect(decideIngest(burnedAndOverCap, NOW)).toMatchObject({ reason: "revoked-address" });
  });
});

describe("localPartHash", () => {
  it("is stable and does not contain the secret", async () => {
    const key = "k7m2x9qp4vw8n3rt";
    const hash = await localPartHash(key);
    expect(hash).toBe(await localPartHash(key));
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hash).not.toContain(key);
  });

  it("differs between addresses, so two log lines can be told apart", async () => {
    expect(await localPartHash("aaaa")).not.toBe(await localPartHash("bbbb"));
  });
});

describe("ingestAddress", () => {
  it("joins the local part to the configured domain", () => {
    expect(ingestAddress("abc", DOMAIN)).toBe(`abc@${DOMAIN}`);
  });
});
