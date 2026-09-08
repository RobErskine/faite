import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Right-click context menus (EI-281 — the card menu EI-285, the list column
 * menu EI-286).
 *
 * `desktop` only, and that is the feature rather than a testing shortcut:
 * context menus are disabled on coarse pointers, because dnd-kit's touch
 * sensor lifts a card at 400ms and Base UI's long-press is a hardcoded 500ms
 * that never cancels on drag activation. The negative case — a long-press
 * opening NO menu — lives in `touch-affordances.spec.ts`, which already runs
 * on tablet and all three phone projects.
 *
 * What this spec is for is the handful of things happy-dom cannot see:
 * a genuinely trusted `contextmenu` event, whether the press that opens the
 * menu also starts a drag, whether a text field keeps the browser's own menu,
 * and whether a reschedule actually moves a card between columns.
 *
 * Deliberately NOT covered: ⌘Z while a menu is open. `multi-drag.spec.ts`
 * documents that ⌘Z does not fire in this harness at all — a pre-existing gap
 * in how `react-hotkeys-hook` sees Playwright's synthetic modifier press — so
 * asserting "undo did nothing" here would pass whether or not the guard
 * exists. The guard is covered deterministically in `board-guards.test.ts`.
 */

const MOD = process.platform === "darwin" ? "Meta" : "Control";


const card = (page: Page, title: string) =>
  page.getByRole("button", { name: title, exact: true });

const backlog = (page: Page) => page.getByRole("region", { name: "Backlog" });

async function seedBacklog(page: Page, titles: string[]) {
  const addField = backlog(page).getByPlaceholder("Add a to-do");
  for (const title of titles) {
    await addField.fill(title);
    await page.keyboard.press("Enter");
  }
  for (const title of titles) {
    await expect(card(page, title)).toBeVisible();
  }
}

/** The row element behind a card's title button — the context-menu trigger. */
const row = (page: Page, title: string) =>
  page.locator("[data-todo-row]").filter({ has: card(page, title) });

test.describe("to-do card menu", () => {
  test("opens on right-click, with the actions a card supports", async ({ page }) => {
    await seedBacklog(page, ["Water the plants"]);

    // The control assertion first: a menu opened at all. Every item check
    // below is meaningless if this is what actually broke.
    await row(page, "Water the plants").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();

    for (const name of ["Edit", "Mark done", "Won't do", "Reschedule", "Delete"]) {
      await expect(page.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  test("closes on Escape without disturbing the card", async ({ page }) => {
    await seedBacklog(page, ["Water the plants"]);
    await row(page, "Water the plants").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    // Still there, still open — Escape dismissed the menu and nothing else.
    // Focus restoration is Base UI's and is deliberately not asserted: the row
    // is `tabindex="-1"` and never took focus to begin with.
    await expect(card(page, "Water the plants")).toBeVisible();
  });

  test("the press that opens the menu does not start a drag", async ({ page }) => {
    await seedBacklog(page, ["Water the plants"]);
    await row(page, "Water the plants").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();

    // dnd-kit refuses button 2, but only a real browser can show that the
    // whole gesture stayed inert — no lift, no drop indicator anywhere.
    await expect(page.locator("[data-drop-indicator]")).toHaveCount(0);
  });

  test("marking done removes the card and offers an undo", async ({ page }) => {
    await seedBacklog(page, ["Water the plants"]);
    await row(page, "Water the plants").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark done" }).click();

    // The default view shows open to-dos only, so completing it takes it away.
    await expect(card(page, "Water the plants")).toBeHidden();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  test("quick reschedule moves the card onto a day column", async ({ page }) => {
    await seedBacklog(page, ["Water the plants"]);
    await row(page, "Water the plants").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Reschedule" }).click();

    // Every row names where it lands, which is the whole reason the submenu
    // can anchor on today without lying about it.
    const tomorrow = page.getByRole("menuitem", { name: /^Tomorrow/ });
    await expect(tomorrow).toBeVisible();
    await tomorrow.click();

    // The clock is frozen to Tuesday 2026-08-11, so tomorrow is Wednesday.
    await expect(
      page.getByRole("region", { name: "Wednesday" }).getByRole("button", {
        name: "Water the plants",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  /**
   * The keyboard route, which is what keeps this from being a mouse-only
   * feature. The title button is in the tab order, so Tab reaches it and the
   * Menu key opens the same menu.
   *
   * Only the Menu key is asserted: Shift+F10 is the same gesture on Windows
   * hardware, but Chromium does not synthesize a `contextmenu` from it, so a
   * test for it would fail for reasons that have nothing to do with this app.
   */
  test("opens from the keyboard with the Menu key", async ({ page }) => {
    await seedBacklog(page, ["Water the plants"]);
    await card(page, "Water the plants").focus();
    await page.keyboard.press("ContextMenu");
    await expect(page.getByRole("menuitem", { name: "Mark done" })).toBeVisible();
  });

  test("acts on the whole selection, and says how many", async ({ page }) => {
    await seedBacklog(page, ["One", "Two", "Three"]);

    // Every card, including the first: a PLAIN click opens the detail sheet,
    // which would then cover the rest of the column.
    await card(page, "One").click({ modifiers: [MOD] });
    await card(page, "Two").click({ modifiers: [MOD] });
    await card(page, "Three").click({ modifiers: [MOD] });

    await row(page, "Two").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Delete 3" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Delete 3" }).click();

    for (const title of ["One", "Two", "Three"]) {
      await expect(card(page, title)).toBeHidden();
    }
  });

  test("right-clicking outside the selection collapses it to one card", async ({
    page,
  }) => {
    await seedBacklog(page, ["One", "Two", "Three"]);
    await card(page, "One").click({ modifiers: [MOD] });
    await card(page, "Two").click({ modifiers: [MOD] });

    await row(page, "Three").click({ button: "right" });
    // Singular: this gesture is about the card under the cursor, not the
    // selection it was not part of.
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete 2" })).toHaveCount(0);
  });
});

test.describe("list column menu", () => {
  const header = (page: Page, name: string) =>
    page.getByRole("region", { name }).locator("header");

  /*
    A real list, not Backlog. Backlog is a rail column — it cannot be archived
    or deleted, has no reorder grip, and correctly gets no menu at all.
  */
  test("opens on the column header with its four actions", async ({ page }) => {
    await header(page, "Brain Dump").click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();

    for (const name of ["List settings…", "Color", "Archive", "Delete"]) {
      await expect(page.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  test("the color submenu offers every accent and an explicit none", async ({
    page,
  }) => {
    await header(page, "Brain Dump").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Color" }).click();

    // Ten accents plus None. Hardcoded rather than derived from ACCENT_COLORS,
    // so the assertion cannot move with the thing it is checking.
    await expect(page.getByRole("menuitemradio")).toHaveCount(11);
    await expect(page.getByRole("menuitemradio", { name: "Tomato" })).toBeVisible();
  });
});

/**
 * The invariant that constrains every future trigger: Base UI's document-level
 * listener `preventDefault`s `contextmenu` anywhere inside a trigger subtree,
 * so a text field inside one would lose cut/copy/paste/spellcheck. Today that
 * holds by construction — the column filter sits below the header, quick-add
 * is in the body — and this is what will notice if someone moves either.
 */
test("a text field keeps the browser's own menu", async ({ page }) => {
  const addField = backlog(page).getByPlaceholder("Add a to-do");
  await addField.click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});
