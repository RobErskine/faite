import type { Locator, Page } from "@playwright/test";

/**
 * A real, trusted mouse hover, via the Chrome DevTools Protocol.
 *
 * `locator.hover()` does NOT work for Base UI tooltips. It moves the mouse in
 * one jump, and nothing in the app opens — verified against a tooltip that is
 * known-good in a real browser (the Archived button's), which stays closed
 * under `hover()` and opens immediately under this. Same distinction
 * `support/touch.ts` documents for `Input.dispatchTouchEvent`: a synthetic
 * event fires, and the browser declines to do anything with it.
 *
 * The approach path matters as much as the destination — the pointer has to
 * cross INTO the element from outside for a genuine `pointerenter`, so this
 * starts 60px away and walks in.
 *
 * Chromium-only, hence `desktop`-project only.
 */
export async function realHover(page: Page, target: Locator): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  const move = (px: number, py: number) =>
    cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py, buttons: 0 });

  await move(x - 60, y - 60);
  await page.waitForTimeout(60);
  for (let i = 1; i <= 6; i++) {
    await move(x - 60 + (60 * i) / 6, y - 60 + (60 * i) / 6);
    await page.waitForTimeout(25);
  }
  await move(x, y);
}

/** Move the pointer well clear of anything, to close an open tooltip. */
export async function moveAway(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, buttons: 0 });
}
