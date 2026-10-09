import { beforeEach, describe, expect, it, vi } from "vitest";

// Use the same real stateless handler as agents/mcp, without importing its
// unrelated Durable Object exports (which need cloudflare:workers in Node).
vi.mock("agents/mcp", async () => import("agents/mcp/server"));
vi.mock("../auth", () => ({
  TRUSTED_ORIGINS: ["https://myfaite.app"],
  createAuth: vi.fn(),
}));

import { createAuth } from "../auth";
import { handleMcpRequest } from "./routes";
import { makeEnv, makeStub } from "../v1/test-harness";

const verifyApiKey = vi.fn();
let env: CloudflareEnv;

beforeEach(() => {
  vi.clearAllMocks();
  env = makeEnv(makeStub());
  vi.mocked(createAuth).mockReturnValue({
    api: { verifyApiKey },
  } as unknown as ReturnType<typeof createAuth>);
  verifyApiKey.mockResolvedValue({
    valid: true,
    key: { referenceId: "user-1", permissions: { api: ["read"] } },
  });
});

function initialize(origin?: string, url = "https://myfaite.app/mcp", token = "test-key") {
  return new Request(url, {
    method: "POST",
    headers: {
      host: new URL(url).host,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(origin === undefined ? {} : { origin }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "diagnostic", version: "1.0" },
      },
    }),
  });
}

describe("MCP browser Origin validation (EI-347)", () => {
  it.each([
    ["https://myfaite.app/mcp", "https://myfaite.app"],
    ["https://preview-faite.bfmw-dev.workers.dev/mcp", "https://preview-faite.bfmw-dev.workers.dev"],
    ["http://localhost:8787/mcp", "http://localhost:8787"],
  ])("accepts same-origin initialize on %s", async (url, origin) => {
    const res = await handleMcpRequest(initialize(origin, url), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"serverInfo":{"name":"faite"');
    expect(verifyApiKey).toHaveBeenCalledOnce();
  });

  it("still accepts native MCP clients without Origin", async () => {
    const res = await handleMcpRequest(initialize(), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"serverInfo":{"name":"faite"');
  });

  it.each([
    "https://evil.example", "https://myfaite.app.evil.example",
    "http://myfaite.app", "https://myfaite.app:444", "https://files.myfaite.app",
    "http://localhost:3000", "null", "not-an-origin", "",
  ])("rejects cross-origin or invalid Origin %j before authentication", async (origin) => {
    const res = await handleMcpRequest(initialize(origin), env);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: { code: -32000, message: "Invalid Origin" } });
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("does not let a same-origin request bypass bearer authentication", async () => {
    verifyApiKey.mockResolvedValue({ valid: false });
    const res = await handleMcpRequest(initialize("https://myfaite.app"), env);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthenticated" });
  });
});
