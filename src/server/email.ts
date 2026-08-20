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
 * 2. **`E_SENDER_NOT_VERIFIED` anywhere, including production.** The sending
 *    domain was not onboarded yet when this was written; keeping the fallback
 *    means a future domain change cannot hard-fail auth while DNS propagates.
 *    Because this branch is NOT gated on `isLocal`, it is reachable in
 *    production if sender verification ever lapses — see the redaction note
 *    on `logInstead` below, which exists specifically for this path.
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
  /**
   * Set by the contact form (EI-206) to the submitter's own address, so a
   * reply in Rob's inbox goes straight back to them. The `from` field stays
   * `noreply@myfaite.app` regardless — `allowed_sender_addresses` in
   * wrangler.jsonc only permits that one sender, and putting an arbitrary
   * visitor-supplied address in `from` is also how a contact form becomes an
   * open relay.
   */
  replyTo?: string;
}

const FROM = { email: "noreply@myfaite.app", name: "Faite" };

/**
 * `includeBody` is `isLocal`, not a constant — this fires from both the
 * local-dev branch (always local) and the `E_SENDER_NOT_VERIFIED` branch
 * (reachable in production). The body is the whole point locally: it's how a
 * developer clicks through a reset/verification link with no mailbox. In
 * production it is a **live, unexpired, unrevoked secret token** — Workers
 * Observability logs are not the right place for one, so the production case
 * logs only who and why, never the token.
 */
function logInstead(reason: string, input: SendEmailInput, includeBody: boolean): void {
  const body = includeBody ? `\n${input.text}` : "";
  console.warn(
    `[email] ${reason} — logging instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}${body}`,
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
      logInstead("sending domain not onboarded to Email Sending", input, isLocal);
      return;
    }
    if (isLocal) {
      logInstead(`local dev cannot send (${code ?? "unknown error"})`, input, true);
      return;
    }
    throw error;
  }
}
