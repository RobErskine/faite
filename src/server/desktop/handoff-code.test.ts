import { describe, expect, it } from "vitest";
import { decodeHandoffCode, encodeHandoffCode } from "./handoff-code";

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
