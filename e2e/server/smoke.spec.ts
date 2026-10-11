import { test, expect, signIn } from "../support/server";
import { FROZEN_TIME } from "../support/fixtures";

/**
 * Proves the server harness end to end (EI-355): a real browser signs up on
 * the Workers runtime, lands on the board, and a write it makes reaches the
 * server and comes back to a different client. If this is red, every other
 * spec in `e2e/server/` is testing nothing — fix this one first.
 */
test("a fresh account signs up, writes a to-do, and a second client receives it", async ({
  page,
  account,
  browser,
}) => {
  const title = "Harness smoke to-do";
  const backlog = page.getByRole("region", { name: "Backlog" });
  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();

  // The write left this client. Polled through the sync API itself (the
  // page's cookies ride along on `page.request`) rather than by waiting for a
  // `/api/sync/push` response: the engine pushes over the WebSocket when one
  // is open, so a network wait on the HTTP route can miss the write entirely.
  await expect
    .poll(async () => (await page.request.get("/api/sync/pull")).text(), { timeout: 20_000 })
    .toContain(title);

  // A second, empty browser context — its own IndexedDB, no cookies — has
  // only the server to learn about the to-do from.
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await otherPage.clock.setFixedTime(new Date(FROZEN_TIME));
    await signIn(otherPage, account);
    await expect(otherPage.getByRole("button", { name: title, exact: true })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await other.close();
  }
});
