import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email";

const INPUT = {
  to: "someone@example.com",
  subject: "Reset your Faite password",
  html: "<p>reset</p>",
  text: "Reset your password: https://myfaite.app/reset-password?token=live-secret-token",
};

function envWithSendError(code: string | undefined) {
  const error = Object.assign(new Error("send failed"), code ? { code } : {});
  return { EMAIL: { send: vi.fn().mockRejectedValue(error) } } as unknown as CloudflareEnv;
}

describe("sendEmail — logInstead redaction", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("includes the body (and the live token) in local dev — the flow is untestable without it", async () => {
    await sendEmail(envWithSendError("SOME_LOCAL_ERROR"), INPUT, true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("live-secret-token");
  });

  /**
   * The regression this guards: `E_SENDER_NOT_VERIFIED` is NOT gated on
   * `isLocal` — it can fire in production if sender verification ever
   * lapses. Before this fix, that path logged the full body, including a
   * live, unexpired password-reset/verification token, to Workers
   * Observability. It must never do that again.
   */
  it("REGRESSION: never logs the body — and never the live token — for E_SENDER_NOT_VERIFIED outside local dev", async () => {
    await sendEmail(envWithSendError("E_SENDER_NOT_VERIFIED"), INPUT, false);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).not.toContain("live-secret-token");
    expect(logged).not.toContain(INPUT.text);
    // Still logs enough to diagnose the outage: who, and why.
    expect(logged).toContain(INPUT.to);
    expect(logged).toContain("sending domain not onboarded");
  });

  it("does include the body for E_SENDER_NOT_VERIFIED when the request WAS local", async () => {
    await sendEmail(envWithSendError("E_SENDER_NOT_VERIFIED"), INPUT, true);

    expect(warn.mock.calls[0][0]).toContain("live-secret-token");
  });

  it("re-throws any other error in production rather than swallowing it", async () => {
    await expect(sendEmail(envWithSendError("SOME_OTHER_CODE"), INPUT, false)).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("sendEmail — happy path", () => {
  it("sends via the binding and logs nothing", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendEmail({ EMAIL: { send } } as unknown as CloudflareEnv, INPUT, false);

    expect(send).toHaveBeenCalledWith({ ...INPUT, from: { email: "noreply@myfaite.app", name: "Faite" } });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
