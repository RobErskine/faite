import { test as base, expect, type Page } from "@playwright/test";
import { FROZEN_TIME } from "./fixtures";

/**
 * Fixtures for the server-backed suite (`playwright.server.config.ts`,
 * docs/E2E.md §10). The local-first `fixtures.ts` enters every test through
 * "Continue without an account"; these enter through a real account instead.
 *
 * Every test signs up its OWN account through the app's own `/signup` page —
 * never a raw D1 insert (raw seed writes caused EI-68), and never an account
 * shared between tests, so specs can run in parallel against one local D1
 * that is never reset.
 */

export type Account = { name: string; email: string; password: string };

/** A unique address per call. `example.com` is reserved (RFC 2606), so even a
 * misconfigured worker that really sends mail cannot reach a person. */
export function freshAccount(): Account {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { name: "E2E User", email: `e2e-${id}@example.com`, password: `e2e-pass-${id}` };
}

/**
 * Waits for the signed-in board to finish booting. Overflow is the region
 * every layout renders first (see `fixtures.ts`), so it stands for
 * "bootstrap is done".
 */
async function expectBoard(page: Page) {
  await expect(page).toHaveURL(/\/board/, { timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible({ timeout: 15_000 });
}

/** Signs up through `/signup`. Locally that logs straight in — `LOCAL_DEV=1`
 * turns verification off (EI-215) — so this lands on `/board`. */
export async function signUp(page: Page, account: Account) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(account.name);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Fail with the fix, not a 15s timeout, when the worker does not know it
  // is local and asks for a verification email that will never arrive.
  const board = page.getByRole("region", { name: "Overflow" });
  const verify = page.getByRole("heading", { name: "Check your email" });
  await expect(board.or(verify)).toBeVisible({ timeout: 15_000 });
  if (await verify.isVisible()) {
    throw new Error(
      'Signup asked for email verification: the worker does not know it is local (EI-215). ' +
        'Add LOCAL_DEV="1" to .dev.vars (`npm run dev:bootstrap` does it) and restart the preview.',
    );
  }
  await expectBoard(page);
}

/** Signs in through `/login` and waits for the board. */
export async function signIn(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectBoard(page);
}

export const test = base.extend<{ account: Account }>({
  // Same frozen instant as the local-first suite: the board is date-relative,
  // so a spec that names a column ("Tuesday") needs a fixed today.
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(FROZEN_TIME));
    await use(page);
  },
  account: async ({ page }, use) => {
    const account = freshAccount();
    await signUp(page, account);
    await use(account);
  },
});

export { expect };
