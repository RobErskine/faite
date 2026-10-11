import type { Page } from "@playwright/test";
import {
  test as base,
  expect,
  addTodo,
  expectOnServer,
  openSecondClient,
  renameTodo,
  todoCard,
} from "../support/server";
import { FROZEN_TIME } from "../support/fixtures";
import { openSheet } from "../support/sheet";

/**
 * Two clients, one account, the real sync server (EI-357). Sync bugs lose
 * people's data (EI-68), so this is the suite that says a write made on one
 * device reaches the other — online, offline, and in a conflict.
 *
 * **Timing tolerance.** A write leaves its client after the 2s outbox
 * debounce (`DEFAULT_DEBOUNCE_MS`, src/lib/sync/engine.ts). The Durable Object
 * then sends a `changed` message to every other open WebSocket and the
 * receiver pulls at once — a few seconds end to end. If the socket is down,
 * the receiver only finds out from its fallback poll: 30s with no socket, 120s
 * with one that died quietly (±20% jitter). `CONVERGE` (20s) covers the socket
 * path with room for a loaded machine; it does NOT wait out a poll, on
 * purpose. A failure here means the push path broke — slow-but-correct
 * polling would be a regression of its own, not a flake to absorb.
 */
const CONVERGE = { timeout: 20_000 };

/**
 * Opens a to-do's sheet once while online, so the description editor's
 * `next/dynamic` chunk is loaded before the network goes away. Without this,
 * the first sheet opened offline throws ChunkLoadError and the whole board
 * falls to its error page — a real bug, EI-362, not a sync one. Remove this
 * when EI-362 lands.
 */
async function loadSheetChunks(page: Page, title: string) {
  await todoCard(page, title).click();
  await expect(openSheet(page).locator('[data-slot="markdown-field"] [contenteditable="true"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(openSheet(page)).toHaveCount(0);
}

/** A fixed instant `minutes` after `FROZEN_TIME`. */
function at(minutes: number): Date {
  return new Date(new Date(FROZEN_TIME).getTime() + minutes * 60_000);
}

/**
 * The second client is a fixture, not `beforeEach`/`afterEach`: a context
 * closed in `afterEach` races Playwright's own trace cleanup and fails the
 * test with "file data stream has unexpected number of bytes". Fixture
 * teardown runs before that cleanup.
 */
const test = base.extend<{ other: Page }>({
  other: async ({ browser, account }, use) => {
    const other = await openSecondClient(browser, account);
    await use(other);
    await other.context().close();
  },
});

test.describe("two clients on one account", () => {
  test("create, edit and complete on one client each reach the other without a refresh", async ({
    page,
    other,
  }) => {
    await addTodo(page, "Water the plants");
    await expect(todoCard(other, "Water the plants")).toBeVisible(CONVERGE);

    await renameTodo(page, "Water the plants", "Water the ferns");
    await expect(todoCard(other, "Water the ferns")).toBeVisible(CONVERGE);
    await expect(todoCard(other, "Water the plants")).toHaveCount(0);

    // Matched by regex: the name flips to "Mark … not done" as the click lands.
    await page.getByRole("checkbox", { name: /Mark Water the ferns/ }).click();
    // Completed to-dos leave the board (`visibleStatuses` defaults to open).
    await expect(todoCard(other, "Water the ferns")).toHaveCount(0, CONVERGE);
  });

  test("edits made offline flush on reconnect, and both clients converge with no duplicates", async ({
    page,
    other,
  }) => {
    await addTodo(page, "Pack the tent");
    await expect(todoCard(other, "Pack the tent")).toBeVisible(CONVERGE);
    await loadSheetChunks(page, "Pack the tent");

    await page.context().setOffline(true);
    await addTodo(page, "Buy fuel canisters");
    await renameTodo(page, "Pack the tent", "Pack the big tent");

    // Proof the edits really were held back: the server has neither.
    // (`other.request` is not affected by the first client's offline mode.)
    const serverBefore = await (await other.request.get("/api/sync/pull")).text();
    expect(serverBefore).not.toContain("Buy fuel canisters");
    expect(serverBefore).not.toContain("Pack the big tent");

    // `online` triggers a sync at once (engine.ts) and wakes the socket.
    await page.context().setOffline(false);

    for (const client of [page, other]) {
      await expect(todoCard(client, "Buy fuel canisters")).toHaveCount(1, CONVERGE);
      await expect(todoCard(client, "Pack the big tent")).toHaveCount(1, CONVERGE);
      await expect(todoCard(client, "Pack the tent")).toHaveCount(0);
    }
  });

  test("a conflicting title edit goes to the later edit, even when it reaches the server first", async ({
    page,
    other,
  }) => {
    // The documented rule (docs/SYNC.md, EI-47): last-writer-wins PER FIELD,
    // decided by the HLC stamped when the edit was made — not by the order
    // edits arrive at the server. Each client gets its own fixed clock so the
    // winner does not come down to a tie-break on a random node id.
    await addTodo(page, "Book the campsite");
    await expect(todoCard(other, "Book the campsite")).toBeVisible(CONVERGE);
    await loadSheetChunks(page, "Book the campsite");

    // This client edits first (12:01) but offline, so its edit arrives last.
    await page.context().setOffline(true);
    await page.clock.setFixedTime(at(1));
    await renameTodo(page, "Book the campsite", "Title from the earlier edit");

    // The other client edits later (12:02), online — it reaches the server first.
    await other.clock.setFixedTime(at(2));
    await renameTodo(other, "Book the campsite", "Title from the later edit");
    await expectOnServer(other, "Title from the later edit");

    await page.context().setOffline(false);

    for (const client of [page, other]) {
      await expect(todoCard(client, "Title from the later edit")).toHaveCount(1, CONVERGE);
      await expect(todoCard(client, "Title from the earlier edit")).toHaveCount(0);
    }
  });
});
