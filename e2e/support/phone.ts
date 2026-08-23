import type { Page } from "@playwright/test";

/**
 * Switches `PhoneBoard` to its "Lists" pager (Backlog, the tab strip) — where
 * Backlog and "My Lists" live by default is exactly the layout difference
 * this helper exists to survive. A no-op everywhere else: `DesktopBoard`
 * shows both halves always, so there's no "Lists" bottom-bar button to find,
 * and `.count() === 0` short-circuits without waiting.
 */
export async function switchToLists(page: Page): Promise<void> {
  const listsButton = page.getByRole("button", { name: "Lists", exact: true });
  if ((await listsButton.count()) > 0) await listsButton.click();
}

/**
 * The inverse of `switchToLists` — back to the "Days" pager, where `DateNav`
 * (and so the activity-feed trigger, `date-nav.tsx`) lives on phone; it
 * renders only while `phoneView === "days"` (`phone-board.tsx`). Same
 * no-op-elsewhere shape as `switchToLists`.
 */
export async function switchToDays(page: Page): Promise<void> {
  const daysButton = page.getByRole("button", { name: "Days", exact: true });
  if ((await daysButton.count()) > 0) await daysButton.click();
}
