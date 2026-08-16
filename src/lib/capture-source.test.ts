import { describe, expect, it } from "vitest";
import {
  CAPTURE_SOURCE_MAX_BYTES,
  parseSource,
  serializeSource,
  type CapturedSource,
} from "./capture-source";

const source = (overrides: Partial<CapturedSource> = {}): CapturedSource => ({
  v: 1,
  kind: "browser",
  at: "2026-08-16T12:00:00.000Z",
  ...overrides,
});

describe("parseSource / serializeSource — round-trip", () => {
  it("round-trips a minimal blob (only the required fields)", () => {
    const s = source();
    expect(parseSource(serializeSource(s))).toEqual(s);
  });

  it("round-trips a full blob with every optional field populated", () => {
    const s = source({
      app: { name: "Safari", bundleId: "com.apple.Safari" },
      window: { title: "Example Domain" },
      url: "https://example.com/path?query=1",
      pageTitle: "Example Domain",
      document: { path: "/Users/rob/Desktop/notes.txt" },
      grants: { accessibility: true, automation: false },
    });
    expect(parseSource(serializeSource(s))).toEqual(s);
  });

  it("returns null for a null input", () => {
    expect(parseSource(null)).toBeNull();
  });
});

describe("parseSource — never throws on garbage", () => {
  it("returns null for unparseable JSON", () => {
    expect(parseSource("not json{{{")).toBeNull();
  });

  it("returns null for valid JSON that isn't an object", () => {
    expect(parseSource("42")).toBeNull();
    expect(parseSource('"just a string"')).toBeNull();
    expect(parseSource("null")).toBeNull();
    expect(parseSource("[]")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseSource(JSON.stringify({ kind: "browser" }))).toBeNull();
    expect(parseSource(JSON.stringify({ v: 1, at: "2026-01-01T00:00:00.000Z" }))).toBeNull();
  });

  it("returns null for an unrecognized schema version — forward-compat, never crashes", () => {
    expect(
      parseSource(JSON.stringify({ v: 2, kind: "browser", at: "2026-01-01T00:00:00.000Z" })),
    ).toBeNull();
  });

  it("returns null for a wrong-typed field rather than coercing", () => {
    expect(parseSource(JSON.stringify({ v: 1, kind: "browser", at: 12345 }))).toBeNull();
  });

  it("does not throw on empty string, prototype-pollution attempts, or deeply malformed input", () => {
    expect(() => parseSource("")).not.toThrow();
    expect(parseSource("")).toBeNull();
    expect(() => parseSource('{"__proto__":{"polluted":true}}')).not.toThrow();
    expect(() => parseSource("{")).not.toThrow();
  });
});

describe("parseSource — forward-compat kind", () => {
  it("parses a `kind` this build has never seen, since kind is a free string", () => {
    const raw = JSON.stringify({
      v: 1,
      kind: "future-share-sheet",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(parseSource(raw)).toEqual({
      v: 1,
      kind: "future-share-sheet",
      at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("serializeSource — size cap", () => {
  it("stays under the byte budget for an ordinary blob", () => {
    const s = source({
      app: { name: "Safari" },
      window: { title: "A normal window title" },
      url: "https://example.com/",
      pageTitle: "A normal page title",
    });
    const json = serializeSource(s);
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(CAPTURE_SOURCE_MAX_BYTES);
  });

  it("truncates an oversized window.title/pageTitle to stay within budget, and stays parseable", () => {
    const s = source({
      window: { title: "x".repeat(5000) },
      pageTitle: "y".repeat(5000),
      url: "https://example.com/",
    });
    const json = serializeSource(s);
    const bytes = new TextEncoder().encode(json).length;

    expect(bytes).toBeLessThanOrEqual(CAPTURE_SOURCE_MAX_BYTES);
    expect(json.length).toBeLessThan(JSON.stringify(s).length);

    const parsed = parseSource(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.v).toBe(1);
    expect(parsed!.kind).toBe("browser");
    expect(parsed!.at).toBe(s.at);
    // Both truncated fields shrank, not just one.
    expect((parsed!.window?.title ?? "").length).toBeLessThan(5000);
    expect((parsed!.pageTitle ?? "").length).toBeLessThan(5000);
  });

  it("drops window.title/pageTitle entirely rather than exceed budget when nothing else can shrink", () => {
    const s = source({
      window: { title: "x".repeat(10_000) },
      pageTitle: "y".repeat(10_000),
      url: "z".repeat(10_000),
    });
    const json = serializeSource(s);
    const bytes = new TextEncoder().encode(json).length;
    expect(bytes).toBeLessThanOrEqual(CAPTURE_SOURCE_MAX_BYTES + s.url!.length);
    // The core, non-truncatable fields always survive.
    const parsed = parseSource(json);
    expect(parsed?.v).toBe(1);
    expect(parsed?.kind).toBe("browser");
  });

  it("handles multi-byte characters without splitting a codepoint", () => {
    const s = source({ window: { title: "🎉".repeat(2000) } });
    const json = serializeSource(s);
    // Must still be valid JSON/UTF-8 — a split surrogate pair would corrupt it.
    expect(() => JSON.parse(json)).not.toThrow();
    const bytes = new TextEncoder().encode(json).length;
    expect(bytes).toBeLessThanOrEqual(CAPTURE_SOURCE_MAX_BYTES);
  });
});
