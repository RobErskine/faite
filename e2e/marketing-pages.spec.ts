import { test, expect } from "@playwright/test";
import { SITE_ORIGIN, SITE_PAGES, PRIVATE_ROUTES } from "../src/lib/site";
import { STORY_BEATS } from "../src/lib/story-beats";

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

/**
 * The CC-BY models are licensed to Faite *on condition* that they are
 * credited. The table-driven test above only checks this page's title and
 * description, so it would stay green if the credits themselves were deleted —
 * and the failure mode there is a license violation, not a cosmetic one.
 *
 * Keep this list in step with `assets/scene/CREDITS.md`. Anything CC-BY that
 * ships has to be named in both.
 */
test("the colophon credits every CC-BY creator by name", async ({ page }) => {
  await page.goto("/colophon");
  const main = page.getByRole("main");

  for (const creator of ["Kell Condon", "Jarlan Perez", "sirkitree", "Tiff Eidmann"]) {
    await expect(main).toContainText(creator);
  }
  // The license itself has to be named, not just the person.
  await expect(main).toContainText("CC BY");
  // Poly Pizza is the source the license points back to.
  await expect(main.getByRole("link", { name: "Poly Pizza" }).first()).toBeVisible();
});

test("the colophon is reachable from the footer", async ({ page }) => {
  // A credit nobody can navigate to does not satisfy CC-BY.
  await page.goto("/about");
  await page
    .getByRole("contentinfo")
    .getByRole("link", { name: "Colophon" })
    .click();
  await expect(page).toHaveURL(/\/colophon$/);
});

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

/**
 * React escapes `&`, `<`, `>`, `"` and `'` on the way into HTML, so a citation
 * like "Masicampo & Baumeister (2011)" is never in the response body verbatim.
 * The assertions below are about whether the server rendered the text at all,
 * not about its encoding, so they compare against the decoded body.
 */
const decode = (html: string) =>
  html
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'");

/**
 * The homepage hero is a picture of the board, and it has to arrive as HTML.
 *
 * `/` is the one page whose entire audience is a cold-cache first-time
 * visitor — `redirectIfKnownDevice` in `app/page.tsx` sends everyone who has
 * used the board before straight to `/board`, ahead of paint. So the hero is
 * checked against the raw response body, not the hydrated DOM: `toContain`
 * here is the assertion that `DemoBoard` is still a Server Component and still
 * costs the page nothing to display. Rendering it on the client would keep
 * every Playwright locator green and fail this line.
 *
 * "Plan living room move" is named specifically because it is the card the
 * scroll story carries into the room (EI-278) — the one string on the board
 * the rest of the page depends on.
 */
test("the homepage hero board is server-rendered HTML", async ({ page, request }) => {
  const body = decode(await (await request.get("/")).text());
  expect(body).toContain("Plan living room move");
  expect(body).toContain("Overflow");

  await page.goto("/");
  await expect(page.getByText("Plan living room move").first()).toBeVisible();
  // The pitch still outranks the picture: the heading is the LCP candidate,
  // and the board sits under it rather than in front of it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open the board/ }).first()).toBeVisible();
});

/**
 * The story is the middle movement of the homepage: the room on the left, the
 * card and the beats on the right (EI-275).
 *
 * Everything asserted here is checked against the raw response body as well as
 * the rendered page, for the same reason as the hero above — the copy, the
 * citations and the sub-tasks are server-rendered HTML, and three.js is fetched
 * only after first paint on a device that can use it. A refactor that made any
 * of this depend on the canvas would still pass a `toBeVisible()` check and
 * fail here.
 *
 * `STORY_BEATS` is imported rather than hard-coded so a beat added without copy
 * (or a citation quietly dropped) fails, the same table-driven shape as
 * `SITE_PAGES` above.
 */
test("the homepage story renders every beat, its citation, and its sub-task", async ({
  page,
  request,
}) => {
  const body = decode(await (await request.get("/")).text());

  for (const beat of STORY_BEATS) {
    expect(body).toContain(beat.headline);
    expect(body).toContain(beat.cite);
    // One sub-task per beat is the identity EI-278's ticks depend on.
    expect(body).toContain(beat.subtask);
  }

  await page.goto("/");
  const story = page.getByRole("region", { name: "How Faite works" });
  await expect(story.getByRole("heading", { name: STORY_BEATS[0].headline })).toBeVisible();
  // The panel starts at zero: nothing is done when the room is still bare.
  await expect(story.getByRole("group", { name: /0 of 5 done/ })).toBeVisible();
});

/**
 * `/spike-3d` was the EI-272 spike route. EI-275 deleted it along with its
 * `PRIVATE_ROUTES` entry, and `site.test.ts` enforces the parity — but nothing
 * enforced that the URL itself stops resolving, and a route left behind by a
 * half-done deletion would 200 with an unindexed copy of the story on it.
 */
test("the retired spike route is gone", async ({ request }) => {
  expect((await request.get("/spike-3d")).status()).toBe(404);
});

/**
 * The flat version is the real page.
 *
 * `RoomStage` starts with `enabled: false` and only turns the canvas on inside
 * a `requestAnimationFrame` after first paint, on a device that passes
 * `canUseWebGL()`. So the served HTML is always the flat page, and the flat
 * page is what a visitor keeps if they have reduced motion set, no WebGL, or
 * simply no JavaScript — one branch, three audiences.
 *
 * Turning JS off is how that branch is held still long enough to assert on. It
 * is also the strongest form of the claim: the beats, the citations and the
 * card owe nothing to the canvas, and the stage falls back to something that
 * says the same thing rather than to a spinner or an apology.
 *
 * Worth its own test because EI-275 rebuilt the stage's box — sticky at every
 * width now, with a nested tint layer inside it — and a fallback that
 * collapsed to zero height in the new container would be invisible in exactly
 * the configuration nobody develops in.
 *
 * NOT written with `reducedMotion: "reduce"`, which is the obvious spelling:
 * measured here, that option leaves
 * `matchMedia("(prefers-reduced-motion: reduce)").matches` reading `false` in
 * the page, so the canvas mounts anyway and the test passes or fails for
 * reasons unrelated to what it claims to check.
 */
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the story still tells itself without the canvas", async ({ page }) => {
    await page.goto("/");
    const story = page.getByRole("region", { name: "How Faite works" });

    for (const beat of STORY_BEATS) {
      await expect(story.getByRole("heading", { name: beat.headline })).toBeVisible();
      await expect(story.getByText(beat.subtask)).toBeVisible();
    }
    await expect(story.getByRole("group", { name: /0 of 5 done/ })).toBeVisible();

    // The static stage: three swatches and a sentence, not a spinner.
    await expect(story.getByText(/Three paint swatches/)).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    // And the hero and the closing CTA, which never depended on JS either.
    await expect(page.getByText("Plan living room move").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Open the board/ })).toHaveCount(2);
  });
});

/**
 * The page ends where it began: on the board, with the two ways in. Sign-up is
 * secondary on purpose — the board works with no account at all, so leading
 * with one would contradict the sentence above the buttons.
 */
test("the homepage closes on the board and the two ways in", async ({ page }) => {
  await page.goto("/");
  const closing = page.getByRole("heading", { name: "That is the whole idea." });
  await expect(closing).toBeVisible();

  await expect(page.getByRole("link", { name: /Open the board/ })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Create an account to sync" })).toHaveAttribute(
    "href",
    "/signup",
  );
});
