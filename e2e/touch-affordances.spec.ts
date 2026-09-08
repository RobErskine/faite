import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";
import { longPressDrag } from "./support/touch";

/**
 * Tier A coverage for P1 (docs/MOBILE.md) — the two claims that phase makes:
 * hover-only reveals are visible without hovering, and touch targets are
 * comfortably tappable. `phone-*`/`tablet-*` projects only (all forced
 * `pointer: coarse` via device emulation) — which projects those are is
 * declared by their `testMatch` in playwright.config.ts, not guarded for in
 * here; see docs/E2E.md §8.
 *
 * Scope, stated honestly: `pointer-coarse:min-h-11`-style fixes that land
 * directly on the interactive element (Button, SelectTrigger, the tab pill)
 * are asserted here via `boundingBox()`. The `::after`-pseudo-element hit-
 * area expansions (Checkbox, RailHandle, SplitHandle) are NOT — Playwright's
 * `boundingBox()` measures the real element's box, not a pseudo-element's,
 * and there's no direct API for the latter. Those were verified once by
 * compiling the actual generated CSS during development (see docs/MOBILE.md
 * §3); redoing that as a `getComputedStyle(el, "::after")` E2E assertion
 * would mostly be testing that Tailwind's compiler still works, not that
 * this app's classes are correct.
 *
 * `PhoneBoard` (P3) splits Overflow (Days pager) and Backlog/the tab strip
 * (Lists pager) across two mutually-exclusive views — `switchToLists()`
 * (support/phone.ts) reaches the latter; it's a no-op on tablet/desktop,
 * which show both at once.
 */
test.describe("touch affordances", () => {
  test("hover-only reveals are visible without hovering", async ({ page }, testInfo) => {
    // Overflow's rail-collapse affordance only exists when Overflow renders
    // as a pinned rail (tablet/desktop layout) — on phone (P3) Overflow is a
    // full pager page instead, with no collapse concept at all, so there's
    // nothing to assert there. Checked in the default "Days" view, before
    // `switchToLists()` navigates away from it.
    const isPhonePortrait =
      testInfo.project.name === "phone-iphone" || testInfo.project.name === "phone-pixel";
    if (!isPhonePortrait) {
      await expect(
        page.getByRole("button", { name: "Collapse the Overflow column" }),
      ).toBeVisible();
    }

    await switchToLists(page);
    const title = "Touch-visible todo";
    await page
      .getByRole("region", { name: "Backlog" })
      .getByPlaceholder("Add a to-do")
      .fill(title);
    await page.keyboard.press("Enter");

    // Each of these is `opacity-0 group-hover:opacity-100 touch:opacity-100`
    // (or the tab/rail equivalent) — on a device that can never hover,
    // `group-hover` (gated to `@media (hover: hover)`, Tailwind v4) never
    // applies, so `touch:opacity-100` is the only thing making them visible
    // at all. No `.hover()` call anywhere in this test is the point.
    await expect(
      page.getByRole("button", { name: `Drag to reschedule or reorder ${title}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tab options for My Lists" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Drag to reorder the My Lists tab" }),
    ).toBeVisible();
  });

  test("small icon buttons meet the 44px comfortable-touch-target floor", async ({ page }) => {
    // "New tab" (tab-strip.tsx) only exists in `PhoneBoard`'s "Lists" view.
    await switchToLists(page);
    // "New tab" is `size="icon-xs"` (tab-strip.tsx) — the buttonVariants
    // entry P1 grows via `pointer-coarse:min-h-11 pointer-coarse:min-w-11`,
    // and it's on screen with no setup needed.
    const box = await page.getByRole("button", { name: "New tab" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  test("the tab pill meets the 44px floor", async ({ page }) => {
    // The tab strip (tab-strip.tsx) only exists in `PhoneBoard`'s "Lists" view.
    await switchToLists(page);
    // `pointer-coarse:min-h-11` (tab-strip.tsx) sizes the whole pill row,
    // not the label button inside it — checking the button directly would
    // only see its unpadded label height, not the tap target a thumb
    // actually gets. Locate the ancestor that carries the min-height.
    // Anchored, not exact: EI-118 appended an `sr-only` count sentence, making
    // the accessible name "My Lists, N lists with M items". See core-flows.spec.ts.
    const pillBox = await page
      .getByRole("button", { name: /^My Lists\b/ })
      .locator("xpath=ancestor::div[contains(@class,'group/tab')]")
      .boundingBox();
    expect(pillBox).not.toBeNull();
    expect(pillBox!.height).toBeGreaterThanOrEqual(44);
  });
});

/**
 * The coarse-pointer gate on right-click menus (EI-281).
 *
 * Long-press is already dnd-kit's lift here (400ms on a coarse pointer), and
 * Base UI's own long-press is a hardcoded 500ms that never cancels on drag
 * activation — so if context menus were ever enabled on touch, a still finger
 * would get a lifted card AND a menu over it. `board.tsx` disables them via
 * `ContextMenusEnabled value={!coarse}`; this is what notices if that goes.
 *
 * Held for 700ms, comfortably past both thresholds, so a menu would have had
 * every chance to appear.
 */
test("a long-press opens no context menu on a touch device", async ({ page }) => {
  // `.first()`: the visible window carries the same weekday several weeks out,
  // so "Tuesday" names five regions.
  const day = page.getByRole("region", { name: "Tuesday" }).first();
  await day.getByPlaceholder("Add a to-do").fill("Held down");
  await page.keyboard.press("Enter");

  const card = page.getByRole("button", { name: "Held down", exact: true });
  await expect(card).toBeVisible();

  const box = await card.boundingBox();
  if (!box) throw new Error("card has no box");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Same point start and end: a press-and-hold, not a drag. dnd-kit may well
  // lift and re-drop the card, which is fine and is not what this asserts.
  await longPressDrag(page, point, point, { holdMs: 700, steps: 1 });

  await expect(page.getByRole("menu")).toHaveCount(0);
});
