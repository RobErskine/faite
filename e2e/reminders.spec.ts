import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";
import { openSheet } from "./support/sheet";

/**
 * Reminder presets, end to end (EI-106 P5). Runs on every project —
 * `switchToLists()` is the only phone-specific step, reaching Backlog and
 * Settings exactly as `core-flows.spec.ts` does.
 *
 * Tier A: asserts behavior (what got written, what renders), not pixels.
 * Card-badge assertions reopen the todo through ⌘K's search rather than
 * hunting for it in a day column — `PhoneBoard` shows exactly one day at a
 * time (defaulting to today), so a todo scheduled for tomorrow is correctly
 * off-screen there until the pager is navigated, same reasoning
 * `core-flows.spec.ts` gives for reopening via search after a status filter
 * drops a card off the board.
 *
 * Since EI-318 the date and the reminder are ONE control: the date field is a
 * popover, not an `<input type="date">` (so `fill` cannot reach it), and the
 * reminder lives behind that popover's Time panel. The helpers below are the
 * whole difference — everything these tests assert is unchanged.
 */

/**
 * Pick a day from the date popover's calendar.
 *
 * `page`, not `sheet`: the popover is portalled to the body, so it is not a
 * descendant of the sheet content that opened it.
 */
async function setSheetDate(page: Page, sheet: Locator, dayName: RegExp) {
  await sheet.locator("#todo-scheduled").click();
  await page.getByRole("button", { name: dayName }).click();
}

/** Reveal the reminder picker, which lives under the date popover's calendar. */
async function openTimePanel(page: Page, sheet: Locator) {
  await sheet.locator("#todo-scheduled").click();
  await page.getByRole("button", { name: /^Time/ }).click();
  return page.locator("#todo-reminder-input");
}

/** The date trigger says the whole schedule now — "Aug 13 · 8:00 AM". */
function scheduleText(sheet: Locator) {
  return sheet.locator("#todo-scheduled");
}

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
  const sheet = openSheet(page);
  await expect(sheet).toBeVisible();

  // Thursday — inside the frozen fixture's visible 7-day window (Tue Aug 11
  // through Mon Aug 17), unlike a date far enough out to scroll off-screen.
  await setSheetDate(page, sheet, /August 13(th)?, 2026/);

  const reminderInput = await openTimePanel(page, sheet);
  await reminderInput.fill("morn");
  await expect(page.getByRole("option", { name: /Morning/ })).toBeVisible();
  await page.getByRole("option", { name: /Morning/ }).click();

  // One Escape closes the popover, not the sheet — the whole point of
  // `date-popover.test.tsx`'s layered-Escape unit test, asserted here against
  // a real browser.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await expect(scheduleText(sheet)).toContainText(/Aug 13/);
  await expect(scheduleText(sheet)).toContainText(/8:00/);

  await page.keyboard.press("Escape");
  // Gone, not just closing: every sheet node, including one still animating
  // out, which `openSheet()` deliberately skips.
  await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);

  // Reopen through search rather than hunting for the card in its column —
  // works identically on desktop and phone.
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search to-dos or run a command…").fill(title);
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();
  await expect(sheet).toBeVisible();
  await expect(scheduleText(sheet)).toContainText(/Aug 13/);
  await expect(scheduleText(sheet)).toContainText(/8:00/);
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

  const sheet = openSheet(page);
  // Lunchtime is 12:30 — the trigger states the whole schedule now, so the
  // reminder is assertable without opening anything.
  await expect(scheduleText(sheet)).toContainText(/12:30/);
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

  const sheet = openSheet(page);
  await setSheetDate(page, sheet, /August 13(th)?, 2026/);

  const reminderInput = await openTimePanel(page, sheet);
  await reminderInput.fill("14:00");
  await page.getByRole("option", { name: /Remind at 2:00 PM/ }).click();
  await expect(page.getByRole("button", { name: "Clear reminder" })).toBeVisible();

  await page.getByRole("button", { name: "Clear reminder" }).click();
  await expect(reminderInput).toHaveAttribute("placeholder", "Add a reminder…");

  // And the trigger drops the time while keeping the day.
  await page.keyboard.press("Escape");
  await expect(scheduleText(sheet)).toContainText(/Aug 13/);
  await expect(scheduleText(sheet)).not.toContainText(/2:00/);
});
