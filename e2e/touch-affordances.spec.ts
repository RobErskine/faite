import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";

/**
 * Tier A coverage for P1 (docs/MOBILE.md) — the two claims that phase makes:
 * hover-only reveals are visible without hovering, and touch targets are
 * comfortably tappable. `phone-*`/`tablet-*` projects only (all forced
 * `pointer: coarse` via device emulation — see playwright.config.ts).
 *
 * Scope, stated honestly: `pointer-coarse:min-h-11`-style fixes that land
 * directly on the interactive element (Button, SelectTrigger, the tab pill)
 * are asserted here via `boundingBox()`. The `::after`-pseudo-element hit-
 * area expansions (Checkbox, RailHandle, SplitHandle) are NOT — Playwright's
 * `boundingBox()` measures the real element's box, not a pseudo-element's,
 * and there's no direct API for the latter. Those were verified once by
 * compiling the actual generated CSS during development (see docs/MOBILE.md
 * §3); redoing that as a `getComputedStyle(el, "::after")` E2E assertion
 * would mostly be testing that Tailwind's compiler still works, not that
 * this app's classes are correct.
 *
 * `PhoneBoard` (P3) splits Overflow (Days pager) and Backlog/the tab strip
 * (Lists pager) across two mutually-exclusive views — `switchToLists()`
 * (support/phone.ts) reaches the latter; it's a no-op on tablet/desktop,
 * which show both at once.
 */
test.describe("touch affordances", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name === "desktop",
      "pointer: coarse only exists on the tablet/phone projects",
    );
  });

  test("hover-only reveals are visible without hovering", async ({ page }, testInfo) => {
    // Overflow's rail-collapse affordance only exists when Overflow renders
    // as a pinned rail (tablet/desktop layout) — on phone (P3) Overflow is a
    // full pager page instead, with no collapse concept at all, so there's
    // nothing to assert there. Checked in the default "Days" view, before
    // `switchToLists()` navigates away from it.
    const isPhonePortrait =
      testInfo.project.name === "phone-iphone" || testInfo.project.name === "phone-pixel";
    if (!isPhonePortrait) {
      await expect(
        page.getByRole("button", { name: "Collapse the Overflow column" }),
      ).toBeVisible();
    }

    await switchToLists(page);
    const title = "Touch-visible todo";
    await page
      .getByRole("region", { name: "Backlog" })
      .getByPlaceholder("Add a to-do")
      .fill(title);
    await page.keyboard.press("Enter");

    // Each of these is `opacity-0 group-hover:opacity-100 touch:opacity-100`
    // (or the tab/rail equivalent) — on a device that can never hover,
    // `group-hover` (gated to `@media (hover: hover)`, Tailwind v4) never
    // applies, so `touch:opacity-100` is the only thing making them visible
    // at all. No `.hover()` call anywhere in this test is the point.
    await expect(
      page.getByRole("button", { name: `Drag to reschedule or reorder ${title}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tab options for My Lists" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Drag to reorder the My Lists tab" }),
    ).toBeVisible();
  });

  test("small icon buttons meet the 44px comfortable-touch-target floor", async ({ page }) => {
    // "New tab" (tab-strip.tsx) only exists in `PhoneBoard`'s "Lists" view.
    await switchToLists(page);
    // "New tab" is `size="icon-xs"` (tab-strip.tsx) — the buttonVariants
    // entry P1 grows via `pointer-coarse:min-h-11 pointer-coarse:min-w-11`,
    // and it's on screen with no setup needed.
    const box = await page.getByRole("button", { name: "New tab" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test("the tab pill meets the 44px floor", async ({ page }) => {
    // The tab strip (tab-strip.tsx) only exists in `PhoneBoard`'s "Lists" view.
    await switchToLists(page);
    // `pointer-coarse:min-h-11` (tab-strip.tsx) sizes the whole pill row,
    // not the label button inside it — checking the button directly would
    // only see its unpadded label height, not the tap target a thumb
    // actually gets. Locate the ancestor that carries the min-height.
    const pillBox = await page
      .getByRole("button", { name: "My Lists", exact: true })
      .locator("xpath=ancestor::div[contains(@class,'group/tab')]")
      .boundingBox();
    expect(pillBox).not.toBeNull();
    expect(pillBox!.height).toBeGreaterThanOrEqual(44);
  });
});
