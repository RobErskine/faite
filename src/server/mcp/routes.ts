import { createMcpHandler } from "agents/mcp";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { prioritySchema, todoSchema } from "@/lib/schema";
import type { ServiceContext } from "@/lib/service/context";
import { createAuth } from "../auth";
import { keyGrantsScope, type ApiScope } from "../auth-scopes";
import { extractBearerCredential } from "../bearer";
import { corsHeaders, handleOptions } from "../cors";
import { durableHlcQueue } from "../service/hlc";
import { createTodo, pushTransportFor, updateTodo } from "../service/todos";
import type { UserDurableObject } from "../user-do";
import { withEventStreamAccept } from "./accept";

export { withEventStreamAccept } from "./accept";

/**
 * `/mcp` — the remote MCP server (A6, EI-52). First consumer: Pointer
 * (EI-221).
 *
 * Built on `createMcpHandler` (`agents@0.21.0`'s `agents/mcp`, wrapping
 * `@modelcontextprotocol/server@2.0.0`), NOT the older `McpAgent` class the
 * milestone doc's design note names — verified against current Cloudflare
 * docs while implementing this ticket: `McpAgent` is now documented as
 * "deprecated and feature-frozen," with `createMcpHandler` as the
 * recommended replacement. Concretely, that changes three things the
 * milestone doc expected to hand-solve here:
 *
 * 1. **No Durable Object binding or `wrangler.jsonc` migrations entry.**
 *    `createMcpHandler` is stateless — its factory runs fresh per HTTP
 *    request against whatever `env` bindings the surrounding Worker request
 *    already has (`env.USER_DO`, the same per-user DO every other route
 *    uses). There is no new DO class to register.
 * 2. **The 406-vs-hang half of the SSE↔JSON problem, fixed; the framing
 *    half, unchanged.** Verified live against this exact SDK version, not
 *    assumed from its docs: a request whose `Accept` header omits
 *    `text/event-stream` gets a clean, immediate `406` from the transport's
 *    pre-dispatch gate — a minimal client would fail fast instead of
 *    hanging, but it would still fail to connect. `withEventStreamAccept()`
 *    below widens the header before the SDK ever sees it, which clears
 *    that gate. What it does NOT change: every response this server sends
 *    back is still SSE-framed (`Content-Type: text/event-stream`, one
 *    `event: message` frame, then closed) — `responseMode: 'json'`,
 *    despite its own doc text, had no observed effect against this
 *    version's default ("legacy") era classification in testing. A truly
 *    JSON-only client (one that cannot parse a single-frame SSE body at
 *    all) still needs its own unwrapping; this is the residual scope of
 *    the milestone doc's original workaround. Most MCP client libraries
 *    already handle Streamable HTTP's long-established SSE response mode,
 *    so this is a narrower risk than a client that hangs forever — but it
 *    is not zero, and is worth re-checking against Pointer specifically.
 * 3. **No hand-rolled `GET /mcp` → 405.** `legacy: 'stateless'` (the
 *    default posture) already answers GET/DELETE with 405 for exactly the
 *    reason the milestone doc's workaround existed: this server never
 *    pushes server-initiated messages, so a client that opened a
 *    server→client stream waiting on one would otherwise idle to a socket
 *    timeout instead of a clean, fast error.
 *
 * What the milestone doc got right and this still does: **auth resolved
 * ahead of the server, re-resolved per call, so revocation bites
 * immediately.** `createMcpHandler`'s factory runs once per incoming HTTP
 * request — and because MCP's Streamable HTTP transport sends one JSON-RPC
 * method call per HTTP POST (no request batching in the "modern",
 * per-request envelope era this server negotiates), "per request" and "per
 * tool call" are the same thing here. `resolveIdentity()` below calls
 * `auth.api.verifyApiKey({ body: { key } })` — exactly once, no `headers`,
 * no `permissions` argument, same reasoning as `auth-scopes.ts`'s
 * `authorizeScope()` — on every single one of those requests; a revoked key
 * fails on the very next call. Per-TOOL scope (`read`/`write`) is then
 * checked ENTIRELY LOCALLY inside each tool handler via the pure
 * `keyGrantsScope()`, so a request touching multiple tools never pays for a
 * second `verifyApiKey` round trip.
 *
 * MCP has no cookie story — a client here is an agent/script, not a
 * browser page — so unlike `authorizeScope()` there is no session
 * fallback: a bearer credential is required, full stop.
 *
 * Tools wrap `src/server/service/*` — the SAME `createTodo`/`updateTodo`
 * adapters `/api/v1/todos` uses (A5, EI-230) — never DO tables directly,
 * per the milestone doc's design note. `complete_todo` is that note's own
 * named example of a server-originated UPDATE that needs A4's durable HLC;
 * both write tools use `durableHlcQueue()` for exactly that reason.
 */

interface McpIdentity {
  userId: string;
  keyName: string | null;
  permissions: Record<string, string[]> | null;
}

async function resolveIdentity(request: Request, env: CloudflareEnv): Promise<McpIdentity | null> {
  const bearer = extractBearerCredential(request.headers);
  if (!bearer) return null;

  const auth = createAuth(env, request);
  const result = await auth.api.verifyApiKey({ body: { key: bearer } });
  if (!result.valid || !result.key) return null;

  return {
    userId: result.key.referenceId,
    keyName: result.key.name,
    permissions: result.key.permissions ?? null,
  };
}

/** Throws rather than returning a boolean — a tool handler that forgets to
 * check this should fail loudly (a 500-shaped tool error the client sees),
 * not silently proceed unauthorized. */
function requireScope(identity: McpIdentity, scope: ApiScope): void {
  if (!keyGrantsScope({ name: identity.keyName, permissions: identity.permissions }, scope)) {
    throw new Error(`This API key does not have the "${scope}" scope required for this tool.`);
  }
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * REGRESSION (caught live while testing `create_todo`, before this shipped):
 * `stub.getTodo()` returns the RAW row, `version` column included.
 * `create_todo`/`complete_todo` must run it through `todoSchema.parse()`
 * before handing it to `textResult()` — exactly what `list_todos` and
 * `/api/v1/todos` already do — or the tool result leaks the DO's internal
 * version counter to the MCP client, the same "never expose version/hlc"
 * rule `docs/API.md` states for the REST surface. `todoSchema.parse()`
 * strips it by not declaring the field, not by a hand-picked list.
 */
const todoOrNull = (row: Record<string, unknown> | null) => (row ? todoSchema.parse(row) : null);

/**
 * A dedicated wrapper, not `stub.listEntities("todo")` called inline —
 * matching `v1/routes.ts`'s own workaround for the identical symptom: even
 * with a literal `"todo"` argument, calling through a `DurableObjectStub`
 * RPC proxy from inside a deeply-nested closure (a tool handler passed to
 * `registerTool`) resolves to `never` here, silently, rather than erroring
 * on the call itself. An explicit return-type annotation on a top-level
 * function breaks whatever inference path produces that.
 */
function listTodos(stub: DurableObjectStub<UserDurableObject>): ReturnType<UserDurableObject["listEntities"]> {
  return stub.listEntities("todo");
}

function buildServer(
  env: CloudflareEnv,
  identity: McpIdentity,
  stub: DurableObjectStub<UserDurableObject>,
): McpServer {
  const server = new McpServer({ name: "faite", version: "1.0.0" });

  server.registerTool(
    "list_todos",
    {
      description: "List the caller's non-deleted to-dos, in board order.",
      inputSchema: {},
    },
    async () => {
      requireScope(identity, "read");
      const rows = await listTodos(stub);
      return textResult(rows.map((row) => todoSchema.parse(row)));
    },
  );

  server.registerTool(
    "create_todo",
    {
      description: "Create a new to-do.",
      inputSchema: {
        title: z.string().min(1),
        listId: z.string().nullable().optional(),
        scheduledDate: z.string().nullable().optional(),
        deadline: z.string().nullable().optional(),
        priority: prioritySchema.nullable().optional(),
        description: z.string().nullable().optional(),
      },
    },
    async (input) => {
      requireScope(identity, "write");

      const position = await stub.nextTodoPosition();
      const reminderTime = await stub.defaultReminderTimeForList(input.listId ?? null);
      // Two stamps: the todo entry and its "created" todoEvent always both
      // fire on a create — see `buildCreateTodoEntry`'s doc comment.
      const nextHlc = await durableHlcQueue(stub, 2);
      const ctx: ServiceContext = { userId: identity.userId, nextHlc };

      const { response, todoId } = await createTodo(
        ctx,
        { ...input, position, reminderTime },
        pushTransportFor(stub, identity.userId),
      );
      if (response.rejected.length > 0) {
        throw new Error("The server refused this entry — please try again.");
      }

      const todo = await stub.getTodo(todoId);
      return textResult(todoOrNull(todo));
    },
  );

  server.registerTool(
    "complete_todo",
    {
      description: "Mark a to-do as done.",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      requireScope(identity, "write");

      const existing = await stub.getTodo(id);
      if (!existing) throw new Error(`No such to-do: ${id}`);

      // Durable mode is REQUIRED here, not the in-memory default — this is
      // exactly the server-originated UPDATE the milestone doc's own A4
      // rationale names ("An MCP 'mark this todo done' would" hit the
      // per-isolate collision the in-memory mode can't survive).
      const nextHlc = await durableHlcQueue(stub, 2);
      const ctx: ServiceContext = { userId: identity.userId, nextHlc };

      const { rejected } = await updateTodo(
        ctx,
        id,
        { status: "done", completedAt: new Date().toISOString() },
        pushTransportFor(stub, identity.userId),
      );
      if (rejected.length > 0) {
        throw new Error("The server refused this update — please try again.");
      }

      const todo = await stub.getTodo(id);
      return textResult(todoOrNull(todo));
    },
  );

  server.registerPrompt(
    "summarize_backlog",
    {
      title: "Summarize backlog",
      description: "Summarize the caller's open to-dos, grouped by priority.",
      // A prompt with no meaningful arguments still needs an empty
      // `argsSchema` — some MCP clients refuse to connect to a server that
      // advertises zero prompts at all (the milestone doc's third named
      // workaround); registering one, argument-less or not, satisfies that.
      argsSchema: z.object({}),
    },
    async () => {
      requireScope(identity, "read");
      const rows = await listTodos(stub);
      const open = rows.map((row) => todoSchema.parse(row)).filter((todo) => todo.status === "open");
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Summarize these open to-dos, grouped by priority:\n\n${JSON.stringify(open, null, 2)}`,
            },
          },
        ],
      };
    },
  );

  return server;
}

export async function handleMcpRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const identity = await resolveIdentity(request, env);
  if (!identity) {
    return Response.json(
      { error: "unauthenticated" },
      { status: 401, headers: corsHeaders(request.headers.get("Origin")) },
    );
  }

  const stub = env.USER_DO.get(env.USER_DO.idFromName(identity.userId));

  // Constructed fresh per request — the factory below closes over `env`,
  // `identity`, and `stub` for THIS request only. `createMcpHandler` itself
  // re-invokes the factory once per HTTP request regardless (see the file
  // header), so building the outer handler per request too costs nothing
  // extra and keeps every closure obviously request-scoped.
  const handler = createMcpHandler(
    () => buildServer(env, identity, stub),
    { route: "/mcp" },
  );

  const authInfo: AuthInfo = {
    token: "verified", // Already validated above; the SDK never re-reads this.
    clientId: identity.userId,
    scopes: [],
  };

  return handler.fetch(withEventStreamAccept(request), { authInfo });
}
