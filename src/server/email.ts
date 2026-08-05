/**
 * Transactional email over the Cloudflare Email Service binding (D3b).
 *
 * `myfaite.app` is not yet onboarded to Email Sending (DNS has to move to
 * Cloudflare first), so every send is wrapped: once the domain verifies,
 * `env.EMAIL.send()` starts delivering for real with no code change here. Until
 * then, `E_SENDER_NOT_VERIFIED` falls back to logging the content — including
 * the reset/verification URL — so auth flows stay testable without DNS.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM = { email: "noreply@myfaite.app", name: "Faite" };

export async function sendEmail(
  env: CloudflareEnv,
  input: SendEmailInput,
): Promise<void> {
  try {
    await env.EMAIL.send({ ...input, from: FROM });
  } catch (error) {
    const code = error instanceof Error ? (error as { code?: string }).code : undefined;
    if (code === "E_SENDER_NOT_VERIFIED") {
      console.warn(
        `[email] myfaite.app not yet onboarded to Email Sending — logging instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}\n${input.text}`,
      );
      return;
    }
    throw error;
  }
}
