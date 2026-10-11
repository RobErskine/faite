import type { APIRequestContext, Page, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect, addTodo, todoCard } from "../support/server";

/**
 * API keys and the public REST API, end to end (EI-358): a key minted in the
 * browser, used as a bearer token, against the same account the browser is
 * signed in to. Route-level dispatch and status codes already have vitest
 * coverage (EI-304); this is the round trip a user actually makes — and the
 * proof that a REST write reaches an open board, which no unit test can show.
 *
 * Every REST call goes through a FRESH request context (`apiClient`), never
 * `page.request`: with no bearer, /api/v1 falls back to the cookie session
 * (src/server/auth-scopes.ts), so a shared-cookie context would turn "no key"
 * and "revoked key" into 200s and these assertions into lies.
 *
 * The key is never logged or written anywhere — it lives in a variable for
 * the length of one test, against a throwaway local account.
 */

const CONVERGE = { timeout: 20_000 };

/** Mints a key through Settings → API Keys and returns the raw value, which
 * the reveal dialog shows exactly once. */
async function createApiKey(page: Page, name: string, { write }: { write: boolean }) {
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

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
}

/** A request context with no cookies, optionally carrying a bearer key. */
async function apiClient(playwright: PlaywrightWorkerArgs["playwright"], key?: string) {
  return playwright.request.newContext({
    baseURL: "http://localhost:8787",
    extraHTTPHeaders: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

async function titles(api: APIRequestContext): Promise<string[]> {
  const response = await api.get("/api/v1/todos?status=open");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { title: string }[]).map((todo) => todo.title);
}

test("a read-write key round-trips: REST writes reach the open board, board writes reach REST", async ({
  page,
  playwright,
  // Not read, but required: fixtures are lazy, and `account` is the one that
  // signs up and opens the board. Without it `page` stays on about:blank.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  account,
}) => {
  const key = await createApiKey(page, "E2E read-write", { write: true });
  await closeSettings(page);
  const api = await apiClient(playwright, key);

  try {
    // Board → REST.
    await addTodo(page, "Made on the board");
    await expect.poll(() => titles(api), CONVERGE).toContain("Made on the board");

    // REST → board, live: every v1 write pushes through the Durable Object,
    // which tells the board's WebSocket to pull. No reload.
    const created = await api.post("/api/v1/todos", { data: { title: "Made through the API" } });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await expect(todoCard(page, "Made through the API")).toBeVisible(CONVERGE);

    const renamed = await api.patch(`/api/v1/todos/${id}`, { data: { title: "Renamed through the API" } });
    expect(renamed.status()).toBe(200);
    await expect(todoCard(page, "Renamed through the API")).toBeVisible(CONVERGE);

    const done = await api.patch(`/api/v1/todos/${id}`, { data: { status: "done" } });
    expect(done.status()).toBe(200);
    // Completed to-dos leave the board (`visibleStatuses` defaults to open).
    await expect(todoCard(page, "Renamed through the API")).toHaveCount(0, CONVERGE);

    expect((await api.delete(`/api/v1/todos/${id}`)).status()).toBe(204);
    expect((await api.get(`/api/v1/todos/${id}`)).status()).toBe(404);
  } finally {
    await api.dispose();
  }
});

test("a read-only key reads but cannot write, and stops working once revoked", async ({
  page,
  playwright,
  // Not read, but required: fixtures are lazy, and `account` is the one that
  // signs up and opens the board. Without it `page` stays on about:blank.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  account,
}) => {
  await addTodo(page, "Visible to a read-only key");
  const key = await createApiKey(page, "E2E read-only", { write: false });
  const api = await apiClient(playwright, key);
  const anonymous = await apiClient(playwright);

  try {
    await expect.poll(() => titles(api), CONVERGE).toContain("Visible to a read-only key");

    const write = await api.post("/api/v1/todos", { data: { title: "Should not exist" } });
    expect(write.status()).toBe(403);
    expect(await write.json()).toEqual({ error: "insufficient-scope" });

    expect((await anonymous.get("/api/v1/todos")).status()).toBe(401);

    // Revoke from the same Settings panel: two clicks, by design.
    await page.getByRole("button", { name: "Revoke E2E read-only" }).click();
    await page.getByRole("button", { name: "Really revoke" }).click();
    await expect(page.getByText('Revoked "E2E read-only"')).toBeVisible();

    const revoked = await api.get("/api/v1/todos");
    expect(revoked.status()).toBe(401);
    expect(await revoked.json()).toEqual({ error: "unauthenticated" });
  } finally {
    await api.dispose();
    await anonymous.dispose();
  }
});
