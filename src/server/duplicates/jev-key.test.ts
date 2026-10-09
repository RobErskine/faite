import { describe, expect, it } from "vitest";
import { decryptJevKey, encryptJevKey } from "./jev-key";

const SECRET = "a-test-secret-that-is-long-enough";

describe("jev key encryption", () => {
  it("round-trips and keeps only the last four characters in the clear", async () => {
    const stored = await encryptJevKey("ts_live_abcdef1234", SECRET);
    expect(stored.last4).toBe("1234");
    expect(new TextDecoder().decode(stored.ciphertext)).not.toContain("abcdef");
    expect(await decryptJevKey(stored, SECRET)).toBe("ts_live_abcdef1234");
  });

  it("returns null under a different secret instead of throwing", async () => {
    const stored = await encryptJevKey("ts_live_abcdef1234", SECRET);
    expect(await decryptJevKey(stored, "a-rotated-secret")).toBeNull();
  });
});
