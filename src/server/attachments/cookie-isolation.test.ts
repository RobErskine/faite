import { describe, expect, it } from "vitest";
import { auth } from "@/server/auth-cli";
import { fileOriginFor } from "./origin";

/**
 * The one assumption EI-244's isolation rests on.
 *
 * Attachment bytes are served from `files.myfaite.app` so a previewed PDF
 * renders in a different origin from the app. That is worth something only
 * while the session cookie cannot follow it there.
 *
 * It cannot today, because Better Auth issues a HOST-ONLY cookie — verified
 * against a running server, not inferred: `Set-Cookie:
 * better-auth.session_token=…; Max-Age=604800; Path=/; HttpOnly;
 * SameSite=Lax`, with **no `Domain=` attribute**. A host-only cookie is sent
 * to `myfaite.app` and nothing else, subdomains included.
 *
 * The residual risk of choosing a subdomain over a separate apex is that
 * this could change — someone enabling `crossSubDomainCookies` for an
 * unrelated reason would silently start delivering the session to the
 * user-content origin, and the isolation would be gone with nothing failing.
 *
 * This file is that failure.
 */
describe("the session cookie must never reach the user-content origin", () => {
  const options = (auth as unknown as { options: Record<string, unknown> }).options;

  it("does not enable cross-subdomain cookies", () => {
    const advanced = options.advanced as
      | { crossSubDomainCookies?: { enabled?: boolean } }
      | undefined;
    expect(advanced?.crossSubDomainCookies?.enabled ?? false).toBe(false);
  });

  it("does not set a cookie Domain, which is what makes it host-only", () => {
    const advanced = options.advanced as
      | { defaultCookieAttributes?: { domain?: string }; cookies?: Record<string, unknown> }
      | undefined;
    expect(advanced?.defaultCookieAttributes?.domain).toBeUndefined();

    // Belt and braces: no per-cookie override smuggles a domain back in.
    const perCookie = Object.values(advanced?.cookies ?? {}) as Array<{
      attributes?: { domain?: string };
    }>;
    for (const cookie of perCookie) {
      expect(cookie?.attributes?.domain).toBeUndefined();
    }
  });

  it("keeps the app and its bytes on genuinely different origins in production", () => {
    // If this ever returns the same origin, the cookie question stops
    // mattering because there is no isolation left to protect.
    const app = new URL("https://myfaite.app/board");
    expect(fileOriginFor(app, "https://files.myfaite.app")).not.toBe(app.origin);
  });
});
