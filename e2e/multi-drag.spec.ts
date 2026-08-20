import { test, expect } from "./support/fixtures";

/**
 * Tier A — Cmd+click multi-select and dragging a run (EI-194;
 * docs/DRAG-AND-DROP.md §4.14).
 *
 * `desktop` only. Cmd+click has no touch equivalent, and the gesture is
 * desktop-scoped by design. Enforced by `desktop`'s `testMatch` in
 * playwright.config.ts, per docs/E2E.md §8.
 *
 * This spec exists because the failure surface is precisely what happy-dom
 * cannot reach: whether a modified click and dnd-kit's 4px activation
 * threshold interfere with each other. The unit tests assert that
 * `onSelect`/`onOpen`/`onToggle` fire correctly given a synthetic event; only
 * a real browser can show that a *drag* started from a selected card carries
 * the rest, and that a plain click still opens the sheet afterwards.
 *
 * Undo is deliberately NOT covered here. ⌘Z after a drag does not fire in this
 * harness — verified against a SINGLE-card drag too, so it is a pre-existing
 * gap in how `react-hotkeys-hook` sees Playwright's synthetic modifier press,
 * not anything about a multi-drag. Testing it here would assert the harness
 * rather than the feature; the N-step undo entry a multi-drag builds is
 * covered deterministically in `src/lib/undo.test.ts` instead.
 */

/** Cmd on macOS, Ctrl elsewhere — the same branch `todo-card.tsx` takes. */
const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function seedBacklog(page: import("@playwright/test").Page, titles: string[]) {
  const backlog = page.getByRole("region", { name: "Backlog" });
  const addField = backlog.getByPlaceholder("Add a to-do");
  for (const title of titles) {
    await addField.fill(title);
    await page.keyboard.press("Enter");
  }
  for (const title of titles) {
    await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
  }
}

const card = (page: import("@playwright/test").Page, title: string) =>
  page.getByRole("button", { name: title, exact: true });

/**
 * The board's clock is frozen to Tuesday 2026-08-11 (`FROZEN_TIME` in
 * support/fixtures.ts), so the first day column is always "Tuesday".
 */
const firstDay = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Tuesday" }).first();

/**
 * A real pointer drag, in steps, past dnd-kit's 4px `MouseSensor` threshold.
 *
 * The nudge before the long move matters: dnd-kit only activates once the
 * pointer has travelled 4px from `mousedown`, and a single jump to the
 * destination can be delivered as one event that both crosses the threshold
 * and lands, leaving no frame in which collision detection ever ran.
 */
async function dragTo(
  page: import("@playwright/test").Page,
  from: import("@playwright/test").Locator,
  to: import("@playwright/test").Locator,
) {
  const source = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 25 });
  await page.waitForTimeout(200);
  await page.mouse.up();
}

test.describe("multi-select drag", () => {
  test("cmd+click selects without opening the sheet or ticking anything", async ({ page }) => {
    await seedBacklog(page, ["Alpha", "Beta"]);

    await card(page, "Alpha").click({ modifiers: [MOD] });
    await card(page, "Beta").click({ modifiers: [MOD] });

    // The detail sheet must not have opened — that is what the capture-phase
    // `stopPropagation` on a modified click buys.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // And nothing was completed. `Mark X done` is the checkbox's accessible
    // name while the todo is open; it flips to `not done` once ticked.
    await expect(page.getByRole("checkbox", { name: "Mark Alpha done" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Mark Beta done" })).toBeVisible();
  });

  test("a plain click still opens the sheet after a selection is made", async ({ page }) => {
    await seedBacklog(page, ["Alpha", "Beta"]);
    await card(page, "Alpha").click({ modifiers: [MOD] });

    await card(page, "Beta").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("cmd+click on the checkbox selects rather than completing", async ({ page }) => {
    await seedBacklog(page, ["Alpha"]);

    await page.getByRole("checkbox", { name: "Mark Alpha done" }).click({ modifiers: [MOD] });

    // Still open: the accessible name would read "not done" if it had ticked.
    await expect(page.getByRole("checkbox", { name: "Mark Alpha done" })).toBeVisible();
  });

  test("dragging one selected card carries the whole selection to a day", async ({ page }) => {
    await seedBacklog(page, ["Alpha", "Beta", "Gamma"]);

    await card(page, "Alpha").click({ modifiers: [MOD] });
    await card(page, "Beta").click({ modifiers: [MOD] });

    const backlog = page.getByRole("region", { name: "Backlog" });
    await dragTo(page, card(page, "Alpha"), firstDay(page));

    // Both selected cards left Backlog; the unselected one stayed.
    await expect(async () => {
      await expect(backlog.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
      await expect(backlog.getByRole("button", { name: "Beta", exact: true })).toHaveCount(0);
      await expect(backlog.getByRole("button", { name: "Gamma", exact: true })).toHaveCount(1);
    }).toPass({ timeout: 5_000 });

    // Neither is left invisible, and neither is duplicated.
    await expect(card(page, "Alpha")).toHaveCount(1);
    await expect(card(page, "Beta")).toHaveCount(1);
    await expect(card(page, "Alpha")).toBeVisible();
    await expect(card(page, "Beta")).toBeVisible();
  });

  test("Escape clears the selection", async ({ page }) => {
    await seedBacklog(page, ["Alpha", "Beta"]);

    await card(page, "Alpha").click({ modifiers: [MOD] });
    await card(page, "Beta").click({ modifiers: [MOD] });
    await page.keyboard.press("Escape");

    // With nothing selected, dragging Alpha must move only Alpha.
    const backlog = page.getByRole("region", { name: "Backlog" });
    await dragTo(page, card(page, "Alpha"), firstDay(page));

    await expect(async () => {
      await expect(backlog.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
      await expect(backlog.getByRole("button", { name: "Beta", exact: true })).toHaveCount(1);
    }).toPass({ timeout: 5_000 });
  });
});
