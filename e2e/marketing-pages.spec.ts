import { test, expect } from "@playwright/test";
import { SITE_ORIGIN, SITE_PAGES, PRIVATE_ROUTES } from "../src/lib/site";

/**
 * Every static marketing/legal/support page, table-driven off `SITE_PAGES` —
 * the same source of truth `sitemap.ts`, `MarketingFooter`, and
 * `PageShell`/`pageMetadata()` all read. A page added to that table without
 * a passing assertion here fails loudly; a page removed from it without
 * removing the route fails the `site.test.ts` parity check first (a faster,
 * non-Playwright signal for the same class of drift).
 *
 * Deliberately NOT importing `./support/fixtures`, same reasoning as
 * `foundations.spec.ts`: these are static pages with no seeded store, no
 * frozen clock, and nothing to dismiss.
 *
 * Relative import of `../src/lib/site`, not the `@/` alias — no existing
 * spec imports from `src/`, so the alias's resolution under Playwright's own
 * tsconfig is unproven; a relative specifier needs nothing from it.
 */

for (const page_ of SITE_PAGES) {
  test(`${page_.path} renders with the right title, description, canonical, and footer`, async ({
    page,
  }) => {
    const response = await page.goto(page_.path);
    expect(response?.status()).toBe(200);

    // `title: null` (only "/") keeps the root layout's bare default — the
    // regression this guards is the "%s · Faite" template turning it into
    // "Faite · Faite".
    await expect(page).toHaveTitle(page_.title === null ? "Faite" : `${page_.title} · Faite`);

    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      page_.description,
    );

    // Canonical/og:url resolve against `metadataBase`, so the expected value
    // is always the production origin regardless of which host actually
    // served this test run. Next collapses "/" to the bare origin with no
    // trailing slash when resolving `alternates.canonical` — confirmed
    // against the real rendered page, not assumed — so "/" is the one path
    // that does NOT get concatenated onto SITE_ORIGIN literally.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      page_.path === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${page_.path}`,
    );

    // The one assertion that specifically catches Next's "openGraph is
    // replaced wholesale, not merged" trap (EI-198/EI-199): a page that set
    // only a partial `openGraph` object would ship without this tag.
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
      "content",
      "Faite",
    );

    await expect(page.getByRole("contentinfo")).toBeVisible();

    if (page_.title !== null) {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(page_.title);
    }
  });
}

test("the legal placeholder notice renders on /privacy and /terms", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("note")).toContainText("Placeholder draft");

  await page.goto("/terms");
  await expect(page.getByRole("note")).toContainText("Placeholder draft");
});

test("sitemap.xml lists every SITE_PAGES path and none of PRIVATE_ROUTES", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("xml");

  const xml = await res.text();
  for (const page_ of SITE_PAGES) {
    expect(xml).toContain(`<loc>${SITE_ORIGIN}${page_.path}</loc>`);
  }
  for (const route of PRIVATE_ROUTES) {
    expect(xml).not.toContain(`<loc>${SITE_ORIGIN}${route}</loc>`);
  }
});

test("robots.txt disallows every PRIVATE_ROUTES entry and names the sitemap", async ({
  request,
}) => {
  const res = await request.get("/robots.txt");
  expect(res.ok()).toBe(true);

  const txt = await res.text();
  for (const route of PRIVATE_ROUTES) {
    expect(txt).toContain(`Disallow: ${route}`);
  }
  expect(txt).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  expect(txt).toContain(`Host: ${SITE_ORIGIN}`);
});

test("an unknown route 404s with site chrome, not the bare Next error page", async ({ page }) => {
  const response = await page.goto("/definitely-not-a-route");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
});
