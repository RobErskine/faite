const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Server-side Turnstile verification — the step that actually matters. The
 * client-side widget only proves the browser can run and pass a challenge;
 * without this call, POSTing straight to `/api/contact` with a fabricated
 * token would sail through. See
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *
 * Tokens are single-use and expire 300s after issuance — a replayed or stale
 * token fails here the same as a fabricated one, which is why the client
 * must reset the widget after any failed submit rather than retrying with
 * the same token.
 */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  remoteIp: string | undefined,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (error) {
    // A network failure talking to Cloudflare's own siteverify endpoint is
    // not the submitter's fault, but it must still fail closed — the whole
    // point of this check is that an unverified token never reaches the
    // send path below.
    console.error("[contact] turnstile siteverify request failed", error);
    return false;
  }
}
