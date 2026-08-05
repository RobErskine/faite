/**
 * Transactional email over the Cloudflare Email Service binding.
 *
 * Two situations deliberately degrade to a console log rather than throwing,
 * because in both the alternative is a 500 on a signup or password-reset
 * request that is otherwise fine:
 *
 * 1. **Local development.** The `send_email` binding does not deliver under
 *    `wrangler dev` unless the binding carries `"remote": true`, and we do not
 *    want local dev sending real mail by default. The message body — including
 *    the reset/verification URL — goes to the worker console instead, so the
 *    flow stays testable end to end without a mailbox.
 * 2. **`E_SENDER_NOT_VERIFIED` anywhere.** The sending domain was not onboarded
 *    yet when this was written; keeping the fallback means a future domain
 *    change cannot hard-fail auth while DNS propagates.
 *
 * Every other failure (rate limits, delivery errors, malformed payloads) still
 * throws in production, where a silently dropped password-reset would be worse
 * than a visible error.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = { email: "noreply@myfaite.app", name: "Faite" };

function logInstead(reason: string, input: SendEmailInput): void {
  console.warn(
    `[email] ${reason} — logging instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}\n${input.text}`,
  );
}

export async function sendEmail(
  env: CloudflareEnv,
  input: SendEmailInput,
  /**
   * Whether this request arrived on localhost. Passed in from `createAuth`
   * rather than read from `NEXTJS_ENV` here, so the "can this actually send"
   * decision cannot disagree with the origin the request came in on.
   */
  isLocal = false,
): Promise<void> {
  try {
    await env.EMAIL.send({ ...input, from: FROM });
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: string }).code : undefined;

    if (code === "E_SENDER_NOT_VERIFIED") {
      logInstead("sending domain not onboarded to Email Sending", input);
      return;
    }
    if (isLocal) {
      logInstead(`local dev cannot send (${code ?? "unknown error"})`, input);
      return;
    }
    throw error;
  }
}
