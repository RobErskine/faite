import { test as base, expect, type Browser, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { FROZEN_TIME } from "./fixtures";
import { openSheet } from "./sheet";

/**
 * Fixtures for the server-backed suite (`playwright.server.config.ts`,
 * docs/E2E.md §10). The local-first `fixtures.ts` enters every test through
 * "Start planning" in the welcome dialog; these enter through a real account instead.
 *
 * Every test signs up its OWN account through the app's own `/signup` page —
 * never a raw D1 insert (raw seed writes caused EI-68), and never an account
 * shared between tests, so specs can run in parallel against one local D1
 * that is never reset.
 */

/** Must match `baseURL` in playwright.server.config.ts. */
export const BASE_URL = "http://localhost:8787";

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

/** Adds a to-do to Backlog through quick-add and waits for its card.
 * Desktop layout only — Backlog is not in the DOM on the phone's Days pager. */
export async function addTodo(page: Page, title: string) {
  await page.getByRole("region", { name: "Backlog" }).getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");
  await expect(todoCard(page, title)).toBeVisible();
}

/** A to-do's card. `exact`: the drag grip's label also contains the title. */
export function todoCard(page: Page, title: string) {
  return page.getByRole("button", { name: title, exact: true });
}

/** Renames a to-do through its sheet. The title commits on blur, and Enter
 * blurs it (todo-sheet.tsx), so the write happens before the sheet closes. */
export async function renameTodo(page: Page, from: string, to: string) {
  await todoCard(page, from).click();
  const title = openSheet(page).getByRole("textbox", { name: "Title" });
  await title.fill(to);
  await title.press("Enter");
  await page.keyboard.press("Escape");
  await expect(todoCard(page, to)).toBeVisible();
}

/**
 * A second client on the same account: its own browser context (own cookies,
 * own IndexedDB), signed in through `/login`. It can only learn about the
 * first client's writes from the server. Close it with `.context().close()`.
 */
export async function openSecondClient(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FROZEN_TIME));
  await signIn(page, account);
  return page;
}

/**
 * Waits until the server holds a change that contains `text`. Polls the sync
 * API through `page.request` (it carries the page's cookies) rather than
 * waiting on a `/api/sync/push` response: the engine pushes over the
 * WebSocket when one is open, so the HTTP route may never be hit.
 */
export async function expectOnServer(page: Page, text: string) {
  await expect
    .poll(async () => (await page.request.get("/api/sync/pull")).text(), { timeout: 20_000 })
    .toContain(text);
}

/** Mints a key through Settings → API Keys and returns the raw value, which
 * the reveal dialog shows exactly once. */
export async function createApiKey(page: Page, name: string, { write }: { write: boolean }) {
  // The reveal dialog keeps "Done" disabled until the key is copied, so the
  // copy has to really happen.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "API Keys" }).click();

  await page.getByRole("textbox", { name: "Create a key" }).fill(name);
  if (write) await page.getByRole("checkbox", { name: /^Write/ }).check();
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const reveal = page.getByRole("dialog", { name: "Your new API key" });
  const key = await reveal.getByRole("textbox").inputValue();
  expect(key.length).toBeGreaterThan(20);
  await reveal.getByRole("button", { name: "Copy key" }).click();
  await reveal.getByRole("button", { name: "Done" }).click();
  await expect(reveal).toHaveCount(0);
  return key;
}

export async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
}

/** A request context with no cookies, optionally carrying a bearer key. */
export async function apiClient(playwright: PlaywrightWorkerArgs["playwright"], key?: string) {
  return playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

export const test = base.extend<{ account: Account }>({
  // Same frozen instant as the local-first suite: the board is date-relative,
  // so a spec that names a column ("Tuesday") needs a fixed today.
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date(FROZEN_TIME));
    await use(page);
  },
  // Lazy, like every Playwright fixture: a test that needs a signed-in board
  // must name `account`, even if it never reads it. Without it the sign-up
  // never runs and `page` stays on about:blank — the failure then looks like
  // a missing button, not a missing fixture.
  account: async ({ page }, use) => {
    const account = freshAccount();
    await signUp(page, account);
    await use(account);
  },
});

export { expect };
