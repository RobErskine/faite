import { describe, expect, it } from "vitest";
import { corsHeaders, handleOptions, withCors } from "./cors";

const DEV = "http://localhost:3000";
const PREVIEW = "http://localhost:8787";

function headersOf(value: HeadersInit): Record<string, string> {
  return Object.fromEntries(new Headers(value).entries());
}

function preflight(origin: string | null): Response {
  return handleOptions(
    new Request(`${PREVIEW}/api/auth/sign-in/email`, {
      method: "OPTIONS",
      headers: origin ? { Origin: origin } : {},
    }),
  );
}

describe("corsHeaders", () => {
  it("echoes an allow-listed origin, never a wildcard", () => {
    const headers = headersOf(corsHeaders(DEV));
    // `*` is illegal with `credentials: "include"`, which both the Better Auth
    // client and `src/lib/sync/transport.ts` send.
    expect(headers["access-control-allow-origin"]).toBe(DEV);
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(headers["vary"]).toBe("Origin");
  });

  it("returns nothing for an origin off the allow-list", () => {
    expect(corsHeaders("https://evil.com")).toEqual({});
    expect(corsHeaders("https://myfaite.app.evil.com")).toEqual({});
    expect(corsHeaders("null")).toEqual({});
  });

  it("returns nothing when there is no Origin header", () => {
    // Same-origin GETs and curl send none. Absent is not hostile — it just
    // means CORS has no part to play.
    expect(corsHeaders(null)).toEqual({});
  });
});

describe("handleOptions — the preflight that sign-in depends on", () => {
  /**
   * REGRESSION: `/api/auth/*` used to fall straight through to Better Auth,
   * which has no OPTIONS route, so the preflight 404'd with no headers and
   * every cross-origin sign-in died as "Failed to fetch" — the exact symptom
   * of running `next dev` on :3000 against `npm run preview` on :8787.
   */
  it("answers 204 with the headers a credentialed JSON POST needs", () => {
    const response = preflight(DEV);
    const headers = Object.fromEntries(response.headers.entries());

    expect(response.status).toBe(204);
    expect(headers["access-control-allow-origin"]).toBe(DEV);
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(headers["access-control-allow-methods"]).toContain("POST");
    // The header that makes it a preflight rather than a simple request.
    expect(headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("grants a hostile origin no allowance", () => {
    expect(preflight("https://evil.com").headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("withCors", () => {
  it("adds the headers without disturbing status or body", async () => {
    const original = Response.json({ error: "unauthenticated" }, { status: 401 });
    const wrapped = withCors(original, DEV);

    expect(wrapped.status).toBe(401);
    expect(await wrapped.json()).toEqual({ error: "unauthenticated" });
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe(DEV);
    expect(wrapped.headers.get("Content-Type")).toContain("application/json");
  });

  it("REGRESSION: preserves Set-Cookie — the whole point of signing in", () => {
    // Rebuilding the header list by hand instead of `new Response(body, res)`
    // loses this, and sign-in then returns 200 while setting no session.
    const original = new Response(null, {
      status: 200,
      headers: { "Set-Cookie": "better-auth.session_token=abc; Path=/; HttpOnly" },
    });

    expect(withCors(original, DEV).headers.get("Set-Cookie")).toBe(
      "better-auth.session_token=abc; Path=/; HttpOnly",
    );
  });

  it("returns the response untouched for an untrusted origin", () => {
    const original = Response.json({ ok: true });
    expect(withCors(original, "https://evil.com")).toBe(original);
    expect(withCors(original, null)).toBe(original);
  });
});
