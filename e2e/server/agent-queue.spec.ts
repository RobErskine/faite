import type { APIRequestContext, Page } from "@playwright/test";
import {
  test,
  expect,
  apiClient,
  closeSettings,
  expectOnServer,
  todoCard,
} from "../support/server";
import { openSheet } from "../support/sheet";

/**
 * The agent queue, end to end (EI-402): an assignee with its own API key
 * works a to-do through MCP alone — finds it, reports, ticks, declares access,
 * completes — and the card's history says the agent did it.
 *
 * The key is created the way a user creates it, from the agent's row in
 * Settings → Assignees, because that click is what binds the key to the
 * assignee (`apiKeyId`, written client-side and synced). The to-do itself is
 * seeded over REST with the owner's cookie session: the Done/Access editor UI
 * has unit coverage, and what is under test here is the server round trip.
 *
 * Raw JSON-RPC, as in mcp.spec.ts. The key lives in a variable for one test.
 */

const CONVERGE = { timeout: 20_000 };

type RpcBody = { result?: { content?: { type: string; text: string }[]; isError?: boolean } };

/** One `tools/call`. The server answers in one SSE frame (see mcp.spec.ts). */
async function callTool(
  api: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ json: unknown; text: string; isError: boolean }> {
  const response = await api.post("/mcp", {
    headers: { Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(response.status()).toBe(200);
  const raw = await response.text();
  const data = raw.split("\n").find((line) => line.startsWith("data: "));
  const body = JSON.parse(data ? data.slice("data: ".length) : raw) as RpcBody;
  const text = body.result?.content?.[0]?.text ?? "";
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // An error result is plain text.
  }
  return { json, text, isError: body.result?.isError === true };
}

type Criterion = { id: string; text: string; done: boolean; addedBy?: string | null };
type McpTodo = {
  id: string;
  title: string;
  status: string;
  assigneeId: string | null;
  doneCriteria: Criterion[];
  access: { name: string; status: string }[] | null;
};

/** Settings → Assignees: adds an agent and creates its key. Returns the key. */
async function addAgentWithKey(page: Page, name: string): Promise<string> {
  // The reveal dialog keeps "Done" disabled until the key is copied.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("tab", { name: "Assignees" }).click();

  // Kind defaults to Agent.
  await page.getByPlaceholder(/^Name/).fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("no key yet")).toBeVisible();

  await page.getByRole("button", { name: "Create key" }).click();
  const reveal = page.getByRole("dialog", { name: /agent.s API key/ });
  const key = await reveal.getByRole("textbox").inputValue();
  expect(key.length).toBeGreaterThan(20);
  await reveal.getByRole("button", { name: "Copy key" }).click();
  await reveal.getByRole("button", { name: "Done" }).click();
  await expect(reveal).toHaveCount(0);
  await expect(page.getByText("key created")).toBeVisible();
  await closeSettings(page);
  return key;
}

test("an agent works its queue through MCP, and the history names the agent", async ({
  page,
  playwright,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- lazy fixture: signs up and opens the board
  account,
}) => {
  const key = await addAgentWithKey(page, "Claude");

  // The assignee and its key binding reach the server over sync. Owner reads
  // go through `page.request` (cookie session) on purpose: the agent's bearer
  // is the other identity in this test.
  let assigneeId = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/assignees");
        const rows = (await response.json()) as { id: string; name: string; apiKeyId: string | null }[];
        const row = rows.find((assignee) => assignee.name === "Claude");
        assigneeId = row?.id ?? "";
        return row?.apiKeyId ? "bound" : "unbound";
      },
      CONVERGE,
    )
    .toBe("bound");

  // Seed the agent's to-do as the owner: one Done line, access declared.
  const created = await page.request.post("/api/v1/todos", {
    data: {
      title: "Draft the release notes",
      assigneeId,
      doneCriteria: [{ text: "Notes are written" }, { text: "Notes are proofread" }],
      access: [{ name: "Changelog repo", status: "needed" }],
    },
  });
  expect(created.status()).toBe(201);
  await expect(todoCard(page, "Draft the release notes")).toBeVisible(CONVERGE);

  const agent = await apiClient(playwright, key);
  try {
    // 1. The queue.
    const queue = await callTool(agent, "get_my_work");
    expect(queue.isError).toBe(false);
    const work = queue.json as { assignee: { id: string; name: string }; todos: McpTodo[] };
    expect(work.assignee).toMatchObject({ id: assigneeId, name: "Claude" });
    expect(work.todos.map((todo) => todo.title)).toEqual(["Draft the release notes"]);
    const todo = work.todos[0];
    expect(todo.doneCriteria).toHaveLength(2);

    // 2. Progress: a note, a ticked line, an access update.
    const note = await callTool(agent, "add_note", { todoId: todo.id, text: "Started on the draft." });
    expect(note.isError).toBe(false);

    const ticked = await callTool(agent, "update_criterion", {
      todoId: todo.id,
      criterionId: todo.doneCriteria[0].id,
      done: true,
    });
    expect(ticked.isError).toBe(false);
    expect((ticked.json as McpTodo).doneCriteria.map((c) => c.done)).toEqual([true, false]);

    const access = await callTool(agent, "update_access", {
      todoId: todo.id,
      access: [{ name: "Changelog repo", status: "granted" }],
    });
    expect(access.isError).toBe(false);
    expect((access.json as McpTodo).access).toEqual([{ name: "Changelog repo", status: "granted" }]);

    // 3. Finish.
    await callTool(agent, "update_criterion", {
      todoId: todo.id,
      criterionId: todo.doneCriteria[1].id,
      done: true,
    });
    const done = await callTool(agent, "complete_todo", { id: todo.id });
    expect(done.isError).toBe(false);
    expect((done.json as McpTodo).status).toBe("done");

    // Done leaves the queue.
    const after = await callTool(agent, "get_my_work");
    expect((after.json as { todos: McpTodo[] }).todos).toEqual([]);

    // 4. "I need you": a to-do created with no assignee is the owner's,
    // never defaulted to the calling agent.
    const ask = await callTool(agent, "create_todo", { title: "Approve the release notes" });
    expect(ask.isError).toBe(false);
    expect((ask.json as McpTodo).assigneeId).toBeNull();
  } finally {
    await agent.dispose();
  }

  // The owner's board sees the agent's write and its trail. Look at the
  // finished to-do through the filtered REST list, then at the card.
  await expectOnServer(page, "Started on the draft.");
  await expect(todoCard(page, "Approve the release notes")).toBeVisible(CONVERGE);
  // The completed to-do has left the default board; reopen it by REST so its
  // card can be opened to read the history.
  const reopen = await page.request.patch(`/api/v1/todos/${(await findTodoId(page, "Draft the release notes"))}`, {
    data: { status: "open" },
  });
  expect(reopen.status()).toBe(200);
  await todoCard(page, "Draft the release notes").click({ timeout: 20_000 });
  const sheet = openSheet(page);
  await sheet.getByRole("button", { name: /^History/ }).click();
  const history = sheet.getByRole("list", { name: "History for Draft the release notes" });
  await expect(history.getByText("Started on the draft.")).toBeVisible(CONVERGE);
  await expect(history.getByText("by Claude").first()).toBeVisible();
});

/** A to-do's id by title, from the owner's REST list (any status). */
async function findTodoId(page: Page, title: string): Promise<string> {
  const response = await page.request.get("/api/v1/todos");
  const rows = (await response.json()) as { id: string; title: string }[];
  const row = rows.find((todo) => todo.title === title);
  expect(row, `a to-do titled "${title}"`).toBeTruthy();
  return row!.id;
}
