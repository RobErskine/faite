import type { PushEntry, PushResponse } from "@/lib/sync/wire";
import { SYNC_PROTOCOL_VERSION } from "@/lib/sync/wire";
import {
  buildCreateTodoEntry,
  buildUpdateTodoEntry,
  type CreateTodoInput,
  type UpdateTodoInput,
} from "@/lib/service/todos";
import type { ServiceContext } from "@/lib/service/context";
import type { UserDurableObject } from "../user-do";

/**
 * Server-side (REST/MCP) adapter over the transport-agnostic builders in
 * `src/lib/service/todos.ts`. This is the piece that is genuinely
 * Worker-only — it talks to a real Durable Object stub — which is why it
 * lives under `src/server` rather than `src/lib`.
 *
 * Wired into `src/server/worker.ts` as of A5 (EI-230), via
 * `POST /api/v1/todos` and `PATCH /api/v1/todos/{id}` (`v1/routes.ts`). It
 * exists to make docs/API.md's stated rule concrete and testable:
 *
 * > a REST/MCP write is not a database write. It is a push.
 *
 * i.e. this must go through `UserDurableObject.push()` — the same RPC
 * `/api/sync/push` calls in `sync/routes.ts` — rather than opening a second
 * write path beside it. Skipping `push()` would skip `sync_meta`'s version
 * allocation and `field_clocks`, and the write would look like it landed but
 * silently be invisible to sync and reversible by the next real client push
 * (see docs/API.md's "The thing that will go wrong").
 *
 * `ServiceContext` is built from whatever authenticated the request (a
 * cookie session's `user.id`, or a verified bearer token's `referenceId` —
 * see `auth-scopes.ts`'s `authorizeScope`). `ctx.nextHlc` must be the DURABLE
 * mode (`UserDurableObject.nextServerHlc()`, A4/EI-229) for `updateTodo` —
 * an update races a real client clock, which the in-memory `serverHlcClock()`
 * mode is NOT safe against. `createTodo` may use either mode: a create has
 * no `field_clocks` to lose an LWW comparison against, so the cheaper
 * in-memory mode is fine there. Each `PushEntry` a builder returns calls
 * `ctx.nextHlc()` separately — the todo and its companion `todoEvent` get
 * two independent stamps, exactly as two separate client outbox entries would.
 */

/** What `UserDurableObject.push()` actually looks like, decoupled from the
 * DO stub itself so this module is easy to unit test with a fake. */
export type PushTransport = (entries: PushEntry[]) => Promise<PushResponse>;

/** Builds a `PushTransport` bound to one user's real Durable Object stub —
 * the only place in this file that touches a live binding. */
export function pushTransportFor(
  stub: DurableObjectStub<UserDurableObject>,
  userId: string,
): PushTransport {
  return (entries) => stub.push(userId, { protocol: SYNC_PROTOCOL_VERSION, entries });
}

/**
 * Create a todo via the sync push path rather than a direct database write.
 * Pushes the todo AND its "created" `todoEvent` in one batch — see
 * `buildCreateTodoEntry`'s doc comment for why both must land together.
 *
 * Returns `todoId` alongside the raw `PushResponse` because
 * `response.acked` is a list of OUTBOX ENTRY ids (the wire envelope,
 * `PushEntry.id`) — never the entity id a caller actually wants to read
 * back or report to the user. `buildCreateTodoEntry` mints the todo's real
 * id itself; this is the one place a caller can learn it.
 */
export async function createTodo(
  ctx: ServiceContext,
  input: CreateTodoInput,
  push: PushTransport,
): Promise<{ response: PushResponse; todoId: string }> {
  const entries = buildCreateTodoEntry(ctx, input);
  const response = await push(entries);
  return { response, todoId: entries[0].entityId };
}

/** Patch an existing todo via the sync push path. Pushes the todo AND (when
 * the patch touches a journalled field) its "edited" `todoEvent` together. */
export async function updateTodo(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTodoInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push(buildUpdateTodoEntry(ctx, id, patch));
}
