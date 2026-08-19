import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";

/**
 * Cross-viewport functional contract — runs on every project in
 * playwright.config.ts (desktop, tablet, phone portrait/landscape).
 *
 * Written before P3's phone shell existed, to lock in behaviour (not
 * layout) that had to survive both the P2 extraction and P3 landing.
 * `PhoneBoard` genuinely differs from `DesktopBoard` now — it shows exactly
 * one of its two pagers at a time, defaulting to "Days" — so a few of these
 * tests need `switchToLists()` (support/phone.ts) to reach Backlog/the tab
 * strip at all. The point stands either way: these assertions are what
 * prove the new shell didn't just change the chrome around a broken
 * feature.
 */

test("quick-add creates a todo and the row checkbox completes it", async ({ page }) => {
  await switchToLists(page);
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
  await switchToLists(page);
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
  await switchToLists(page);
  // TabPill (tab-strip.tsx) renders as a plain <button>, not role="tab" —
  // the strip has no ARIA tablist semantics today. Its accessible name is
  // "My Lists, N lists with M items": EI-118 appended an `sr-only` count
  // sentence, so `exact` no longer matches. Anchor instead of loosening to a
  // substring — the same pill row also carries "Tab options for My Lists" and
  // "Drag to reorder the My Lists tab", which a substring would make ambiguous.
  await expect(page.getByRole("button", { name: /^My Lists\b/ })).toBeVisible();

  // `AppHeader`'s palette trigger (app-header.tsx) has two shapes: the wide
  // desktop field (`aria-keyshortcuts="Meta+K Control+K"`, visible "Search or
  // run a command…" text + ⌘K hint) and `PhoneBoard`'s compact icon button
  // (`aria-label="Search or run a command"`, no keyboard hint — nothing to
  // hint at without a keyboard). A substring match on the shared wording
  // reaches the trigger either way without caring which shape rendered.
  await page.getByRole("button", { name: /search or run a command/i }).click();
  const input = page.getByPlaceholder("Search to-dos or run a command…");
  await expect(input).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
});

test("a todo's History section logs `created`, then `done` (EI-94)", async ({ page }) => {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  const title = "File expense report";

  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  const card = page.getByRole("button", { name: title, exact: true });
  await card.click();

  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();

  // Open by default (todo-sheet.tsx HistorySection) — no click needed.
  // `HISTORY_STARTS_AT` (todo-timeline.ts) must sort before this fixture's
  // frozen clock (`FROZEN_TIME`, support/fixtures.ts), or this todo would
  // render as pre-history and the count below would include a marker row
  // it isn't expecting.
  const historyList = sheet.getByRole("list", { name: /^History for/ });
  await expect(historyList.getByRole("listitem")).toHaveCount(1);

  // Marking done closes the sheet AND the default `visibleStatuses` filter
  // (`["open"]`, schema.ts) drops the card off the board — reopen through
  // ⌘K's search instead of the card, which `searchTodos` (lib/search.ts)
  // never filters by status, unlike the board.
  await sheet.getByRole("button", { name: "Mark done" }).click();
  await page.keyboard.press("Control+K");
  await page.getByPlaceholder("Search to-dos or run a command…").fill(title);
  // Anchored at the start: an unanchored substring match also resolves the
  // "Create to-do…" fallback option, which quotes the typed title too.
  await page.getByRole("option", { name: new RegExp(`^${title}`) }).click();

  // Reopening the sheet remounts HistorySection, which is open by default —
  // no click needed here either.
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("list", { name: /^History for/ }).getByRole("listitem")).toHaveCount(2);
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
