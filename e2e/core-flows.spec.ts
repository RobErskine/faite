import { test, expect } from "./support/fixtures";

/**
 * Cross-viewport functional contract — runs on every project in
 * playwright.config.ts (desktop, tablet, phone portrait/landscape).
 *
 * The board has no responsive layout yet, so every project renders the same
 * desktop DOM today; the point of running these here, before any mobile work
 * lands, is to lock in the functional behaviour (not the layout) that must
 * survive both the P2 extraction and the P3 phone shell. Once P3 ships a
 * real phone layout, these same assertions are what prove the new shell
 * didn't just change the chrome around a broken feature.
 */

test("quick-add creates a todo and the row checkbox completes it", async ({ page }) => {
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "Buy stamps";

  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  // `exact: true`: the row's drag grip (todo-card.tsx) carries an
  // aria-label of "Drag to reschedule or reorder <title>", which a
  // substring match on `title` alone also resolves to.
  const card = page.getByRole("button", { name: title, exact: true });
  await expect(card).toBeVisible();

  // Complete via the row checkbox — no sheet involved. Matched by a regex,
  // not the exact label: the accessible name flips between "Mark … done" and
  // "Mark … not done" (todo-card.tsx) the instant the click lands, so a
  // locator pinned to the pre-click name would stop matching anything.
  await page.getByRole("checkbox", { name: new RegExp(title) }).click();

  // `Settings.visibleStatuses` defaults to `["open"]` only (schema.ts) — the
  // board filters a completed todo off the board immediately, so the card
  // vanishing (not a checked box staying visible) IS the assertion.
  await expect(card).toHaveCount(0);
});

test("a todo opens and deletes from the sheet footer", async ({ page }) => {
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "Return library book";

  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  const card = page.getByRole("button", { name: title, exact: true });
  await card.click();

  // Delete is the only per-row destructive action today — it lives here in
  // the sheet footer, not on the row (see the mobile plan's Decision 3: this
  // gap is why P4 adds a row action sheet rather than a swipe gesture).
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Delete" }).click();

  await expect(card).toHaveCount(0);
});

test("default tab and the ⌘K command palette are reachable", async ({ page }) => {
  // TabPill (tab-strip.tsx) renders as a plain <button>, not role="tab" —
  // the strip has no ARIA tablist semantics today.
  await expect(page.getByRole("button", { name: "My Lists", exact: true })).toBeVisible();

  await page.locator('[aria-keyshortcuts="Meta+K Control+K"]').click();
  const input = page.getByPlaceholder("Search to-dos or run a command…");
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
});

test("mod+k opens the palette from the keyboard", async ({ page }) => {
  // The app's own `detectPlatform()` (src/lib/keyboard.ts) resolves "mod" by
  // sniffing `navigator.platform`/`userAgent`, NOT the host OS running the
  // test — and every project in playwright.config.ts reports a non-mac UA
  // (`devices["Desktop Chrome"]` hardcodes a Windows UA regardless of the
  // machine it runs on; the phone presets report iOS/Android). So "mod"
  // resolves to Ctrl in every project here, unconditionally — branching on
  // `process.platform` looked right and was wrong, because it checked the
  // wrong platform.
  await page.keyboard.press("Control+K");
  const input = page.getByPlaceholder("Search to-dos or run a command…");
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
});
