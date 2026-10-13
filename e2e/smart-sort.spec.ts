import type { Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";
import { addListAndPropose } from "./support/smart-sort";

/**
 * Smart sorting's board half (EI-369): a Backlog to-do with a proposed list
 * shows a chip; the chip or `⇧→` moves it with an Undo, and the × dismisses
 * it. The proposal itself comes from the server (EI-367), so
 * `addListAndPropose` writes one where sync would. docs/SMART-SORT.md.
 */

const backlog = (page: Page) => page.getByRole("region", { name: "Backlog" });
const card = (page: Page, title: string) => page.getByRole("button", { name: title, exact: true });
const row = (page: Page, title: string) => page.locator("[data-todo-row]").filter({ has: card(page, title) });

async function seedBacklog(page: Page, titles: string[]) {
  await switchToLists(page);
  const addField = backlog(page).getByPlaceholder("Add a to-do");
  for (const title of titles) {
    await addField.fill(title);
    await page.keyboard.press("Enter");
  }
  for (const title of titles) await expect(card(page, title)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await seedBacklog(page, ["Buy oat milk", "Buy eggs", "Call the plumber"]);
  await addListAndPropose(page, "Groceries", ["Buy oat milk", "Buy eggs"]);
  await switchToLists(page);
});

test("the chip moves a to-do to its suggested list and offers Undo", async ({ page }) => {
  const chip = row(page, "Buy oat milk").getByRole("button", { name: "Move to Groceries" });
  await expect(chip).toBeVisible();
  // A to-do with no proposal shows no chip.
  await expect(row(page, "Call the plumber").getByRole("button", { name: /^Move to/ })).toHaveCount(0);

  await chip.click();
  await expect(backlog(page).getByRole("button", { name: "Buy oat milk", exact: true })).toHaveCount(0);
  await expect(page.getByText("Moved “Buy oat milk” to Groceries")).toBeVisible();
  // Asserted as offered, not pressed: ⌘Z does not fire in this harness (see
  // multi-drag.spec.ts), and the toast layer is click-through by fixture. The
  // undo entry is `inversePatch`, which restores `suggestedListId` too.
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("⇧→ on a focused Backlog card accepts its suggestion", async ({ page }) => {
  await row(page, "Buy eggs").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(backlog(page).getByRole("button", { name: "Buy eggs", exact: true })).toHaveCount(0);

  // No proposal, no move: ⇧→ on a plain card leaves it in Backlog.
  await row(page, "Call the plumber").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(backlog(page).getByRole("button", { name: "Call the plumber", exact: true })).toBeVisible();
});

test("the × dismisses a suggestion and leaves the to-do in Backlog", async ({ page }) => {
  await row(page, "Buy oat milk").getByRole("button", { name: "Dismiss suggestion" }).click();
  await expect(row(page, "Buy oat milk").getByRole("button", { name: "Move to Groceries" })).toHaveCount(0);
  await expect(backlog(page).getByRole("button", { name: "Buy oat milk", exact: true })).toBeVisible();
});

test("a quick-add in Backlog gets its chip straight from Jev, without waiting on sync (EI-373)", async ({ page }) => {
  const groceries = await addListAndPropose(page, "Pantry", [], { smartSortEnabled: true });
  // The board asks the suggest route itself; this stands in for the Worker.
  const asked: unknown[] = [];
  await page.route("**/api/smart-sort/suggest", async (route) => {
    const body = route.request().postDataJSON() as { todos: { id: string; title: string }[] };
    asked.push(body);
    await route.fulfill({ json: { suggestions: { [body.todos[0].id]: groceries } } });
  });
  await switchToLists(page);

  const addField = backlog(page).getByPlaceholder("Add a to-do");
  await addField.fill("Buy flour");
  await addField.press("Enter");

  await expect(row(page, "Buy flour").getByRole("button", { name: "Move to Pantry" })).toBeVisible();
  expect(asked).toEqual([{ todos: [expect.objectContaining({ title: "Buy flour", description: null })] }]);
});
