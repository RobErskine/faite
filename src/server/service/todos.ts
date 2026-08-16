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
 * NOT wired into `src/server/worker.ts`. No route calls this. It exists to
 * make docs/API.md's stated rule concrete and testable:
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
 * A real route handler (a later, separate ticket per this ticket's scope)
 * would build a `PushTransport` roughly like:
 *
 * ```ts
 * const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
 * const push: PushTransport = (entries) =>
 *   stub.push(userId, { protocol: SYNC_PROTOCOL_VERSION, entries });
 * ```
 *
 * and a `ServiceContext` built from whatever authenticated the request
 * (today: cookie session via `getSession()`; the D2 desktop-shell work this
 * scaffold is groundwork for: a verified bearer token's `referenceId`) —
 * `nextHlc` is the one field with no answer yet, see `context.ts`.
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

/** Create a todo via the sync push path rather than a direct database write. */
export async function createTodo(
  ctx: ServiceContext,
  input: CreateTodoInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push([buildCreateTodoEntry(ctx, input)]);
}

/** Patch an existing todo via the sync push path. */
export async function updateTodo(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTodoInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push([buildUpdateTodoEntry(ctx, id, patch)]);
}
