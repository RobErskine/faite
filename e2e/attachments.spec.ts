import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";

/**
 * The Attachments section of the todo sheet (EI-242).
 *
 * ## What this deliberately does NOT test
 *
 * A real upload. The e2e harness serves Next alone — `next dev` locally,
 * `next start` in CI (docs/E2E.md §9) — and there is no Worker in either, so
 * `POST /api/attachments` and its R2 binding simply do not exist here. A spec
 * that picked a file would assert on a network failure, which is worse than
 * no coverage: it would pass for the wrong reason the day the route broke.
 *
 * So this covers the half that IS real without a backend: that the section is
 * mounted in the shared sheet and therefore reachable from BOTH board shells,
 * that its affordance and stated limits render, and that a todo with no files
 * shows no badge. The upload path itself is covered by unit tests over the
 * gate (`src/server/attachments/validate.test.ts`) and the ordering contract
 * (`src/lib/store/attachments.test.ts`), and by the manual check in
 * docs/ATTACHMENTS.md.
 */

async function openSheetFor(page: Parameters<typeof switchToLists>[0], title: string) {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  // `exact: true` — the drag grip's aria-label also contains the title.
  await page.getByRole("button", { name: title, exact: true }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

test("the todo sheet offers an Attachments section", async ({ page }) => {
  const sheet = await openSheetFor(page, "File the tax return");

  // Mounted once in board.tsx above the desktop/phone branch, so this
  // assertion passing on both projects is what proves neither shell needs
  // its own attachment UI.
  await expect(sheet.getByText("Attachments", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Attach a file" })).toBeEnabled();
});

test("the section states the limit the server actually enforces", async ({ page }) => {
  const sheet = await openSheetFor(page, "Send the invoice");

  // The number comes from `lib/attachment-limits.ts`, the same module the
  // Worker enforces from — so this catches the two drifting apart, which is
  // the failure the shared-constants module exists to prevent.
  await expect(sheet.getByText(/Up to 5 MB each/)).toBeVisible();
  await expect(sheet.getByText(/Images, PDF, CSV and text/)).toBeVisible();
});

test("a todo with no files shows no attachment count anywhere", async ({ page }) => {
  const title = "Water the plants";
  const sheet = await openSheetFor(page, title);

  // No "(n)" beside the heading...
  await expect(sheet.getByText(/^Attachments \(/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // ...and no paperclip badge on the card. `hasContent` in
  // `todo-row-parts.tsx` gates the whole badge row, so a stray zero-count
  // badge would also make an otherwise-bare card render one.
  const card = page.getByRole("button", { name: title, exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByTitle(/attachment/)).toHaveCount(0);
});
