import { describe, expect, it } from "vitest";
import {
  decodeHandoffCode,
  DESKTOP_HANDOFF_INFO,
  encodeHandoffCode,
  RAYCAST_HANDOFF_INFO,
} from "./handoff-code";

const SECRET = "test-secret-do-not-use-in-prod";
const OTHER_SECRET = "a-different-secret";

describe("handoff code round trip", () => {
  it("decodes back to the original key", async () => {
    const code = await encodeHandoffCode("faite_abc123", SECRET);
    expect(await decodeHandoffCode(code, SECRET)).toBe("faite_abc123");
  });

  it("produces a different code on every call (fresh IV)", async () => {
    const a = await encodeHandoffCode("faite_abc123", SECRET);
    const b = await encodeHandoffCode("faite_abc123", SECRET);
    expect(a).not.toBe(b);
  });

  it("rejects a code decoded with the wrong secret", async () => {
    const code = await encodeHandoffCode("faite_abc123", SECRET);
    expect(await decodeHandoffCode(code, OTHER_SECRET)).toBeNull();
  });

  it("rejects a tampered code (GCM auth tag fails)", async () => {
    const code = await encodeHandoffCode("faite_abc123", SECRET);
    // Flip a character in the middle of the string, not the last one — the
    // tail of a base64url string can encode unused padding bits, so
    // mutating it doesn't reliably change the decoded bytes.
    const mid = Math.floor(code.length / 2);
    const flipped = code.slice(0, mid) + (code[mid] === "A" ? "B" : "A") + code.slice(mid + 1);
    expect(await decodeHandoffCode(flipped, SECRET)).toBeNull();
  });

  it("rejects malformed base64url", async () => {
    expect(await decodeHandoffCode("not valid base64!!!", SECRET)).toBeNull();
  });

  it("rejects an empty string", async () => {
    expect(await decodeHandoffCode("", SECRET)).toBeNull();
  });

  it("rejects an expired code", async () => {
    const code = await encodeHandoffCode("faite_abc123", SECRET);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 61_000;
      expect(await decodeHandoffCode(code, SECRET)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("accepts a code just under the TTL", async () => {
    const code = await encodeHandoffCode("faite_abc123", SECRET);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 59_000;
      expect(await decodeHandoffCode(code, SECRET)).toBe("faite_abc123");
    } finally {
      Date.now = realNow;
    }
  });
});

/**
 * A18 (EI-298). The HKDF `info` string is a DOMAIN SEPARATOR, and these are
 * the tests that make it one.
 *
 * The flows hand out DIFFERENT scopes — desktop gets `sync` and `places`,
 * Raycast deliberately gets neither — so if one flow's code decoded at the
 * other's `/exchange`, a narrower grant would be redeemable for a wider one.
 * That is a privilege escalation, not a cosmetic mix-up.
 */
describe("domain separation between handoff flows", () => {
  it("a desktop code does NOT decode with the Raycast separator", async () => {
    const code = await encodeHandoffCode("faite_desktop_key", SECRET, DESKTOP_HANDOFF_INFO);

    expect(await decodeHandoffCode(code, SECRET, RAYCAST_HANDOFF_INFO)).toBeNull();
  });

  it("a Raycast code does NOT decode with the desktop separator", async () => {
    const code = await encodeHandoffCode("faite_raycast_key", SECRET, RAYCAST_HANDOFF_INFO);

    expect(await decodeHandoffCode(code, SECRET, DESKTOP_HANDOFF_INFO)).toBeNull();
  });

  it("each still round-trips under its own separator", async () => {
    const desktop = await encodeHandoffCode("faite_d", SECRET, DESKTOP_HANDOFF_INFO);
    const raycast = await encodeHandoffCode("faite_r", SECRET, RAYCAST_HANDOFF_INFO);

    expect(await decodeHandoffCode(desktop, SECRET, DESKTOP_HANDOFF_INFO)).toBe("faite_d");
    expect(await decodeHandoffCode(raycast, SECRET, RAYCAST_HANDOFF_INFO)).toBe("faite_r");
  });

  /** The default keeps every pre-A18 call site working unchanged — a code in
   * flight when this shipped must still decode. */
  it("defaults to the desktop separator on both sides", async () => {
    const code = await encodeHandoffCode("faite_legacy", SECRET);

    expect(await decodeHandoffCode(code, SECRET)).toBe("faite_legacy");
    expect(await decodeHandoffCode(code, SECRET, DESKTOP_HANDOFF_INFO)).toBe("faite_legacy");
  });

  it("the two separators are actually different strings", async () => {
    // A rename that accidentally collapsed them would make every test above
    // pass while silently removing the separation.
    expect(DESKTOP_HANDOFF_INFO).not.toBe(RAYCAST_HANDOFF_INFO);
  });
});
