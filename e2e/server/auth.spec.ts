import type { Page } from "@playwright/test";
import { test, expect, addTodo, expectOnServer, signIn, todoCard } from "../support/server";

/**
 * The account lifecycle in a real browser against the real auth server
 * (EI-356): signup, a session that survives a reload, sign-out, sign-in, and
 * the local-first path still on offer to a signed-out visitor.
 *
 * "Signed in" is asserted against the server (`/api/auth/get-session`), not
 * only the UI: the board renders the same whether or not a session exists, so
 * a UI-only check could pass with the account silently gone.
 */

async function sessionEmail(page: Page): Promise<string | null> {
  const response = await page.request.get("/api/auth/get-session");
  const body = (await response.json()) as { user?: { email?: string } } | null;
  return body?.user?.email ?? null;
}

async function logOut(page: Page) {
  // `^Account`: the trigger's name gains ", N possible duplicates" (EI-346).
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
}

test("signup logs straight in, and the session survives a full reload", async ({
  page,
  account,
}) => {
  expect(await sessionEmail(page)).toBe(account.email);

  await page.reload();
  await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible({ timeout: 15_000 });
  expect(await sessionEmail(page)).toBe(account.email);
  // Signed in, so the signed-out nudges stay away.
  await expect(page.getByRole("dialog", { name: "Welcome to Faite" })).toHaveCount(0);
});

test("sign-out clears the device, and signing back in restores the account's to-dos", async ({
  page,
  account,
}) => {
  const title = "Survives a sign-out";
  await addTodo(page, title);
  // On the server before signing out — otherwise sign-out stops on "Sign out
  // with unsaved changes?" and this test would be about that dialog instead.
  await expectOnServer(page, title);

  await logOut(page);
  // `finishSignOut` (app-header.tsx) wipes IndexedDB, then leaves for `/`.
  // "commit", not the default "load": `/` is the homepage with the WebGL
  // room, and letting it render costs every parallel test CPU for nothing.
  await page.waitForURL((url) => url.pathname === "/", { waitUntil: "commit" });
  expect(await sessionEmail(page)).toBeNull();

  // Signed out, /board is the local-first app again: the welcome dialog offers
  // the no-account path, and the account's to-do is gone from this device.
  await page.goto("/board");
  await page.getByRole("button", { name: "Continue without an account" }).click({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible();
  await expect(todoCard(page, title)).toHaveCount(0);

  await signIn(page, account);
  expect(await sessionEmail(page)).toBe(account.email);
  await expect(todoCard(page, title)).toBeVisible({ timeout: 20_000 });
});

test("a signed-out visitor to /board can still use Faite without an account", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByRole("dialog", { name: "Welcome to Faite" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Continue without an account" }).click();
  await expect(page.getByRole("region", { name: "Overflow" })).toBeVisible();
  expect(await sessionEmail(page)).toBeNull();

  // The local-first board works with no server account behind it.
  await addTodo(page, "Local only");
});
