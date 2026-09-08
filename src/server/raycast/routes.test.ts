import { beforeEach, describe, expect, it, vi } from "vitest";

// Same seam `v1/routes.test.ts` mocks: `createAuth` needs a live D1, and
// `getSessionSafe` is the only thing the handoff route asks it for.
const { getSessionSafe, createApiKey } = vi.hoisted(() => ({
  getSessionSafe: vi.fn(),
  createApiKey: vi.fn(),
}));

vi.mock("../auth", () => ({
  createAuth: vi.fn(() => ({ api: { createApiKey } })),
  getSessionSafe: (...args: unknown[]) => getSessionSafe(...args),
  TRUSTED_ORIGINS: ["https://myfaite.app"],
}));

import { RAYCAST_KEY_NAME, RAYCAST_KEY_PERMISSIONS } from "../auth-scopes";
import {
  decodeHandoffCode,
  DESKTOP_HANDOFF_INFO,
  encodeHandoffCode,
  RAYCAST_HANDOFF_INFO,
} from "../desktop/handoff-code";
import { handleRaycastRequest } from "./routes";

const SECRET = "test-secret-do-not-use-in-prod";
const env = { BETTER_AUTH_SECRET: SECRET } as unknown as CloudflareEnv;

const post = (path: string, body?: unknown) =>
  new Request(`https://myfaite.app${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getSessionSafe.mockResolvedValue({ user: { id: "user-1" } });
  createApiKey.mockResolvedValue({ key: "faite_the_real_key" });
});

describe("POST /api/raycast/handoff", () => {
  it("mints a key and returns a CODE, never the key itself", async () => {
    const res = await handleRaycastRequest(post("/api/raycast/handoff"), env);
    const body = (await res.json()) as { code: string };

    expect(res.status).toBe(200);
    expect(body.code).toEqual(expect.any(String));
    // The whole point of the indirection: a long-lived credential must not
    // ride a URL, where browser history and OS "recent items" can keep it.
    expect(JSON.stringify(body)).not.toContain("faite_the_real_key");
  });

  it("the returned code decodes to the real key under the Raycast separator", async () => {
    const res = await handleRaycastRequest(post("/api/raycast/handoff"), env);
    const { code } = (await res.json()) as { code: string };

    expect(await decodeHandoffCode(code, SECRET, RAYCAST_HANDOFF_INFO)).toBe("faite_the_real_key");
  });

  /**
   * SECURITY. Desktop keys carry `sync` and `places`; these deliberately do
   * not. If the handoff ever minted the wider set, a third-party launcher
   * would gain the CRDT transport and a paid Google upstream.
   */
  it("mints read+write ONLY — never sync or places", async () => {
    await handleRaycastRequest(post("/api/raycast/handoff"), env);

    expect(createApiKey).toHaveBeenCalledTimes(1);
    const { body } = createApiKey.mock.calls[0][0];
    expect(body.permissions).toEqual(RAYCAST_KEY_PERMISSIONS);
    expect(body.permissions.api).toEqual(["read", "write"]);
    expect(body.permissions.api).not.toContain("sync");
    expect(body.permissions.api).not.toContain("places");
  });

  /**
   * REGRESSION-BY-CONSTRUCTION. `@better-auth/api-key` decides "is this a
   * server call" from `ctx.request || ctx.headers` — ANY headers, not
   * specifically a cookie. Passing the request's headers makes this look
   * like a public client request and throws SERVER_ONLY_PROPERTY the moment
   * `permissions` is present. The session is already resolved, so the id is
   * supplied directly instead.
   */
  it("passes an explicit userId and NO headers to createApiKey", async () => {
    await handleRaycastRequest(post("/api/raycast/handoff"), env);

    const call = createApiKey.mock.calls[0][0];
    expect(call.body.userId).toBe("user-1");
    expect(call).not.toHaveProperty("headers");
  });

  it("names the key for the eventual revocation list", async () => {
    await handleRaycastRequest(post("/api/raycast/handoff"), env);
    expect(createApiKey.mock.calls[0][0].body.name).toBe(RAYCAST_KEY_NAME);
  });

  it("401s with no session, and mints nothing", async () => {
    getSessionSafe.mockResolvedValue(null);

    const res = await handleRaycastRequest(post("/api/raycast/handoff"), env);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthenticated" });
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe("POST /api/raycast/exchange", () => {
  it("trades a valid code for the real key", async () => {
    const code = await encodeHandoffCode("faite_x", SECRET, RAYCAST_HANDOFF_INFO);

    const res = await handleRaycastRequest(post("/api/raycast/exchange", { code }), env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: "faite_x" });
  });

  /**
   * SECURITY, and the reason the separators exist. A desktop code carries a
   * grant with `sync` and `places`. If it were redeemable here, the narrower
   * flow would be a laundering route for the wider one.
   */
  it("REJECTS a code minted by the DESKTOP handoff", async () => {
    const desktopCode = await encodeHandoffCode("faite_desktop", SECRET, DESKTOP_HANDOFF_INFO);

    const res = await handleRaycastRequest(post("/api/raycast/exchange", { code: desktopCode }), env);

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "invalid-or-expired-code" });
  });

  it("401s a tampered or unknown code", async () => {
    const res = await handleRaycastRequest(post("/api/raycast/exchange", { code: "garbage" }), env);
    expect(res.status).toBe(401);
  });

  it("400s a body with no code", async () => {
    for (const body of [{}, { code: "" }, { code: 42 }]) {
      const res = await handleRaycastRequest(post("/api/raycast/exchange", body), env);
      expect(res.status).toBe(400);
    }
  });

  it("400s a malformed body rather than throwing", async () => {
    const request = new Request("https://myfaite.app/api/raycast/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect((await handleRaycastRequest(request, env)).status).toBe(400);
  });

  /** No session needed — the extension calls this from Node with no cookie. */
  it("does not require a session", async () => {
    getSessionSafe.mockResolvedValue(null);
    const code = await encodeHandoffCode("faite_x", SECRET, RAYCAST_HANDOFF_INFO);

    const res = await handleRaycastRequest(post("/api/raycast/exchange", { code }), env);

    expect(res.status).toBe(200);
  });
});

describe("dispatch", () => {
  it("404s an unknown path", async () => {
    expect((await handleRaycastRequest(post("/api/raycast/nope"), env)).status).toBe(404);
  });

  it("404s a GET on the write-only endpoints", async () => {
    const get = new Request("https://myfaite.app/api/raycast/handoff");
    expect((await handleRaycastRequest(get, env)).status).toBe(404);
  });

  it("answers OPTIONS as a preflight", async () => {
    const options = new Request("https://myfaite.app/api/raycast/exchange", { method: "OPTIONS" });
    expect((await handleRaycastRequest(options, env)).status).toBe(204);
  });
});
