import { test, expect, addTodo, expectOnServer, signIn, todoCard } from "../support/server";
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
  await addTodo(page, title);

  // The write left this client and reached the server.
  await expectOnServer(page, title);

  // A second, empty browser context — its own IndexedDB, no cookies — has
  // only the server to learn about the to-do from.
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await otherPage.clock.setFixedTime(new Date(FROZEN_TIME));
    await signIn(otherPage, account);
    await expect(todoCard(otherPage, title)).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await other.close();
  }
});
