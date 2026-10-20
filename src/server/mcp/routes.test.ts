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
import { makeEnv, makeStub, pushedEntries, rawAssigneeRow, rawTodoRow, type FakeStub } from "../v1/test-harness";

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
    key: { id: "key-1", referenceId: "user-1", permissions: { api: ["read"] } },
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

// --- EI-402: assignee tools --------------------------------------------------

function callTool(name: string, args: Record<string, unknown>) {
  return new Request("https://myfaite.app/mcp", {
    method: "POST",
    headers: {
      host: "myfaite.app",
      authorization: "Bearer test-key",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
  });
}

/** Runs one tool and returns `{ isError, text }` from the SSE-framed reply. */
async function run(name: string, args: Record<string, unknown> = {}) {
  const res = await handleMcpRequest(callTool(name, args), env);
  const body = await res.text();
  const data = body.split("\n").find((line) => line.startsWith("data:"));
  const message = JSON.parse(data!.slice(5));
  const result = message.result ?? { isError: true, content: [{ text: message.error?.message ?? "" }] };
  return { isError: Boolean(result.isError), text: String(result.content?.[0]?.text ?? "") };
}

type AgentStub = FakeStub & { assigneeIdForApiKey: ReturnType<typeof vi.fn> };

/** A stub whose key `key-1` is bound to `assignee-1` (or to nothing). */
function agentEnv(bound: boolean, rows: Record<string, unknown>[] = []): AgentStub {
  const stub = Object.assign(makeStub(), {
    assigneeIdForApiKey: vi.fn().mockResolvedValue(bound ? "assignee-1" : null),
  });
  stub.listEntities.mockImplementation(async (kind: string) =>
    kind === "todo" ? rows : kind === "assignee" ? [rawAssigneeRow()] : [],
  );
  stub.getEntity.mockImplementation(async (kind: string) => (kind === "assignee" ? rawAssigneeRow() : null));
  env = makeEnv(stub);
  verifyApiKey.mockResolvedValue({
    valid: true,
    key: { id: "key-1", referenceId: "user-1", permissions: { api: ["read", "write"] } },
  });
  return stub;
}

describe("get_my_work (EI-402)", () => {
  it("returns the bound agent's open to-dos with the queue instructions", async () => {
    agentEnv(true, [
      rawTodoRow({ id: "mine", assigneeId: "assignee-1" }),
      rawTodoRow({ id: "done", assigneeId: "assignee-1", status: "done" }),
      rawTodoRow({ id: "dropped", assigneeId: "assignee-1", status: "dropped" }),
      rawTodoRow({ id: "other", assigneeId: "assignee-2" }),
      rawTodoRow({ id: "owner", assigneeId: null }),
    ]);
    const { isError, text } = await run("get_my_work");
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.todos.map((t: { id: string }) => t.id)).toEqual(["mine"]);
    expect(out.assignee).toMatchObject({ id: "assignee-1", name: "Triage bot" });
    expect(out.instructions).toContain("create_todo");
  });

  it("holds to-dos scheduled after today in upcoming, soonest first (EI-408)", async () => {
    agentEnv(true, [
      rawTodoRow({ id: "unscheduled", assigneeId: "assignee-1" }),
      rawTodoRow({ id: "overdue", assigneeId: "assignee-1", scheduledDate: "2000-01-01" }),
      rawTodoRow({ id: "later", assigneeId: "assignee-1", scheduledDate: "2999-02-01" }),
      rawTodoRow({ id: "soon", assigneeId: "assignee-1", scheduledDate: "2999-01-01" }),
      rawTodoRow({ id: "done-later", assigneeId: "assignee-1", status: "done", scheduledDate: "2999-01-01" }),
    ]);
    const { isError, text } = await run("get_my_work");
    expect(isError).toBe(false);
    const out = JSON.parse(text);
    expect(out.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.todos.map((t: { id: string }) => t.id)).toEqual(["unscheduled", "overdue"]);
    expect(out.upcoming.map((t: { id: string }) => t.id)).toEqual(["soon", "later"]);
    expect(out.upcomingCount).toBe(2);
    expect(out.instructions).toContain("upcoming");
  });

  it("errors when the key is not bound to an assignee", async () => {
    agentEnv(false);
    const { isError, text } = await run("get_my_work");
    expect(isError).toBe(true);
    expect(text).toContain("not bound to an agent");
  });
});

describe("agent writes (EI-402)", () => {
  const stored = rawTodoRow({
    id: "todo-1",
    assigneeId: "assignee-1",
    doneCriteria: [{ id: "c1", text: "Ship it", done: false, addedBy: null }],
    access: [],
  });

  it("add_note pushes a note event stamped via agent:<id>", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(stored);
    const { isError } = await run("add_note", { todoId: "todo-1", text: "  Halfway there  " });
    expect(isError).toBe(false);
    const [entry] = pushedEntries(stub);
    expect(entry.kind).toBe("todoEvent");
    const patch = entry.patch as Record<string, unknown>;
    expect(patch.kind).toBe("note");
    expect(JSON.parse(patch.payload as string)).toEqual({ v: 1, text: "Halfway there", via: "agent:assignee-1" });
  });

  it("add_note from an unbound key carries no via", async () => {
    const stub = agentEnv(false);
    stub.getTodo.mockResolvedValue(stored);
    await run("add_note", { todoId: "todo-1", text: "Mine" });
    const patch = pushedEntries(stub)[0].patch as Record<string, unknown>;
    expect(JSON.parse(patch.payload as string)).toEqual({ v: 1, text: "Mine" });
  });

  it("add_criterion stamps addedBy with the actor, and update_criterion keeps it", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(stored);
    expect((await run("add_criterion", { todoId: "todo-1", text: "Tests pass" })).isError).toBe(false);
    const todoEntry = pushedEntries(stub).find((e) => e.kind === "todo")!;
    const criteria = (todoEntry.patch as { doneCriteria: { text: string; addedBy: string | null }[] }).doneCriteria;
    expect(criteria.find((c) => c.text === "Tests pass")?.addedBy).toBe("assignee-1");
    expect(criteria.find((c) => c.text === "Ship it")?.addedBy).toBeNull();

    stub.push.mockClear();
    expect((await run("update_criterion", { todoId: "todo-1", criterionId: "c1", done: true })).isError).toBe(false);
    const ticked = (pushedEntries(stub).find((e) => e.kind === "todo")!.patch as { doneCriteria: { id: string; done: boolean; addedBy: string | null }[] }).doneCriteria;
    expect(ticked[0]).toMatchObject({ id: "c1", done: true, addedBy: null });
  });

  it("overwrites a spoofed addedBy in update_todo's whole-list replace", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(stored);
    await run("update_todo", {
      id: "todo-1",
      doneCriteria: [
        { id: "c1", text: "Ship it", addedBy: "someone-else" },
        { id: "c2", text: "New line", addedBy: "someone-else" },
      ],
    });
    const criteria = (pushedEntries(stub).find((e) => e.kind === "todo")!.patch as { doneCriteria: { id: string; addedBy: string | null }[] }).doneCriteria;
    expect(criteria.find((c) => c.id === "c1")?.addedBy).toBeNull();
    expect(criteria.find((c) => c.id === "c2")?.addedBy).toBe("assignee-1");
  });

  it("complete_todo events carry via", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(stored);
    await run("complete_todo", { id: "todo-1" });
    const events = pushedEntries(stub).filter((e) => e.kind === "todoEvent");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(JSON.parse((e.patch as { payload: string }).payload).via).toBe("agent:assignee-1");
    }
  });

  it("add_criterion works on an agent to-do that predates the rule and has no access yet", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue({ ...stored, access: null });
    expect((await run("add_criterion", { todoId: "todo-1", text: "Tests pass" })).isError).toBe(false);
    expect(pushedEntries(stub).some((e) => e.kind === "todo")).toBe(true);
  });

  it("update_access works on an agent to-do that has no Done lines yet", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue({ ...stored, doneCriteria: [] });
    const { isError } = await run("update_access", { todoId: "todo-1", access: [] });
    expect(isError).toBe(false);
  });

  it("still rejects a write that introduces a problem (removing the last Done line)", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(stored);
    const { isError, text } = await run("update_todo", { id: "todo-1", doneCriteria: [] });
    expect(isError).toBe(true);
    expect(text).toContain("Done criterion");
  });

  it("refuses a key whose bound assignee was deleted", async () => {
    const stub = agentEnv(false);
    stub.isApiKeyOrphaned.mockResolvedValue(true);
    const res = await handleMcpRequest(callTool("list_todos", {}), env);
    expect(res.status).toBe(401);
  });

  it("update_access replaces the list", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(stored);
    const { isError } = await run("update_access", { todoId: "todo-1", access: [{ name: "GitHub", status: "blocked" }] });
    expect(isError).toBe(false);
    const patch = pushedEntries(stub).find((e) => e.kind === "todo")!.patch as { access: unknown };
    expect(patch.access).toEqual([{ name: "GitHub", status: "blocked" }]);
  });

  it("create_todo without assigneeId makes a to-do for the owner", async () => {
    const stub = agentEnv(true);
    const { isError } = await run("create_todo", { title: "Need your review" });
    expect(isError).toBe(false);
    const patch = pushedEntries(stub).find((e) => e.kind === "todo")!.patch as { assigneeId: unknown };
    expect(patch.assigneeId).toBeNull();
  });

  it("create_todo for an agent without a Done checklist or access is refused", async () => {
    const stub = agentEnv(true);
    const { isError, text } = await run("create_todo", { title: "Do it", assigneeId: "assignee-1" });
    expect(isError).toBe(true);
    expect(text).toContain("Done criterion");
    expect(stub.push).not.toHaveBeenCalled();
  });

  it("create_todo for an agent with a checklist and access succeeds", async () => {
    const stub = agentEnv(true);
    const { isError } = await run("create_todo", {
      title: "Do it",
      assigneeId: "assignee-1",
      doneCriteria: [{ text: "It works" }],
      access: [],
    });
    expect(isError).toBe(false);
    const patch = pushedEntries(stub).find((e) => e.kind === "todo")!.patch as { assigneeId: string; doneCriteria: unknown[] };
    expect(patch.assigneeId).toBe("assignee-1");
    expect(patch.doneCriteria).toHaveLength(1);
  });

  it("update_todo moving a to-do to an agent re-checks the spec", async () => {
    const stub = agentEnv(true);
    stub.getTodo.mockResolvedValue(rawTodoRow({ id: "todo-1" }));
    const { isError } = await run("update_todo", { id: "todo-1", assigneeId: "assignee-1" });
    expect(isError).toBe(true);
    expect(stub.push).not.toHaveBeenCalled();
  });

  it("list_assignees hides the key binding", async () => {
    agentEnv(true);
    const { text } = await run("list_assignees");
    expect(JSON.parse(text)[0]).toMatchObject({ id: "assignee-1", kind: "agent" });
    expect(text).not.toContain("apiKeyId");
  });
});
