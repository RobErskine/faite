import { test, expect } from "./support/fixtures";
import { moveAway, realHover } from "./support/hover";

/**
 * Tier A — the completion stamp on a checkbox (EI-192, fixed in EI-196).
 *
 * `desktop` only: this needs CDP mouse input, which is Chromium-only, and a
 * hover has no meaning on a touch project anyway.
 *
 * This spec exists because the original bug was invisible everywhere else.
 * `TooltipTrigger render={<Checkbox/>}` composes two Base UI `useRender`
 * components and the trigger's pointer handlers are silently dropped — the
 * checkbox rendered correctly, kept every prop, still toggled, and simply
 * never opened a tooltip. Typecheck, lint, and eleven happy-dom assertions
 * were all green. Only real pointer input over a real layout shows it.
 *
 * The CONTROL case below is load-bearing. Without it, "the tooltip did not
 * open" is ambiguous between a broken app and a harness that cannot open any
 * tooltip — and Playwright's own `locator.hover()` is exactly the latter, so
 * this is a mistake that has already been made once here.
 */

const tooltips = (page: import("@playwright/test").Page) =>
  page.locator('[data-slot="tooltip-content"]');

async function completeAlpha(page: import("@playwright/test").Page) {
  const backlog = page.getByRole("region", { name: "Backlog" });
  await backlog.getByPlaceholder("Add a to-do").fill("Alpha");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();

  // Completed items are hidden by default (`visibleStatuses`), so a ticked
  // to-do would leave the board entirely.
  await page.getByLabel("Which statuses to show").click();
  await page.getByRole("menuitemcheckbox", { name: "Completed" }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("checkbox", { name: "Mark Alpha done" }).click();
  const done = page.getByRole("checkbox", { name: "Mark Alpha not done" });
  await expect(done).toBeVisible();
  return done;
}

test.describe("completion stamp", () => {
  test("CONTROL: this harness can open a Base UI tooltip at all", async ({ page }) => {
    // If this ever fails, every other assertion in this file is meaningless.
    await realHover(page, page.getByRole("button", { name: "Archived" }));
    await expect(tooltips(page)).toHaveCount(1);
  });

  test("opens on hover and STAYS open", async ({ page }) => {
    const done = await completeAlpha(page);
    await realHover(page, done);

    await expect(tooltips(page)).toHaveCount(1);
    await expect(tooltips(page)).toHaveText(/^Completed /);

    // The reported bug was a flash: open, then gone a moment later. Hold the
    // pointer still and confirm it survives.
    await page.waitForTimeout(1500);
    await expect(tooltips(page)).toHaveCount(1);
    await expect(tooltips(page)).toHaveText(/^Completed /);
  });

  test("closes when the pointer leaves", async ({ page }) => {
    const done = await completeAlpha(page);
    await realHover(page, done);
    await expect(tooltips(page)).toHaveCount(1);

    await moveAway(page);
    await expect(tooltips(page)).toHaveCount(0);
  });

  test("an open to-do's checkbox has no tooltip", async ({ page }) => {
    const backlog = page.getByRole("region", { name: "Backlog" });
    await backlog.getByPlaceholder("Add a to-do").fill("Alpha");
    await page.keyboard.press("Enter");

    const box = page.getByRole("checkbox", { name: "Mark Alpha done" });
    await expect(box).toBeVisible();
    await realHover(page, box);

    await page.waitForTimeout(400);
    await expect(tooltips(page)).toHaveCount(0);
  });

  test("the checkbox still toggles while its tooltip is open", async ({ page }) => {
    // Two separate risks in one gesture: the tooltip trigger wrapping the
    // control must not swallow the click, and the checkbox must actually
    // REOPEN a finished to-do rather than re-writing `done` over `done`
    // (EI-197 — it did the latter, and the card sat there unmoved while its
    // own aria-label promised otherwise).
    const done = await completeAlpha(page);
    await realHover(page, done);
    await expect(tooltips(page)).toHaveCount(1);

    await done.click();
    await expect(page.getByRole("checkbox", { name: "Mark Alpha done" })).toBeVisible();
  });

  test("reopening clears the stamp, so the tooltip goes with it", async ({ page }) => {
    const done = await completeAlpha(page);
    await done.click();

    const reopened = page.getByRole("checkbox", { name: "Mark Alpha done" });
    await expect(reopened).toBeVisible();

    await moveAway(page);
    await realHover(page, reopened);
    await page.waitForTimeout(400);
    // `statusPatch` nulls `completedAt` on reopen, so there is nothing to say.
    await expect(tooltips(page)).toHaveCount(0);
  });
});
