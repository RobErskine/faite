import { test as base, expect } from "@playwright/test";

/**
 * Every spec gets a board that is already seeded, on a frozen date, and past
 * first paint — see docs/E2E.md "Determinism" for why each piece exists.
 *
 * No app code was changed to make this work. `useBootstrap()`
 * (src/lib/store/hooks.ts) already seeds a Backlog list and a default tab
 * into any empty IndexedDB on boot, and Playwright gives every test a fresh,
 * isolated browser context by default — so "fresh IndexedDB" and "seeded
 * board" fall out of the app's own first-run behaviour for free. The only
 * thing this fixture adds is freezing the clock, because the board is
 * date-relative (`ctx.today`, column headers like "Tuesday").
 */

/** A Tuesday, UTC noon — clear of any DST or midnight-rounding edge. Settings
 * default `timezone` is `"UTC"` (src/lib/schema.ts), so this is also the civil
 * date `ctx.today` resolves to. */
export const FROZEN_TIME = "2026-08-11T12:00:00.000Z";

export const test = base.extend({
  page: async ({ page }, use) => {
    // `setFixedTime`, not `install`: `install()` replaces the page's real
    // timers with a virtual clock that only advances when a test explicitly
    // asks it to — and React's scheduler (plus Next's own chunk loading)
    // depends on real `setTimeout` ticking to ever get past the "Loading
    // your board…" fallback. `setFixedTime` pins `Date.now()`/`new Date()`
    // to the frozen instant and leaves every other timer running normally.
    await page.clock.setFixedTime(new Date(FROZEN_TIME));
    await page.goto("/board");

    // Every fresh IndexedDB (i.e. every test) is a first-ever boot as far as
    // the app can tell, so `WelcomeDialog` (src/components/auth/
    // welcome-dialog.tsx) always opens over the board and steals pointer
    // events from everything behind it — including the quick-add field and
    // the header's palette trigger, which is what made this failure mode so
    // confusing (the errors pointed at those, not at the dialog).
    await page
      .getByRole("button", { name: "Continue without an account" })
      .click({ timeout: 15_000 });

    // `useBootstrap()` seeds Backlog + the default tab asynchronously, and
    // the Overflow region (aria-label="Overflow" on BoardColumn's root
    // <section>) is the first thing to depend on it either way — waiting on
    // it is waiting on bootstrap being done. Overflow specifically, not
    // Backlog: `PhoneBoard` (P3) shows exactly one of its two pagers at a
    // time, defaulting to "Days" (Overflow's pager), so Backlog isn't in the
    // DOM at all until a test explicitly switches to "Lists" — see
    // `switchToLists()` in core-flows.spec.ts. Overflow is the one region
    // every layout renders unconditionally, immediately, always.
    await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible({
      timeout: 15_000,
    });
    await use(page);
  },
});

export { expect };
