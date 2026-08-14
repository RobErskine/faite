import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Overdrive (EI-97) — the full-screen Overflow triage overlay. Runs on every
 * project in playwright.config.ts (desktop, tablet, both phone orientations,
 * Pixel), same as `core-flows.spec.ts` — the on-screen buttons this suite
 * exercises are the phone-usable path; the keyboard is exercised too since
 * Playwright can drive it on every project regardless of emulated input type.
 *
 * Seeds through the real Settings → Developer → Seed Overflow button rather
 * than a private back door, so these specs exercise the same path a person
 * does (see `src/lib/dev-seed.ts`, `EI-99`).
 */

async function openDeveloperSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: /developer/i }).click();
}

/** Seeds `count` backdated to-dos into Overflow and closes Settings again. */
async function seedOverflow(page: Page, count = 10): Promise<void> {
  await openDeveloperSettings(page);
  if (count !== 10) {
    await page.getByLabel(/number of to-dos to seed/i).fill(String(count));
  }
  await page
    .getByRole("button", { name: new RegExp(`seed overflow \\(${count}\\)`, "i") })
    .click();
  const toast = page.getByText(new RegExp(`seeded ${count} to-dos into overflow`, "i"));
  await expect(toast).toBeVisible();
  await page.keyboard.press("Escape"); // close Settings
  // On the narrow phone viewport the toast (bottom-right) sits directly over
  // the Overdrive button (bottom-left rail) — wait for sonner's own auto-
  // dismiss so the very next click in a test never races it.
  await expect(toast).toBeHidden({ timeout: 10_000 });
}

const overdriveButton = (page: Page) => page.getByRole("button", { name: /overdrive/i });
const overlay = (page: Page) => page.getByRole("dialog", { name: /overdrive/i });
/**
 * The exit ghost (round 2) is a full `OverdriveCard` clone of the card that
 * was just decided — same title, same "N of M" progress line — mounted
 * `aria-hidden` alongside the real one for the ~200ms it takes to animate
 * out. `.animate-in` is the wrapper class only the REAL, currently active
 * card carries (the ghost's is `.animate-out`), so scoping every card-
 * content query to it is what keeps these locators resolving to exactly one
 * element regardless of whether a ghost happens to be mid-flight.
 */
const activeCard = (page: Page) => overlay(page).locator(".animate-in");
const cardTitle = (page: Page) => activeCard(page).locator("h2");
const progress = (page: Page) => activeCard(page).getByText(/^\d+ of \d+$/);

test("the entry button appears only once the pile is worth a dedicated mode", async ({
  page,
}) => {
  await expect(overdriveButton(page)).toHaveCount(0);

  await seedOverflow(page, 4); // below OVERDRIVE_MIN_TODOS (5)
  await expect(overdriveButton(page)).toHaveCount(0);

  await seedOverflow(page, 1); // 4 + 1 = 5, exactly at threshold
  await expect(overdriveButton(page)).toBeVisible();
  await expect(overdriveButton(page)).toHaveText(/overdrive.*5/i);
});

test("walking the whole queue by keyboard reaches a finish screen whose tally matches", async ({
  page,
}) => {
  await seedOverflow(page, 10);
  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  for (let i = 0; i < 10; i++) {
    await expect(progress(page)).toHaveText(`${i + 1} of 10`);
    await page.keyboard.press("ArrowLeft"); // won't do, every card
  }

  await expect(overlay(page).getByText("Cleared 10")).toBeVisible();
  await expect(overlay(page).getByText(/10 won.t do/i)).toBeVisible();
  await overlay(page).getByRole("button", { name: "Done" }).click();
  await expect(overlay(page)).toHaveCount(0);
  // Every card was dropped, so the pile is gone — the button goes with it.
  await expect(overdriveButton(page)).toHaveCount(0);
});

test("→ → Enter schedules the card onto tomorrow's day column", async ({ page }) => {
  await seedOverflow(page, 10);
  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  const title = await cardTitle(page).textContent();
  expect(title).toBeTruthy();

  await page.keyboard.press("ArrowRight");
  await expect(overlay(page).getByText("Today")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(overlay(page).getByText("Tomorrow")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(progress(page)).toHaveText("2 of 10");
  await page.keyboard.press("Escape"); // nothing staged on card 2 — exits
  await expect(overlay(page)).toHaveCount(0);

  // FROZEN_TIME (fixtures.ts) is 2026-08-11 (Tuesday) — tomorrow is
  // 2026-08-12. Each day column's subtitle ("Aug 12, 2026") is unique across
  // the whole board, unlike its weekday name ("Wednesday"), which repeats
  // every seven columns — filtering the region by that subtitle is what
  // stays unambiguous regardless of how many weeks are rendered.
  const tomorrow = page.getByRole("region").filter({ has: page.getByText("Aug 12, 2026") });
  await expect(tomorrow.getByText(title!, { exact: true })).toBeVisible();
});

test("→ alone writes nothing — Esc leaves the card exactly where it was", async ({ page }) => {
  await seedOverflow(page, 10);
  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  const title = await cardTitle(page).textContent();

  await page.keyboard.press("ArrowRight");
  await expect(overlay(page).getByText("Today")).toBeVisible();
  await page.keyboard.press("Escape"); // clears the stage, does not exit
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page).getByText("Today")).toHaveCount(0);
  await page.keyboard.press("Escape"); // nothing staged now — exits
  await expect(overlay(page)).toHaveCount(0);

  await expect(
    page.getByRole("region", { name: "Overflow" }).getByText(title!, { exact: true }),
  ).toBeVisible();
});

test("⌫ returns the previous card and reverses its write", async ({ page }) => {
  await seedOverflow(page, 10);
  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  const firstTitle = await cardTitle(page).textContent();
  await page.keyboard.press("ArrowLeft"); // drops the first card, advances
  await expect(progress(page)).toHaveText("2 of 10");

  await page.keyboard.press("Backspace");
  await expect(progress(page)).toHaveText("1 of 10");
  await expect(cardTitle(page)).toHaveText(firstTitle!);

  // Stepping back with nothing decided yet is a no-op, not an error.
  await page.keyboard.press("Backspace");
  await expect(progress(page)).toHaveText("1 of 10");
});

test("a card flicks away, and only once that finishes can the next one be acted on (round 3/4)", async ({
  page,
}) => {
  await seedOverflow(page, 10);

  /*
    Stretch the exit animation so the mid-flick window is wide enough to
    assert against deterministically. At its real ~320ms, the three
    sequential auto-retrying assertions below each cost a round trip, and
    the last of them could legitimately land after the flick had already
    ended — a flaky test about correct behaviour, not a real failure.

    This is also the sharpest regression test for round 4's fix. The flick
    now ends on the card's OWN `animationend`, so a 3s animation means a 3s
    block; the previous implementation, which advanced on a fixed ~340ms
    wall-clock timer started at dispatch, would have moved on to the next
    card long before any of these assertions ran. Only `.animate-out` is
    touched — the incoming card's `.animate-in` keeps its real duration.
  */
  await page.addStyleTag({ content: ".animate-out { animation-duration: 3s !important; }" });

  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  const firstTitle = await cardTitle(page).textContent();
  await page.keyboard.press("ArrowLeft");

  // Mid-flick: the outgoing card is still the one on screen, animating —
  // the queue has not advanced, and every key/button is inert.
  const flicking = overlay(page).locator(".animate-out");
  await expect(flicking).toBeVisible();
  await expect(flicking).toContainText(firstTitle!);
  await expect(overlay(page).getByRole("button", { name: /won.t do/i })).toBeDisabled();

  await page.keyboard.press("ArrowUp"); // must be swallowed, not queued
  await page.keyboard.press("Backspace"); // ditto
  await expect(flicking).toContainText(firstTitle!); // still the outgoing card

  // Once it settles: the second card is the current, fully interactive one
  // — nothing from the two ignored presses above leaked through.
  await expect(progress(page)).toHaveText("2 of 10", { timeout: 10_000 });
  await expect(overlay(page).getByRole("button", { name: /won.t do/i })).toBeEnabled();
});

test("the on-screen buttons drive the whole flow, not just the keyboard", async ({ page }) => {
  // The phone build has no hardware keyboard — every verdict has to be
  // reachable by tapping alone, so this test never touches `page.keyboard`.
  await seedOverflow(page, 10);
  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  await overlay(page).getByRole("button", { name: /won.t do/i }).click();
  await expect(progress(page)).toHaveText("2 of 10");

  await overlay(page).getByRole("button", { name: "Schedule" }).click();
  await expect(overlay(page).getByText("Today")).toBeVisible();
  await overlay(page).getByRole("button", { name: /confirm/i }).click();
  await expect(progress(page)).toHaveText("3 of 10");

  await overlay(page).getByRole("button", { name: /^Back to/ }).click();
  await expect(progress(page)).toHaveText("4 of 10");

  await overlay(page).getByRole("button", { name: "Done", exact: true }).click();
  await expect(progress(page)).toHaveText("5 of 10");
});

test("Esc part-way leaves the undecided remainder in Overflow", async ({ page }) => {
  await seedOverflow(page, 10);
  await overdriveButton(page).click();
  await expect(overlay(page)).toBeVisible();

  // One at a time, each waited out — the flick (round 3) genuinely blocks
  // every action until it finishes, so a second press fired immediately
  // after the first would land mid-flight and correctly do nothing.
  await page.keyboard.press("ArrowLeft");
  await expect(progress(page)).toHaveText("2 of 10");
  await page.keyboard.press("ArrowLeft");
  await expect(progress(page)).toHaveText("3 of 10");

  await page.keyboard.press("Escape"); // nothing staged — exits immediately
  await expect(overlay(page)).toHaveCount(0);

  await expect(overdriveButton(page)).toHaveText(/overdrive.*8/i);
});
