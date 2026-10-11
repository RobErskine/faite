import type { APIRequestContext } from "@playwright/test";
import {
  test,
  expect,
  addTodo,
  apiClient,
  BASE_URL,
  closeSettings,
  createApiKey,
  expectOnServer,
} from "../support/server";

/**
 * The remote MCP server at `/mcp`, against the real Workers runtime (EI-359).
 * Unit tests cover the handler (src/server/mcp/routes.test.ts); this covers
 * what only the runtime can show — the EI-347 class of bug, where a
 * same-origin `initialize` was rejected as "Invalid Origin" on the deployed
 * worker while every unit test passed.
 *
 * **Origins under `wrangler dev`.** wrangler simulates the production routes
 * and rewrites a local `Origin` the same way it rewrites `request.url`, so the
 * app's own origin (`http://localhost:8787`) arrives matching the endpoint
 * and passes the full-origin check in `handleMcpRequest`. Any other origin
 * does not. That is exactly the production rule, so the local result means
 * something.
 *
 * Raw JSON-RPC over Playwright's request API, not an MCP client SDK: the
 * repo has the server SDK only, and the wire format is what is under test.
 * The key lives in a variable for one test, on a throwaway local account,
 * and is never logged.
 */

/** Every tool docs/API.md documents. A tool added or removed without the
 * docs changing fails here. */
const DOCUMENTED_TOOLS = [
  "complete_todo",
  "create_todo",
  "get_backlog",
  "get_overflow",
  "get_profile",
  "list_attachments",
  "list_labels",
  "list_lists",
  "list_tabs",
  "list_todos",
  "search_todos",
  "update_todo",
];

type RpcResult = { status: number; body: { result?: Record<string, unknown>; error?: { message: string } } };

/**
 * One JSON-RPC call. The server answers in a single SSE frame
 * (`event: message` / `data: {…}`), not bare JSON — see the header of
 * src/server/mcp/routes.ts — so the `data:` line is unwrapped here. Error
 * responses before the transport (401, 403) are plain JSON.
 */
async function rpc(
  api: APIRequestContext,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<RpcResult> {
  const response = await api.post("/mcp", {
    headers: { Accept: "application/json, text/event-stream", ...headers },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  const text = await response.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  return { status: response.status(), body: JSON.parse(data ? data.slice("data: ".length) : text) };
}

const INITIALIZE = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "faite-e2e", version: "1.0.0" },
};

/** The text a tool returned, parsed as the JSON every Faite tool emits. */
function toolJson(result: RpcResult): unknown {
  const content = result.body.result?.content as { type: string; text: string }[] | undefined;
  expect(content?.[0]?.type).toBe("text");
  return JSON.parse(content![0].text);
}

test("initialize succeeds from the app's own origin and is rejected from any other (EI-347)", async ({
  page,
  playwright,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- lazy fixture: signs up and opens the board
  account,
}) => {
  const key = await createApiKey(page, "E2E MCP", { write: false });
  await closeSettings(page);
  const mcp = await apiClient(playwright, key);

  try {
    // The EI-347 case: a browser on the app's own origin. Rejected as
    // "Invalid Origin" before the fix, because the SDK only trusted
    // localhost hostnames on a custom domain.
    const sameOrigin = await rpc(mcp, "initialize", INITIALIZE, { Origin: BASE_URL });
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.body.result?.serverInfo).toMatchObject({ name: "faite" });

    // A non-browser client sends no Origin at all, and is allowed.
    expect((await rpc(mcp, "initialize", INITIALIZE)).status).toBe(200);

    // A page on another site cannot drive a signed-in user's key — even a
    // valid one — through this endpoint.
    const foreign = await rpc(mcp, "initialize", INITIALIZE, { Origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error?.message).toBe("Invalid Origin");

    const tools = await rpc(mcp, "tools/list");
    expect(tools.status).toBe(200);
    const names = (tools.body.result?.tools as { name: string }[]).map((tool) => tool.name).sort();
    expect(names).toEqual(DOCUMENTED_TOOLS);
  } finally {
    await mcp.dispose();
  }
});

test("an authenticated tool call returns the account's own data; no key gets 401", async ({
  page,
  playwright,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- lazy fixture: signs up and opens the board
  account,
}) => {
  await addTodo(page, "Visible to the MCP server");
  await expectOnServer(page, "Visible to the MCP server");

  const key = await createApiKey(page, "E2E MCP read", { write: false });
  await closeSettings(page);
  const mcp = await apiClient(playwright, key);
  const anonymous = await apiClient(playwright);

  try {
    const todos = await rpc(mcp, "tools/call", { name: "list_todos", arguments: {} });
    expect(todos.status).toBe(200);
    expect((toolJson(todos) as { title: string }[]).map((todo) => todo.title)).toContain(
      "Visible to the MCP server",
    );

    // The fresh account's lists, including the Backlog bootstrap creates.
    const lists = await rpc(mcp, "tools/call", { name: "list_lists", arguments: {} });
    expect(lists.status).toBe(200);
    expect(toolJson(lists)).toEqual(expect.arrayContaining([expect.objectContaining({ isBacklog: true })]));

    // MCP has no cookie fallback: a bearer is required, full stop.
    const noKey = await rpc(anonymous, "initialize", INITIALIZE);
    expect(noKey.status).toBe(401);
  } finally {
    await mcp.dispose();
    await anonymous.dispose();
  }
});
