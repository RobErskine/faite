import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSource } from "@/lib/capture-source";
import type { PushEntry } from "@/lib/sync/wire";
import { RATE_LIMIT, type IngestAddressRow } from "./addresses";

/**
 * The orchestration test — the one that actually simulates a forwarded email
 * becoming a to-do (EI-186).
 *
 * `parse.test.ts` and `addresses.test.ts` cover the decisions; this covers the
 * ORDER they run in, what gets rejected, and the privacy invariants — none of
 * which are visible from a pure function. It runs the real `postal-mime`, the
 * real mapper, the real `splitRecipient`/`decideIngest`, and the real
 * `buildCreateTodoEntry` (including its `todoSchema.parse` safety net).
 *
 * **Only the two D1 calls are faked.** Everything else is the production code
 * path. `loadByLocalPart`/`markAccepted` are four trivial drizzle statements
 * that a fake D1 could only re-assert against itself; they are exercised for
 * real by `scripts/email-smoke/`.
 */
vi.mock("./addresses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./addresses")>();
  return { ...actual, loadByLocalPart: vi.fn(), markAccepted: vi.fn() };
});

const { loadByLocalPart, markAccepted } = await import("./addresses");
const { handleEmail, MAX_RAW_SIZE_BYTES } = await import("./ingest");

const DOMAIN = "in.myfaite.app";
const LOCAL_PART = "k7m2x9qp4vw8n3rt";
const USER_ID = "user-abc";

const SUBJECT = "Buy milk";
const BODY = "from the good place at the top of the hill";
const SENDER = "coach@example.com";

function mime({
  subject = SUBJECT,
  body = BODY,
  contentType = "text/plain; charset=utf-8",
}: { subject?: string; body?: string; contentType?: string } = {}): string {
  return [
    `From: "Rob" <${SENDER}>`,
    `To: ${LOCAL_PART}@${DOMAIN}`,
    "Message-ID: <t1@example.com>",
    `Subject: ${subject}`,
    `Content-Type: ${contentType}`,
    "",
    body,
  ].join("\n");
}

/** A `ForwardableEmailMessage` that counts reads of `raw`, so invariant 1
 * ("raw MIME is never persisted") can be checked as "never even touched"
 * on the paths that reject before parsing. */
function fakeMessage(raw: string, overrides: { to?: string; rawSize?: number } = {}) {
  const bytes = new TextEncoder().encode(raw);
  const state = { rawReads: 0, rejected: null as string | null };
  const message = {
    from: SENDER,
    to: overrides.to ?? `${LOCAL_PART}@${DOMAIN}`,
    rawSize: overrides.rawSize ?? bytes.length,
    headers: new Headers(),
    get raw() {
      state.rawReads++;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
    setReject(reason: string) {
      state.rejected = reason;
    },
  };
  return { message: message as unknown as ForwardableEmailMessage, state };
}

function row(overrides: Partial<IngestAddressRow> = {}): IngestAddressRow {
  return {
    id: "addr-1",
    userId: USER_ID,
    revokedAt: null,
    windowStart: null,
    windowCount: 0,
    ...overrides,
  };
}

let pushed: PushEntry[][];
let logs: string[];

function fakeEnv() {
  pushed = [];
  const stub = {
    nextTodoPosition: vi.fn(async () => "a7"),
    push: vi.fn(async (_userId: string, request: { entries: PushEntry[] }) => {
      pushed.push(request.entries);
      return {
        acked: request.entries.map((e) => e.id),
        rejected: [],
        highestVersion: 42,
        conflicts: [],
      };
    }),
  };
  const env = {
    EMAIL_INGEST_DOMAIN: DOMAIN,
    AUTH_DB: {} as D1Database,
    USER_DO: { idFromName: vi.fn(() => "do-id"), get: vi.fn(() => stub) },
  } as unknown as CloudflareEnv;
  return { env, stub };
}

beforeEach(() => {
  logs = [];
  vi.mocked(loadByLocalPart).mockReset();
  vi.mocked(markAccepted).mockReset();
  vi.spyOn(console, "log").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args) => {
    logs.push(args.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The decision recorded on the single structured log line this emits. */
function decision(): string {
  const line = logs.find((l) => l.includes("email-ingest"));
  return line ? JSON.parse(line.slice(line.indexOf("{"))).decision : "<no log line>";
}

describe("handleEmail — the happy path", () => {
  it("turns a forwarded message into one pushed todo", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env, stub } = fakeEnv();
    const { message, state } = fakeMessage(mime());

    await handleEmail(message, env);

    expect(state.rejected).toBeNull();
    expect(decision()).toBe("accepted");
    expect(stub.push).toHaveBeenCalledTimes(1);
    expect(pushed[0]).toHaveLength(1);

    const entry = pushed[0][0];
    expect(entry.kind).toBe("todo");
    const patch = entry.patch as Record<string, unknown>;
    expect(patch.title).toBe(SUBJECT);
    expect(patch.description).toBe(BODY);
    expect(patch.ownerId).toBe(USER_ID);
    expect(patch.status).toBe("open");
  });

  it("addresses the DO by the resolved user, never by anything in the message", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row({ userId: "the-real-owner" }));
    const { env, stub } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    expect(env.USER_DO.idFromName).toHaveBeenCalledWith("the-real-owner");
    expect(stub.push).toHaveBeenCalledWith("the-real-owner", expect.anything());
  });

  it("lands in Backlog by leaving listId null — it looks nothing up", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    expect((pushed[0][0].patch as Record<string, unknown>).listId).toBeNull();
  });

  it("uses the DO's position, NOT buildCreateTodoEntry's constant 'a0' fallback", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env, stub } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    expect(stub.nextTodoPosition).toHaveBeenCalledTimes(1);
    const position = (pushed[0][0].patch as Record<string, unknown>).position;
    expect(position).toBe("a7");
    expect(position).not.toBe("a0");
  });

  it("stamps a server HLC the DO can compare", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    expect(pushed[0][0].hlc).toMatch(/^[0-9a-f]{12}:[0-9a-f]{4}:server$/);
  });

  it("records provenance the badge can render", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    const source = parseSource((pushed[0][0].patch as Record<string, string>).source);
    expect(source).not.toBeNull();
    expect(source!.kind).toBe("email");
    expect(source!.email).toMatchObject({ from: SENDER, subject: SUBJECT });
  });

  it("commits the rate window before doing any of the expensive work", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row({ windowStart: null, windowCount: 0 }));
    const { env } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    expect(markAccepted).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markAccepted).mock.calls[0][2]).toEqual({
      windowStart: expect.any(Number),
      windowCount: 1,
    });
  });

  it("resolves a +tag recipient to the same address", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env, stub } = fakeEnv();
    const { message } = fakeMessage(mime(), { to: `${LOCAL_PART}+family@${DOMAIN}` });

    await handleEmail(message, env);

    expect(vi.mocked(loadByLocalPart).mock.calls[0][1]).toBe(LOCAL_PART);
    expect(stub.push).toHaveBeenCalledTimes(1);
  });
});

describe("handleEmail — rejections", () => {
  it("rejects an oversized message WITHOUT reading raw or touching D1", async () => {
    const { env, stub } = fakeEnv();
    const { message, state } = fakeMessage(mime(), { rawSize: MAX_RAW_SIZE_BYTES + 1 });

    await handleEmail(message, env);

    expect(state.rejected).toMatch(/too large/);
    expect(state.rawReads).toBe(0);
    expect(loadByLocalPart).not.toHaveBeenCalled();
    expect(stub.push).not.toHaveBeenCalled();
    expect(decision()).toBe("too-large");
  });

  it("rejects a recipient on another domain before any lookup", async () => {
    const { env } = fakeEnv();
    const { message, state } = fakeMessage(mime(), { to: `${LOCAL_PART}@evil.example` });

    await handleEmail(message, env);

    expect(state.rejected).toBe("no such recipient");
    expect(state.rawReads).toBe(0);
    expect(loadByLocalPart).not.toHaveBeenCalled();
    expect(decision()).toBe("bad-recipient");
  });

  /**
   * The oracle guard. A prober who can tell "never existed" from "existed and
   * was rotated" learns which of their guesses were once real addresses, which
   * is the only secret this feature has. The two must be indistinguishable at
   * the SMTP boundary while staying distinct in our own logs.
   */
  it("rejects unknown and revoked addresses with the IDENTICAL reason", async () => {
    const { env: env1 } = fakeEnv();
    vi.mocked(loadByLocalPart).mockResolvedValue(null);
    const unknown = fakeMessage(mime());
    await handleEmail(unknown.message, env1);
    const unknownDecision = decision();

    logs = [];
    const { env: env2 } = fakeEnv();
    vi.mocked(loadByLocalPart).mockResolvedValue(row({ revokedAt: new Date() }));
    const revoked = fakeMessage(mime());
    await handleEmail(revoked.message, env2);

    expect(unknown.state.rejected).toBe(revoked.state.rejected);
    expect(unknown.state.rejected).toBe("no such recipient");
    // ...but our own logs still tell them apart.
    expect(unknownDecision).toBe("unknown-address");
    expect(decision()).toBe("revoked-address");
  });

  it("rejects over the rate cap, and does not spend a DO round trip doing it", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row({ windowStart: Date.now(), windowCount: RATE_LIMIT }));
    const { env, stub } = fakeEnv();
    const { message, state } = fakeMessage(mime());

    await handleEmail(message, env);

    expect(state.rejected).toMatch(/not delivered/);
    expect(state.rawReads).toBe(0);
    expect(markAccepted).not.toHaveBeenCalled();
    expect(stub.nextTodoPosition).not.toHaveBeenCalled();
    expect(stub.push).not.toHaveBeenCalled();
    expect(decision()).toBe("rate-limited");
  });

  it("never throws out of the handler, whatever the storage layer does", async () => {
    vi.mocked(loadByLocalPart).mockRejectedValue(new Error(`boom while reading ${BODY}`));
    const { env } = fakeEnv();
    const { message, state } = fakeMessage(mime());

    await expect(handleEmail(message, env)).resolves.toBeUndefined();
    expect(state.rejected).toBe("could not be processed");
    expect(decision()).toBe("error");
  });

  it("bounces rather than silently dropping when the DO refuses our own entry", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env, stub } = fakeEnv();
    stub.push.mockResolvedValue({
      acked: [],
      rejected: [{ id: "x", reason: "invalid-entry" }],
      highestVersion: 0,
      conflicts: [],
    } as never);
    const { message, state } = fakeMessage(mime());

    await handleEmail(message, env);

    expect(state.rejected).toBe("could not be filed");
    expect(decision()).toBe("push-rejected");
  });
});

describe("handleEmail — parsing real MIME", () => {
  it("falls back to the html part, tag-stripped, when there is no text part", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();
    const { message } = fakeMessage(
      mime({
        body: "<html><body><p>Renew the passport</p><p>before October</p></body></html>",
        contentType: "text/html; charset=utf-8",
      }),
    );

    await handleEmail(message, env);

    expect((pushed[0][0].patch as Record<string, unknown>).description).toBe(
      "Renew the passport\nbefore October",
    );
  });

  it("caps a newsletter-sized body at 16 KB before it reaches the sync wire", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();
    const { message } = fakeMessage(mime({ body: "lorem ipsum ".repeat(40_000) }));

    await handleEmail(message, env);

    const description = (pushed[0][0].patch as Record<string, string>).description;
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(16 * 1024);
    expect(description.endsWith("— truncated")).toBe(true);
  });

  it("titles a subject-less message from its body, never with an empty string", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();
    const { message } = fakeMessage(mime({ subject: "" }));

    await handleEmail(message, env);

    expect((pushed[0][0].patch as Record<string, unknown>).title).toBe(BODY);
  });

  it("drops attachments — there is no blob store, and they must not be persisted", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();
    const raw = [
      `From: <${SENDER}>`,
      `To: ${LOCAL_PART}@${DOMAIN}`,
      "Message-ID: <a1@example.com>",
      "Subject: With an attachment",
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "see attached",
      "--B",
      'Content-Type: text/plain; name="secret.txt"',
      'Content-Disposition: attachment; filename="secret.txt"',
      "",
      "TOP-SECRET-ATTACHMENT-BODY",
      "--B--",
      "",
    ].join("\n");
    const { message } = fakeMessage(raw);

    await handleEmail(message, env);

    const serialized = JSON.stringify(pushed[0][0]);
    expect(serialized).not.toContain("TOP-SECRET-ATTACHMENT-BODY");
    expect(serialized).not.toContain("secret.txt");
    expect((pushed[0][0].patch as Record<string, unknown>).description).toBe("see attached");
  });

  it("reads message.raw exactly once", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();
    const { message, state } = fakeMessage(mime());

    await handleEmail(message, env);

    expect(state.rawReads).toBe(1);
  });
});

/**
 * Invariant 3 in `docs/EMAIL-INGEST.md`. `observability.enabled` is on, so
 * Workers Logs captures console output *and* uncaught exception messages — a
 * leak here is a leak into a retained log, not just a terminal.
 */
describe("handleEmail — privacy invariant 3: no email content in logs", () => {
  const leaks = [SUBJECT, BODY, SENDER, LOCAL_PART];

  it("logs nothing identifying on the happy path", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(row());
    const { env } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    const all = logs.join("\n");
    for (const leak of leaks) expect(all).not.toContain(leak);
    // What it DOES log: enough to debug a rejection, and no more.
    expect(all).toMatch(/"decision":"accepted"/);
    expect(all).toMatch(/"addressHash":"[0-9a-f]{12}"/);
    expect(all).toMatch(/"rawSize":\d+/);
  });

  it("logs nothing identifying on every rejection path", async () => {
    const cases: Array<() => void> = [
      () => vi.mocked(loadByLocalPart).mockResolvedValue(null),
      () => vi.mocked(loadByLocalPart).mockResolvedValue(row({ revokedAt: new Date() })),
      () =>
        vi
          .mocked(loadByLocalPart)
          .mockResolvedValue(row({ windowStart: Date.now(), windowCount: RATE_LIMIT })),
    ];

    for (const setup of cases) {
      logs = [];
      setup();
      const { env } = fakeEnv();
      await handleEmail(fakeMessage(mime()).message, env);
      const all = logs.join("\n");
      for (const leak of leaks) expect(all).not.toContain(leak);
    }
  });

  /**
   * The subtle one. A MIME parser's `error.message` quotes the bytes it choked
   * on, and an uncaught exception is captured verbatim — so the handler logs
   * `error.name` and nothing else. Regression guard for a one-word change
   * (`.name` → `.message`) that would leak silently.
   */
  it("logs only the error's NAME when something throws mid-message", async () => {
    vi.mocked(loadByLocalPart).mockRejectedValue(
      new TypeError(`cannot parse near "${BODY}" from <${SENDER}>`),
    );
    const { env } = fakeEnv();

    await handleEmail(fakeMessage(mime()).message, env);

    const all = logs.join("\n");
    for (const leak of leaks) expect(all).not.toContain(leak);
    expect(all).toContain("TypeError");
  });
});

/**
 * `setReject()` is a PERMANENT SMTP error — Cloudflare's `ForwardableEmail
 * Message` has no defer API. So a reason string that invites a retry is a
 * promise the protocol cannot keep: the sender will not retry, and the message
 * is already destroyed. This guards the wording, which is the only part we
 * control.
 */
describe("handleEmail — reject reasons never promise a retry", () => {
  const RETRY_WORDS = /try again|temporar|retry|later|resend/i;

  it("uses no retry language on any rejection path", async () => {
    const cases: Array<[string, () => void]> = [
      ["unknown", () => vi.mocked(loadByLocalPart).mockResolvedValue(null)],
      ["revoked", () => vi.mocked(loadByLocalPart).mockResolvedValue(row({ revokedAt: new Date() }))],
      [
        "rate-limited",
        () =>
          vi
            .mocked(loadByLocalPart)
            .mockResolvedValue(row({ windowStart: Date.now(), windowCount: RATE_LIMIT })),
      ],
      ["thrown", () => vi.mocked(loadByLocalPart).mockRejectedValue(new Error("boom"))],
    ];

    for (const [label, setup] of cases) {
      setup();
      const { env } = fakeEnv();
      const { message, state } = fakeMessage(mime());
      await handleEmail(message, env);
      expect(state.rejected, `${label} produced no rejection`).not.toBeNull();
      expect(state.rejected, `${label}: "${state.rejected}" invites a retry that cannot happen`)
        .not.toMatch(RETRY_WORDS);
    }
  });

  it("says plainly that a rate-limited message was NOT delivered", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(
      row({ windowStart: Date.now(), windowCount: RATE_LIMIT }),
    );
    const { env } = fakeEnv();
    const { message, state } = fakeMessage(mime());

    await handleEmail(message, env);

    // The cap destroys mail rather than deferring it; the bounce has to say so,
    // because it is the only notice the sender ever gets.
    expect(state.rejected).toMatch(/not delivered/);
  });

  it("still accepts the message one below the cap", async () => {
    vi.mocked(loadByLocalPart).mockResolvedValue(
      row({ windowStart: Date.now(), windowCount: RATE_LIMIT - 1 }),
    );
    const { env, stub } = fakeEnv();
    const { message, state } = fakeMessage(mime());

    await handleEmail(message, env);

    expect(state.rejected).toBeNull();
    expect(stub.push).toHaveBeenCalledTimes(1);
  });
});
