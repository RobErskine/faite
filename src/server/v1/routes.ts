import { labelSchema, listSchema, tabSchema, todoSchema } from "@/lib/schema";
import type { ServiceContext } from "@/lib/service/context";
import { createAuth } from "../auth";
import { authorizeScope } from "../auth-scopes";
import { corsHeaders, handleOptions } from "../cors";
import { durableHlcQueue } from "../service/hlc";
import { createTodo, pushTransportFor, updateTodo } from "../service/todos";
import type { UserDurableObject } from "../user-do";
import { parseCreateTodoRequest, parseUpdateTodoRequest } from "./validate";

/**
 * `/api/v1/*` — the public, versioned API. Same seam as
 * `/api/sync/*`/`/api/places/*`: not a Next.js Route Handler, because
 * `output: export` forbids one that reads `Request`. See
 * `docs/ARCHITECTURE.md` §2.12.
 *
 * Reads (A2, EI-227) require the `read` scope; writes (A5, EI-230) require
 * `write` — a cookie session and a desktop-handoff key have both; a narrow
 * user-generated key (A3) has neither by default (`auth-tokens.ts`'s
 * `defaultPermissions: { api: ["read"] }`) unless a future UI asks for more.
 *
 * Every read response is the entity's OWN Zod schema (`src/lib/schema.ts`)
 * run over the Durable Object's raw row — not a hand-picked field list. That
 * is what strips `version` (a DO-only SQLite column the schema never
 * declared) and keeps `hlc`/hlc-adjacent wire metadata from ever reaching a
 * response: they simply aren't fields these schemas have. See
 * `docs/API.md`'s "a documented API probably wants an opaque `updatedAt`
 * and nothing else."
 *
 * **A write here is a push, not a database write** (`docs/API.md`). Both
 * `POST /api/v1/todos` and `PATCH /api/v1/todos/{id}` go through
 * `src/server/service/todos.ts`'s `createTodo`/`updateTodo`, which call
 * `UserDurableObject.push()` — the exact path `/api/sync/push` uses — so
 * `sync_meta`'s version allocation and `field_clocks` are never skipped, and
 * the P4 broadcast wakes every connected device for free.
 */

const KIND_BY_PATH = {
  todos: { kind: "todo", schema: todoSchema },
  lists: { kind: "list", schema: listSchema },
  labels: { kind: "label", schema: labelSchema },
  tabs: { kind: "tab", schema: tabSchema },
} as const;

type V1Kind = (typeof KIND_BY_PATH)[keyof typeof KIND_BY_PATH]["kind"];

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/**
 * A `switch`, not `stub.listEntities(resource.kind)` with `kind` typed as the
 * union of all four — Cloudflare's generated `DurableObjectStub` RPC-proxy
 * type does not propagate a union-typed argument through cleanly (it
 * resolves the call to `never`, silently, rather than erroring on the call
 * itself). Each branch here passes a single string LITERAL, which the stub
 * type has no trouble with.
 */
function listEntities(
  stub: DurableObjectStub<UserDurableObject>,
  kind: V1Kind,
): ReturnType<UserDurableObject["listEntities"]> {
  switch (kind) {
    case "todo":
      return stub.listEntities("todo");
    case "list":
      return stub.listEntities("list");
    case "label":
      return stub.listEntities("label");
    case "tab":
      return stub.listEntities("tab");
  }
}

async function handleCreateTodo(
  request: Request,
  stub: DurableObjectStub<UserDurableObject>,
  userId: string,
  headers: HeadersInit,
): Promise<Response> {
  const parsed = parseCreateTodoRequest(await request.json().catch(() => null));
  if (!parsed) return json({ error: "invalid-request" }, 400, headers);

  // Resolved from the authoritative store, exactly like `email/ingest.ts`
  // already does for `position` — `buildCreateTodoEntry`'s own fallback is
  // the constant `"a0"`, and every server-created todo would collide on it.
  // `reminderTime` is the parity gap A5/EI-230 closes: never resolved here
  // before, so an API-created todo in a list with a default reminder
  // silently got none.
  const position = await stub.nextTodoPosition();
  const reminderTime =
    parsed.reminderTime !== undefined
      ? parsed.reminderTime
      : await stub.defaultReminderTimeForList(parsed.listId ?? null);

  // Two stamps requested: the todo entry and its "created" todoEvent always
  // both fire on a create (see `buildCreateTodoEntry`). Durable mode, not
  // the in-memory default — see `durableHlcQueue`'s doc comment.
  const nextHlc = await durableHlcQueue(stub, 2);
  const ctx: ServiceContext = { userId, nextHlc };

  const { response, todoId } = await createTodo(
    ctx,
    { ...parsed, position, reminderTime },
    pushTransportFor(stub, userId),
  );
  if (response.rejected.length > 0) {
    // Our own builder produced an entry the DO refused — a bug here, not
    // bad input, exactly `email/ingest.ts`'s reasoning for the same check.
    console.error("v1 create-todo push rejected", response.rejected);
    return json({ error: "internal-error" }, 500, headers);
  }

  const todo = await stub.getTodo(todoId);
  return json(todo ? todoSchema.parse(todo) : null, 201, headers);
}

async function handleUpdateTodo(
  request: Request,
  stub: DurableObjectStub<UserDurableObject>,
  userId: string,
  id: string,
  headers: HeadersInit,
): Promise<Response> {
  // 404 BEFORE building a push entry — see `getTodo`'s own doc comment for
  // why an unknown/tombstoned id must never reach `push()` as a patch.
  const existing = await stub.getTodo(id);
  if (!existing) return json({ error: "not-found" }, 404, headers);

  const parsed = parseUpdateTodoRequest(await request.json().catch(() => null));
  if (!parsed) return json({ error: "invalid-request" }, 400, headers);

  // Two stamps requested even though an update MAY need only one (no
  // companion `todoEvent` when the patch touches no journalled field) — see
  // `durableHlcQueue`'s doc comment for why over-requesting is harmless.
  const nextHlc = await durableHlcQueue(stub, 2);
  const ctx: ServiceContext = { userId, nextHlc };

  const result = await updateTodo(ctx, id, parsed, pushTransportFor(stub, userId));
  if (result.rejected.length > 0) {
    console.error("v1 update-todo push rejected", result.rejected);
    return json({ error: "internal-error" }, 500, headers);
  }

  const todo = await stub.getTodo(id);
  return json(todo ? todoSchema.parse(todo) : null, 200, headers);
}

export async function handleV1Request(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  const auth0 = createAuth(env, request);

  try {
    const segment = url.pathname.slice("/api/v1/".length) as keyof typeof KIND_BY_PATH;
    const resource = KIND_BY_PATH[segment];

    if (resource && request.method === "GET") {
      const auth = await authorizeScope(auth0, request, "read");
      if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

      const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
      const rows = await listEntities(stub, resource.kind);
      return json(
        rows.map((row) => resource.schema.parse(row)),
        200,
        headers,
      );
    }

    if (segment === "todos" && request.method === "POST") {
      const auth = await authorizeScope(auth0, request, "write");
      if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

      const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
      return await handleCreateTodo(request, stub, auth.userId, headers);
    }

    const todoIdMatch = /^todos\/([^/]+)$/.exec(segment as string);
    if (todoIdMatch && request.method === "PATCH") {
      const auth = await authorizeScope(auth0, request, "write");
      if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

      const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
      return await handleUpdateTodo(request, stub, auth.userId, decodeURIComponent(todoIdMatch[1]), headers);
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    console.error("v1 route error", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}

/** Exported for `openapi/routes.ts` — one source of the four resource names
 * and their response schemas, so the docs can't drift from the dispatch. */
export const V1_RESOURCES = KIND_BY_PATH;
