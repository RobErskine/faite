import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVATE_ROUTES, SITE_ORIGIN, SITE_PAGES, sitePage } from "./site";

const APP_DIR = new URL("../app", import.meta.url).pathname;

/**
 * Every route reachable under `src/app`. Flat only — the app has no route
 * groups or nested segments today (`docs/ARCHITECTURE.md` §4), and this test
 * asserts that stays true rather than silently under-reporting if it changes.
 */
function routesOnDisk(): string[] {
  const routes: string[] = [];
  if (existsSync(join(APP_DIR, "page.tsx"))) routes.push("/");
  for (const entry of readdirSync(APP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    expect(
      entry.name.startsWith("(") || entry.name.startsWith("@") || entry.name.startsWith("["),
      `"${entry.name}" is a route group / slot / dynamic segment. This scanner ` +
        `only understands flat routes — teach it, or the sitemap parity check ` +
        `below silently stops covering that subtree.`,
    ).toBe(false);
    if (existsSync(join(APP_DIR, entry.name, "page.tsx"))) routes.push(`/${entry.name}`);
  }
  return routes.sort();
}

describe("the site route table", () => {
  it("accounts for every route in src/app", () => {
    const declared = [...SITE_PAGES.map((p) => p.path), ...PRIVATE_ROUTES].sort();
    // Fails BOTH ways on purpose: a new page with no SITE_PAGES row (invisible
    // to crawlers and to the footer) and a table row whose page was deleted
    // (a sitemap entry that 404s).
    expect(routesOnDisk()).toEqual(declared);
  });

  it("has no route in both the public and private lists", () => {
    for (const p of SITE_PAGES) expect(PRIVATE_ROUTES).not.toContain(p.path);
  });

  it("has unique paths", () => {
    const paths = SITE_PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("dates every page with a plain ISO day", () => {
    for (const p of SITE_PAGES) expect(p.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps the origin free of a trailing slash", () => {
    // `new URL(SITE_ORIGIN)` is metadataBase; a trailing slash there makes
    // every relative canonical resolve one segment short.
    expect(SITE_ORIGIN.endsWith("/")).toBe(false);
    expect(SITE_ORIGIN).toBe("https://myfaite.app"); // pinned against wrangler.jsonc
  });

  it("throws on an unknown path rather than returning undefined", () => {
    expect(() => sitePage("/nope")).toThrow();
  });
});
