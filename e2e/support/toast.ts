import type { Page } from "@playwright/test";

/**
 * The Undo on the toast for whatever a test just DID — not the one on the
 * quick-add toast left over from seeding.
 *
 * Every quick-add now toasts where the to-do landed, with its own Undo
 * (EI-375), so a spec that seeds through the add field and then asserts on
 * a page-wide "Undo" button finds two. The quick-add toast always reads
 * "Added to", and only ever one of it exists (it reuses one sonner id).
 */
export function actionUndo(page: Page) {
  return page
    .locator("[data-sonner-toast]")
    .filter({ hasNotText: /Added to / })
    .getByRole("button", { name: "Undo" });
}
