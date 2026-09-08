import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KEY_EXPIRES_IN_SECONDS } from "@/server/auth-tokens";
import {
  DEFAULT_EXPIRY_OPTION,
  mintApiKey,
  EXPIRY_OPTIONS,
  expiryOptionSeconds,
  type ExpiryOption,
} from "./api-key-expiry";

/**
 * These pin UNITS, which is the whole reason this module is separate from the
 * plugin config. EI-260 shipped keys expiring in the year 2273 because
 * `defaultExpiresIn` was written in milliseconds against a plugin that reads
 * seconds, and nothing caught it: `maxExpiresIn` only validates a
 * CALLER-supplied value, never the default.
 */
describe("expiryOptionSeconds", () => {
  it("returns SECONDS, not milliseconds or days", () => {
    expect(expiryOptionSeconds("7d")).toBe(604_800);
    expect(expiryOptionSeconds("30d")).toBe(2_592_000);
    expect(expiryOptionSeconds("365d")).toBe(31_536_000);
  });

  it("null means never — and is NOT a value to hand to createApiKey", () => {
    // `createApiKey({ expiresIn: null })` falls back to `defaultExpiresIn`.
    // Only `updateApiKey` clears the expiry. See the module doc comment.
    expect(expiryOptionSeconds("never")).toBeNull();
  });

  it("the default option matches the plugin's own default, so picking nothing changes nothing", () => {
    expect(expiryOptionSeconds(DEFAULT_EXPIRY_OPTION)).toBe(DEFAULT_KEY_EXPIRES_IN_SECONDS);
  });

  /**
   * `createApiKey` validates in DAYS (`expiresIn / (3600 * 24)`) while the
   * value itself is seconds. An option above `maxExpiresIn` would be rejected
   * by the server after the user picked it.
   */
  it("no finite option exceeds the plugin's 365-day ceiling", () => {
    for (const { value } of EXPIRY_OPTIONS) {
      const seconds = expiryOptionSeconds(value);
      if (seconds === null) continue;
      expect(seconds / (3600 * 24)).toBeLessThanOrEqual(365);
      expect(seconds / (3600 * 24)).toBeGreaterThanOrEqual(1);
    }
  });

  it("covers every option in the dropdown, with no unreachable cases", () => {
    const declared = EXPIRY_OPTIONS.map((o) => o.value).sort();
    const expected: ExpiryOption[] = ["30d", "365d", "7d", "90d", "never"];
    expect(declared).toEqual(expected.sort());
  });
});

/**
 * A19 (EI-299). The interesting behavior is the two-call dance for "never",
 * and specifically the second call failing — the key EXISTS and works at
 * that point, so reporting a failure would make the user mint a duplicate.
 *
 * Tested here rather than through the component because driving a Base UI
 * Select popover in happy-dom proves nothing about this logic and breaks on
 * pointer APIs the environment does not implement.
 */
describe("mintApiKey", () => {
  const ok = { data: { id: "key-9", key: "faite_secret" }, error: null };

  it("sends an explicit expiresIn in SECONDS for a finite option", async () => {
    const create = vi.fn().mockResolvedValue(ok);
    const update = vi.fn();

    await mintApiKey({ create, update }, { name: "k", configId: "default", expiry: "30d" });

    expect(create).toHaveBeenCalledWith({ name: "k", configId: "default", expiresIn: 2_592_000 });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION. `createApiKey({ expiresIn: null })` treats null as
   * "unspecified" and falls back to `defaultExpiresIn` (90 days) — so
   * PASSING null is how you silently get a 90-day key while believing you
   * asked for a permanent one. It must be omitted, then cleared.
   */
  it("OMITS expiresIn for never, then clears it with update", async () => {
    const create = vi.fn().mockResolvedValue(ok);
    const update = vi.fn().mockResolvedValue({ error: null });

    const result = await mintApiKey(
      { create, update },
      { name: "k", configId: "default", expiry: "never" },
    );

    expect(create).toHaveBeenCalledWith({ name: "k", configId: "default" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("expiresIn");
    expect(update).toHaveBeenCalledWith({
      keyId: "key-9",
      configId: "default",
      expiresIn: null,
    });
    expect(result).toEqual({ ok: true, key: "faite_secret", expiryWarning: false });
  });

  it("flags a warning — not a failure — when clearing the expiry fails", async () => {
    const create = vi.fn().mockResolvedValue(ok);
    const update = vi.fn().mockResolvedValue({ error: { message: "nope" } });

    const result = await mintApiKey(
      { create, update },
      { name: "k", configId: "default", expiry: "never" },
    );

    // The key is real and usable; only its expiry is wrong.
    expect(result).toEqual({ ok: true, key: "faite_secret", expiryWarning: true });
  });

  it("reports a real create failure, and never calls update", async () => {
    const create = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    const update = vi.fn();

    const result = await mintApiKey(
      { create, update },
      { name: "k", configId: "default", expiry: "never" },
    );

    expect(result).toEqual({ ok: false, message: "boom" });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION, found by a live run and invisible to a mock.
   *
   * `updateApiKey` resolves a configuration from the request's `configId`,
   * defaulting to `"default"`, then rejects the key if
   * `configIdMatches(apiKey.configId, lookupOpts.configId)` fails. Omitting
   * it therefore 404s every `read-write` key — the exact scope a real
   * integration asks for — so "never" silently produced a 90-day key and a
   * warning toast, for every user who ticked Write.
   */
  it("passes the key's OWN configId to update, or a read-write key 404s", async () => {
    const create = vi.fn().mockResolvedValue(ok);
    const update = vi.fn().mockResolvedValue({ error: null });

    await mintApiKey(
      { create, update },
      { name: "k", configId: "read-write", expiry: "never" },
    );

    expect(update).toHaveBeenCalledWith({
      keyId: "key-9",
      configId: "read-write",
      expiresIn: null,
    });
  });
});
