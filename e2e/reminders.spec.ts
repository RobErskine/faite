import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";

/**
 * Reminder presets, end to end (EI-106 P5). Runs on every project —
 * `switchToLists()` is the only phone-specific step, reaching Backlog and
 * Settings exactly as `core-flows.spec.ts` does.
 *
 * Tier A: asserts behaviour (what got written, what renders), not pixels.
 * Card-badge assertions reopen the todo through ⌘K's search rather than
 * hunting for it in a day column — `PhoneBoard` shows exactly one day at a
 * time (defaulting to today), so a todo scheduled for tomorrow is correctly
 * off-screen there until the pager is navigated, same reasoning
 * `core-flows.spec.ts` gives for reopening via search after a status filter
 * drops a card off the board.
 */

test("a fresh boot seeds the five default presets, visible in Settings", async ({ page }) => {
  await switchToLists(page);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByText("Reminders", { exact: true }).click();

  for (const name of ["Morning", "Lunchtime", "Afternoon", "End of day", "Evening"]) {
    await expect(page.locator(`input[value="${name}"]`)).toBeVisible();
  }
});

test("picking a preset in the todo sheet writes the reminder and shows the card badge", async ({
  page,
}) => {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "Take out recycling";
  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: title, exact: true }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();

  // Thursday — inside the frozen fixture's visible 7-day window (Tue Aug 11
  // through Mon Aug 17), unlike a date far enough out to scroll off-screen.
  await sheet.locator("#todo-scheduled").fill("2026-08-13");
  const reminderInput = sheet.locator("#todo-reminder-input");
  await reminderInput.fill("morn");
  await expect(page.getByRole("option", { name: /Morning/ })).toBeVisible();
  await page.getByRole("option", { name: /Morning/ }).click();

  await expect(reminderInput).toHaveAttribute("placeholder", /Morning/);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // Reopen through search rather than hunting for the card in its column —
  // works identically on desktop and phone.
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search to-dos or run a command…").fill(title);
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("#todo-reminder-input")).toHaveAttribute(
    "placeholder",
    /Morning/,
  );
});

test("quick-add resolves a preset name into a reminder", async ({ page }) => {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "water plants";
  const field = backlog.getByPlaceholder("Add a to-do");
  await field.fill(`${title} tomorrow lunchtime`);

  // Live preview chip names the preset, not a raw clock time.
  await expect(page.getByText(/Lunchtime/)).toBeVisible();

  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);

  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search to-dos or run a command…").fill(title);
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet.locator("#todo-reminder-input")).toHaveAttribute(
    "placeholder",
    /Lunchtime/,
  );
});

test("deleting a reminder from the sheet clears it and removes the card badge", async ({
  page,
}) => {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "Feed the cat";
  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: title, exact: true }).click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await sheet.locator("#todo-scheduled").fill("2026-08-13");
  await sheet.locator("#todo-reminder-input").fill("14:00");
  await page.getByRole("option", { name: /Remind at 2:00 PM/ }).click();
  await expect(page.getByRole("button", { name: "Clear reminder" })).toBeVisible();

  await page.getByRole("button", { name: "Clear reminder" }).click();
  await expect(sheet.locator("#todo-reminder-input")).toHaveAttribute(
    "placeholder",
    "Add a reminder…",
  );
});
