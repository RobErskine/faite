import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, apiClient, closeSettings, todoCard } from "../support/server";
import { openSheet } from "../support/sheet";

/**
 * Email → Backlog, end to end on the real Workers runtime (EI-361,
 * docs/EMAIL-INGEST.md). The unit tests fake the two D1 calls; this runs the
 * real D1 lookup, the real `push()` into the user's Durable Object, and the
 * live update of a board that is already open — the one thing only an
 * end-to-end test can show.
 *
 * **How a message gets in locally.** `wrangler dev` delivers a raw RFC 5322
 * message to the Worker's `email()` handler at `/cdn-cgi/handler/email`
 * (the same endpoint `scripts/email-smoke/send.mjs` uses). It answers 200 when
 * the handler accepted the message and **400 "Worker rejected email…"** when
 * it called `setReject()` — on wrangler 4.149; older versions said 200 for
 * both.
 *
 * The message is written by hand: postal-mime only PARSES (it is what the
 * Worker uses to read this), and a plain-text message needs no builder.
 *
 * **Privacy.** The address is the only credential (EMAIL-INGEST.md): it
 * stays in a variable and is never logged. The sender is an `example.com`
 * address and the content is invented.
 */

const SENDER = "sender@example.com";

/** A minimal RFC 5322 message. `Message-ID` is required — the local endpoint
 * refuses a message without one. */
function rawEmail({ to, subject, body }: { to: string; subject: string; body: string }): string {
  return [
    `From: "E2E Sender" <${SENDER}>`,
    `To: ${to}`,
    `Message-ID: <e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com>`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
}

/** Hands a message to the Worker's email handler, as Email Routing would. */
async function deliver(api: APIRequestContext, to: string, subject: string) {
  return api.post("/cdn-cgi/handler/email", {
    params: { from: SENDER, to },
    headers: { "Content-Type": "message/rfc822" },
    data: rawEmail({ to, subject, body: "Invented body text for an end-to-end test." }),
  });
}

/** Creates the account's capture address in Settings → Email capture and
 * returns it. */
async function createCaptureAddress(page: Page): Promise<string> {
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Email capture" }).click();
  await page.getByRole("button", { name: "Create my address" }).click();
  const field = page.getByRole("textbox", { name: "Your capture address" });
  await expect(field).toHaveValue(/@in\.myfaite\.app$/);
  return field.inputValue();
}

test("an email to the account's capture address lands in Backlog on the open board, with its source", async ({
  page,
  playwright,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- lazy fixture: signs up and opens the board
  account,
}) => {
  const address = await createCaptureAddress(page);
  await closeSettings(page);

  // No cookies and no key: the address alone is the credential.
  const mail = await apiClient(playwright);
  try {
    const subject = "Renew the library card";
    const response = await deliver(mail, address, subject);
    expect(response.status(), await response.text()).toBe(200);

    // Live, no reload: only `UserDurableObject.push()` sends the WebSocket
    // `changed` message that makes the open board pull.
    const backlog = page.getByRole("region", { name: "Backlog" });
    await expect(backlog.getByRole("button", { name: subject, exact: true })).toBeVisible({ timeout: 20_000 });

    // The source blob round-tripped through sync and renders as a badge.
    await todoCard(page, subject).click();
    await expect(openSheet(page).getByText("From email")).toBeVisible();
    await expect(openSheet(page).getByText(SENDER)).toBeVisible();
  } finally {
    await mail.dispose();
  }
});

test("mail to an unknown capture address or another domain is rejected", async ({ playwright }) => {
  const mail = await apiClient(playwright);
  try {
    // 16 characters of Crockford base32, like a real local part, never issued.
    const unknown = await deliver(mail, "0000000000000000@in.myfaite.app", "Should not exist");
    expect(unknown.status()).toBe(400);
    expect(await unknown.text()).toContain("Worker rejected email");

    const wrongDomain = await deliver(mail, "0000000000000000@example.com", "Should not exist");
    expect(wrongDomain.status()).toBe(400);
  } finally {
    await mail.dispose();
  }
});
