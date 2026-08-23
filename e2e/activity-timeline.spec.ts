import { test, expect } from "./support/fixtures";
import { switchToDays, switchToLists } from "./support/phone";

/**
 * The global activity feed (todos-only v1) — `activity-sheet.tsx`, opened
 * from `DateNav`'s `list-clock` button. Runs on `desktop` + `phone-iphone`
 * only (the PR gate pair, AGENTS.md): the drawer is full-width on phone,
 * which is the one interesting layout difference from desktop worth a
 * second project here.
 */

test("logs a created and a done event, newest first under Today, and the filter hides them", async ({
  page,
}) => {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "Ship the activity feed";

  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");
  await page.getByRole("checkbox", { name: new RegExp(title) }).click();

  // `DateNav` — and so the activity-feed trigger — renders only on the
  // "Days" pager on phone; quick-adding above required "Lists".
  await switchToDays(page);
  await page.getByRole("button", { name: "Open activity feed" }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();

  const activityList = sheet.getByRole("list", { name: "Activity" });
  await expect(activityList).toBeVisible();
  await expect(sheet.getByText("Today")).toBeVisible();

  // Newest first: `done` (the later event) renders above `created`. Read
  // the `<ol>`'s own `<li>`s in DOM order rather than a class selector —
  // this includes the "Today" day header too, which is fine, only the
  // relative order of the two event rows is under test.
  const itemTexts = await activityList.locator("li").allTextContents();
  const doneIndex = itemTexts.findIndex((t) => t.includes("Completed"));
  const createdIndex = itemTexts.findIndex((t) => t.includes("Created"));
  expect(doneIndex).toBeGreaterThanOrEqual(0);
  expect(createdIndex).toBeGreaterThan(doneIndex);

  // The row's subject line is the todo's own title, clickable — both the
  // `done` and `created` rows show it (it's the same todo), so `.first()`.
  await expect(sheet.getByRole("button", { name: title }).first()).toBeVisible();

  // Filtering out both logged kinds empties the page and shows the notice —
  // same "N hidden by the view filter · Show all" component the day sheet
  // uses, backed by `visibleActivityKinds`, not `visibleEventKinds`.
  await sheet.getByRole("button", { name: "Which activity to show" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Created" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Completed" }).click();
  // The menu stays open across clicks (multi-select, `closeOnClick={false}`)
  // — close it before reaching for "Show all" underneath, or the still-open
  // portal intercepts the click.
  await page.keyboard.press("Escape");
  await expect(sheet.getByText(/hidden by the view filter/)).toBeVisible();

  await sheet.getByRole("button", { name: "Show all" }).click();
  await expect(sheet.getByText(title).first()).toBeVisible();
});

test("a deleted todo's row keeps its title and isn't clickable", async ({ page }) => {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "Delete me for the feed";

  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  const card = page.getByRole("button", { name: title, exact: true });
  await card.click();
  const todoSheet = page.locator('[data-slot="sheet-content"]');
  await todoSheet.getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);

  await switchToDays(page);
  await page.getByRole("button", { name: "Open activity feed" }).click();
  const activitySheet = page.locator('[data-slot="sheet-content"]');
  await expect(activitySheet).toBeVisible();
  // Both the `created` and `deleted` rows show the same (now-tombstoned)
  // title, so `.first()` — the point here is that it renders at all, muted,
  // and as no button anywhere in the sheet.
  await expect(activitySheet.getByText(title).first()).toBeVisible();
  await expect(activitySheet.getByRole("button", { name: title })).toHaveCount(0);
});
