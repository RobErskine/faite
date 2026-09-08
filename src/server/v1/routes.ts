import { todoSchema, type Todo } from "@/lib/schema";
import type { ServiceContext } from "@/lib/service/context";
import { createAuth } from "../auth";
import { authorizeScope } from "../auth-scopes";
import { corsHeaders, handleOptions } from "../cors";
import { durableHlcQueue } from "../service/hlc";
import { createTodo, deleteTodo, pushTransportFor, updateTodo } from "../service/todos";
import type { UserDurableObject } from "../user-do";
import { filterTodos, parseTodoQuery } from "./query";
import { V1_RESOURCES, type V1Kind } from "./resources";
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
    case "attachment":
      return stub.listEntities("attachment");
  }
}

/**
 * Same `never`-through-the-RPC-proxy workaround as `listEntities` below, and
 * the same fix: an explicit return-type annotation on a top-level function.
 *
 * Needed here specifically because `handleDeleteTodo` READS a field off the
 * result (`title`, for the deleted-event snapshot). The other call sites only
 * null-check it, so they never provoked the failure — `Property 'title' does
 * not exist on type 'never'` was the only symptom, pointing at the property
 * rather than at the call.
 */
function getTodoRow(
  stub: DurableObjectStub<UserDurableObject>,
  id: string,
): ReturnType<UserDurableObject["getTodo"]> {
  return stub.getTodo(id);
}

async function handleCreateTodo(
  request: Request,
  stub: DurableObjectStub<UserDurableObject>,
  userId: string,
  headers: HeadersInit,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = parseCreateTodoRequest(body);
  if (!parsed) return json({ error: "invalid-request" }, 400, headers);

  // Key PRESENCE on the raw body, not a check on the parsed value (EI-308).
  // `todoSchema.reminderTime` carries `.nullable().default(null)`, and
  // `.partial()` does not stop `.default()` firing on an absent key — so
  // `parsed.reminderTime` is ALWAYS `null` rather than `undefined` when the
  // caller omitted it. The original `!== undefined` test was therefore always
  // true, and `defaultReminderTimeForList` was never called: the exact parity
  // gap A5/EI-230's comment below claims to have closed, live in production
  // since it shipped. See `.ai/lessons.md`, "A Zod field with `.default()`
  // fires on ANY absent key".
  //
  // An explicit `"reminderTime": null` still means "no reminder" and must not
  // fall through to the list default — which is why this is key presence and
  // not a null check.
  const suppliedReminderTime =
    typeof body === "object" && body !== null && "reminderTime" in body;

  // Resolved from the authoritative store, exactly like `email/ingest.ts`
  // already does for `position` — `buildCreateTodoEntry`'s own fallback is
  // the constant `"a0"`, and every server-created todo would collide on it.
  // `reminderTime` is the parity gap A5/EI-230 closes: never resolved here
  // before, so an API-created todo in a list with a default reminder
  // silently got none.
  const position = await stub.nextTodoPosition();
  const reminderTime = suppliedReminderTime
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

/**
 * `DELETE /api/v1/todos/{id}` (A13, EI-293).
 *
 * A soft delete is FOUR things, not one field — see `buildDeleteTodoEntry`
 * for why each one is load-bearing. The dependents are read here, BEFORE the
 * HLC queue is built, because `durableHlcQueue` pre-fetches a fixed N and
 * throws if a builder overruns it. All of it lands in one `push()`.
 */
async function handleDeleteTodo(
  stub: DurableObjectStub<UserDurableObject>,
  userId: string,
  id: string,
  headers: HeadersInit,
): Promise<Response> {
  // 404 BEFORE building a push entry, same rule the PATCH path follows —
  // see `getTodo`'s doc comment for why an unknown/tombstoned id must never
  // reach `push()` as a patch.
  const existing = await getTodoRow(stub, id);
  if (!existing) return json({ error: "not-found" }, 404, headers);

  const [childIds, attachmentIds] = await Promise.all([
    stub.childTodoIds(id),
    stub.attachmentIdsForTodo(id),
  ]);

  // One stamp per child, one per attachment, one for the `deleted` event,
  // one for the todo's own tombstone. Over-requested by one, matching the
  // convention the create/update paths already use.
  const entryCount = childIds.length + attachmentIds.length + 2;
  const nextHlc = await durableHlcQueue(stub, entryCount + 1);
  const ctx: ServiceContext = { userId, nextHlc };

  const title = typeof existing.title === "string" ? existing.title : "";
  const { rejected } = await deleteTodo(
    ctx,
    id,
    { title, childIds, attachmentIds },
    pushTransportFor(stub, userId),
  );
  if (rejected.length > 0) {
    console.error("v1 delete-todo push rejected", rejected);
    return json({ error: "internal-error" }, 500, headers);
  }

  // 204, not 200 — `getTodo` filters tombstones, so there is nothing left to
  // return. Deliberately asymmetric with POST/PATCH, which both echo the row.
  return new Response(null, { status: 204, headers });
}

export async function handleV1Request(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  const auth0 = createAuth(env, request);

  try {
    const segment = url.pathname.slice("/api/v1/".length) as keyof typeof V1_RESOURCES;
    const resource = V1_RESOURCES[segment];

    if (resource && request.method === "GET") {
      const auth = await authorizeScope(auth0, request, "read");
      if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

      const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
      const rows = await listEntities(stub, resource.kind);
      const parsed = rows.map((row) => resource.schema.parse(row));

      // Filters are todo-only (A13, EI-293). The other four resources are
      // small enough that a filter would be answering a question nobody
      // asked — and every one of them a client could ask locally.
      if (resource.kind === "todo") {
        const query = parseTodoQuery(url.searchParams);
        if (!query) return json({ error: "invalid-request" }, 400, headers);
        return json(filterTodos(parsed as Todo[], query), 200, headers);
      }

      return json(parsed, 200, headers);
    }

    if (segment === "todos" && request.method === "POST") {
      const auth = await authorizeScope(auth0, request, "write");
      if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

      const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
      return await handleCreateTodo(request, stub, auth.userId, headers);
    }

    const todoIdMatch = /^todos\/([^/]+)$/.exec(segment as string);
    if (todoIdMatch) {
      const todoId = decodeURIComponent(todoIdMatch[1]);

      if (request.method === "GET") {
        const auth = await authorizeScope(auth0, request, "read");
        if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

        const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
        const todo = await stub.getTodo(todoId);
        if (!todo) return json({ error: "not-found" }, 404, headers);
        return json(todoSchema.parse(todo), 200, headers);
      }

      if (request.method === "PATCH") {
        const auth = await authorizeScope(auth0, request, "write");
        if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

        const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
        return await handleUpdateTodo(request, stub, auth.userId, todoId, headers);
      }

      if (request.method === "DELETE") {
        const auth = await authorizeScope(auth0, request, "write");
        if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

        const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
        return await handleDeleteTodo(stub, auth.userId, todoId, headers);
      }
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    console.error("v1 route error", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}

/**
 * Re-exported for one release so nothing breaks mid-refactor (A11, EI-291).
 * The map itself now lives in `./resources`, and `openapi/routes.ts` imports
 * it from there — see that file's header for why the doc generator must not
 * load this one.
 */
export { V1_RESOURCES } from "./resources";
