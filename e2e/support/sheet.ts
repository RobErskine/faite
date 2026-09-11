import type { Locator, Page } from "@playwright/test";

/**
 * The sheet that is open — not one still animating out.
 *
 * A closed sheet stays in the DOM for its exit (`--dur-overlay-exit`, 200ms)
 * with `data-closed` set. Until EI-325 its backdrop also caught every click in
 * that window, so Playwright's actionability check waited for it to unmount
 * before it clicked whatever opened the next sheet. A closing overlay takes no
 * input now, so that click lands at once and, for a moment, there are two
 * `sheet-content` nodes: the one leaving and the one arriving. A bare
 * `[data-slot="sheet-content"]` then fails strict mode, some of the time.
 */
export function openSheet(page: Page): Locator {
  return page.locator('[data-slot="sheet-content"]:not([data-closed])');
}
