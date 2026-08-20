import { corsHeaders, handleOptions } from "../cors";
import { sendEmail } from "../email";
import { verifyTurnstileToken } from "./turnstile";
import { parseContactRequest } from "./validate";

/**
 * `POST /api/contact` — the contact form backend (EI-206).
 *
 * Same seam as `/api/auth/*`, `/api/sync/*`, `/api/places/*`: not a Next.js
 * Route Handler, because `output: export` (the Capacitor build target)
 * forbids one that reads `Request`. See `docs/ARCHITECTURE.md` §2.12.
 *
 * Sends to `support@myfaite.app` rather than a hardcoded personal address —
 * that mailbox already forwards to the real inbox via the literal Email
 * Routing rule EI-201 set up, so the actual destination stays zone
 * configuration, not something baked into this Worker.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

const CONTACT_DESTINATION = "support@myfaite.app";

export async function handleContactRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);
  if (request.method !== "POST") {
    return json({ error: "not-found" }, 404, corsHeaders(request.headers.get("Origin")));
  }

  const headers = corsHeaders(request.headers.get("Origin"));
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

  try {
    // Rate limit first — cheapest possible rejection, and it should apply
    // even to requests that go on to fail Turnstile or validation, or a
    // scripted attacker just switches to sending garbage bodies instead.
    const { success: withinLimit } = await env.CONTACT_RATE_LIMITER.limit({ key: ip });
    if (!withinLimit) return json({ error: "rate-limited" }, 429, headers);

    const parsed = parseContactRequest(await request.json());
    if (!parsed) return json({ error: "invalid-request" }, 400, headers);

    // Turnstile verification BEFORE anything else touches the submission —
    // see turnstile.ts. A missing or invalid token never reaches the send
    // path below.
    const secret = env.TURNSTILE_SECRET_KEY;
    if (!secret) return json({ error: "contact-not-configured" }, 501, headers);
    const verified = await verifyTurnstileToken(secret, parsed.turnstileToken, ip);
    if (!verified) return json({ error: "turnstile-failed" }, 403, headers);

    await sendEmail(env, {
      to: CONTACT_DESTINATION,
      subject: `Faite contact form: ${parsed.name}`,
      // Reply-To is the submitter's own address, never the From — see
      // sendEmail's SendEmailInput doc comment for why.
      replyTo: parsed.email,
      text: `From: ${parsed.name} <${parsed.email}>\n\n${parsed.message}`,
      html: `<p><strong>From:</strong> ${escapeHtml(parsed.name)} &lt;${escapeHtml(parsed.email)}&gt;</p><p>${escapeHtml(parsed.message).replace(/\n/g, "<br>")}</p>`,
    });

    // Never echo the submission back — that turns this into an open relay a
    // caller could use to confirm arbitrary content was accepted and sent.
    return json({ ok: true }, 200, headers);
  } catch (error) {
    console.error("contact route error", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}

/** Minimal HTML-entity escape for the handful of characters that matter in this context. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
