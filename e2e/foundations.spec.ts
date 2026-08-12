import { test, expect } from "@playwright/test";

/**
 * P0 of the mobile plan (docs/MOBILE.md) — the page-level plumbing every
 * later phase depends on: the viewport meta tag and the PWA manifest.
 *
 * Deliberately NOT using `./support/fixtures`: these assertions are about
 * `<head>` and a sibling static route, not the board, so there's no reason
 * to pay for a seeded store, a frozen clock, or dismissing `WelcomeDialog`.
 *
 * `useViewport()`'s `?layout=` override has no E2E coverage here — nothing
 * in the UI consumes the hook yet (P0 ships it unwired on purpose; P3 wires
 * it into an actual layout branch). Its behavior is fully covered by
 * `src/lib/use-viewport.test.ts` in the meantime; add an E2E assertion once
 * there's a real DOM effect to observe.
 */

test("the viewport meta tag enables safe-area insets and keyboard-aware sizing", async ({
  page,
}) => {
  await page.goto("/");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content).toContain("viewport-fit=cover");
  expect(content).toContain("interactive-widget=resizes-content");
});

test("the manifest is linked and resolves to a valid, installable PWA manifest", async ({
  page,
}) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();

  const response = await page.request.get(new URL(href!, page.url()).toString());
  expect(response.ok()).toBe(true);
  const manifest = await response.json();

  expect(manifest.name).toBe("Faite");
  // Not "/" — a device that already has the app installed should reopen
  // straight into it, not back onto the marketing pitch (src/app/page.tsx).
  expect(manifest.start_url).toBe("/board");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(
    true,
  );
});
