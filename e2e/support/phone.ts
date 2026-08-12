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
