import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleContactRequest } from "./routes";

const VALID_BODY = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "The board won't sync on my phone.",
  turnstileToken: "a-valid-looking-token",
};

function makeRequest(body: unknown): Request {
  return new Request("https://myfaite.app/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.1" },
    body: JSON.stringify(body),
  });
}

function makeEnv(overrides: Partial<CloudflareEnv> = {}): CloudflareEnv {
  return {
    TURNSTILE_SECRET_KEY: "test-secret",
    CONTACT_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    EMAIL: { send: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as CloudflareEnv;
}

describe("handleContactRequest", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => fetchSpy.mockRestore());

  /**
   * The regression this ticket exists to prevent: an invalid Turnstile token
   * must be rejected BEFORE the email send path ever runs.
   */
  it("REGRESSION: rejects an invalid Turnstile token before sending any email", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    const env = makeEnv();

    const res = await handleContactRequest(makeRequest(VALID_BODY), env);

    expect(res.status).toBe(403);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it("rejects a missing Turnstile token before sending any email", async () => {
    const env = makeEnv();
    const withoutToken = { name: VALID_BODY.name, email: VALID_BODY.email, message: VALID_BODY.message };

    const res = await handleContactRequest(makeRequest(withoutToken), env);

    expect(res.status).toBe(400);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends when Turnstile verifies, with the submitter's address in Reply-To and never as From", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const env = makeEnv();

    const res = await handleContactRequest(makeRequest(VALID_BODY), env);

    expect(res.status).toBe(200);
    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);
    const sent = (env.EMAIL.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.replyTo).toBe("ada@example.com");
    expect(sent.from).toEqual({ email: "noreply@myfaite.app", name: "Faite" });
    expect(sent.to).toBe("support@myfaite.app");
  });

  it("never echoes the submission back in the response", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const env = makeEnv();

    const res = await handleContactRequest(makeRequest(VALID_BODY), env);
    const body = await res.json();

    expect(JSON.stringify(body)).not.toContain(VALID_BODY.message);
    expect(JSON.stringify(body)).not.toContain(VALID_BODY.email);
  });

  it("rejects once the per-IP rate limit is exceeded, before touching Turnstile or the body", async () => {
    const env = makeEnv({
      CONTACT_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
    } as Partial<CloudflareEnv>);

    const res = await handleContactRequest(makeRequest(VALID_BODY), env);

    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it("500s configured-off (no secret) as a config state, distinct from a runtime failure", async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: "" } as Partial<CloudflareEnv>);

    const res = await handleContactRequest(makeRequest(VALID_BODY), env);

    expect(res.status).toBe(501);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    const env = makeEnv();
    const res = await handleContactRequest(
      new Request("https://myfaite.app/api/contact", { method: "GET" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});
