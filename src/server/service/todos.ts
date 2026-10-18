import type { PushEntry, PushResponse } from "@/lib/sync/wire";
import { SYNC_PROTOCOL_VERSION } from "@/lib/sync/wire";
import {
  buildCreateTodoEntry,
  buildAddNoteEntry,
  buildDeleteTodoEntry,
  buildUpdateTodoEntry,
  type CreateTodoInput,
  type DeleteTodoInput,
  type UpdateTodoBefore,
  type UpdateTodoInput,
} from "@/lib/service/todos";
import type { ServiceContext } from "@/lib/service/context";
import { doneCriterionSchema, type DoneCriterion } from "@/lib/schema";
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
 * Resolves which assignee (agent) a verified API key acts as (EI-402). The
 * key id is the only input: names and metadata on a key are spoofable and
 * never used. `lookup` is the DO query `assignee where ownerId = userId AND
 * apiKeyId = keyId`; a session (no key) or a key bound to no assignee is the
 * user themselves, i.e. null.
 */
export async function resolveActorAssigneeId(
  keyId: string | null,
  lookup: (keyId: string) => Promise<string | null>,
): Promise<string | null> {
  if (!keyId) return null;
  return (await lookup(keyId)) ?? null;
}

/** What `stampActor` needs from the stored row: the criteria that already
 * exist, whose `addedBy` must survive an agent re-sending the whole list. */
export interface StampBefore {
  doneCriteria?: unknown;
}

/**
 * Overwrites every client-supplied attribution with the server-resolved
 * actor (EI-402). A caller can put anything in an event payload or a
 * criterion's `addedBy`; neither is believed.
 *
 * - Every `todoEvent` payload gets `via: agent:<id>` when there is an actor,
 *   and has any `via` of that shape stripped when there is not. The
 *   client-only values (`overdrive`, `smart-sort`) never come from this path.
 * - A criterion whose id is NOT already on the stored row is new, so its
 *   `addedBy` becomes the actor (null for the user). One that already exists
 *   keeps its stored `addedBy`.
 */
export function stampActor(
  ctx: ServiceContext,
  entries: PushEntry[],
  before?: StampBefore,
): PushEntry[] {
  const actor = ctx.actorAssigneeId ?? null;
  const existing = new Map<string, DoneCriterion>();
  const stored = doneCriterionSchema.array().safeParse(before?.doneCriteria);
  if (stored.success) for (const criterion of stored.data) existing.set(criterion.id, criterion);

  return entries.map((entry) => {
    if (entry.kind === "todoEvent") {
      const patch = { ...(entry.patch as Record<string, unknown>) };
      const raw = typeof patch.payload === "string" ? safeJsonObject(patch.payload) : {};
      const { via: _ignored, ...rest } = raw;
      const payload = actor ? { v: 1, ...rest, via: `agent:${actor}` } : rest;
      patch.payload = actor || Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
      return { ...entry, patch };
    }
    if (entry.kind === "todo") {
      const patch = entry.patch as Record<string, unknown>;
      if (!Array.isArray(patch.doneCriteria)) return entry;
      const doneCriteria = (patch.doneCriteria as DoneCriterion[]).map((criterion) => {
        const stored = existing.get(criterion.id);
        return stored ? { ...criterion, addedBy: stored.addedBy ?? null } : { ...criterion, addedBy: actor };
      });
      return { ...entry, patch: { ...patch, doneCriteria } };
    }
    return entry;
  });
}

function safeJsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
  const entries = stampActor(ctx, buildCreateTodoEntry(ctx, input));
  const response = await push(entries);
  return { response, todoId: entries[0].entityId };
}

/** Patch an existing todo via the sync push path. Pushes the todo AND its
 * `todoEvent`s together. `before` is the stored row the caller already read;
 * it is what lets a status or date change be logged as one (EI-321). Size
 * the caller's `durableHlcQueue` with `UPDATE_TODO_MAX_ENTRIES`. */
export async function updateTodo(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTodoInput,
  push: PushTransport,
  before?: UpdateTodoBefore & StampBefore,
): Promise<PushResponse> {
  return push(stampActor(ctx, buildUpdateTodoEntry(ctx, id, patch, before), before));
}

/**
 * Soft-delete a todo via the sync push path (A13, EI-293). Orphans its
 * children, tombstones its attachment ROWS (never the R2 bytes), logs a
 * `deleted` event with a title snapshot, and tombstones the todo — all in
 * ONE push, so the DO applies them in one `transactionSync`.
 *
 * `input` is resolved by the caller from the DO before this is called, which
 * is also what lets the route size its `durableHlcQueue` correctly. See
 * `buildDeleteTodoEntry` for the full reasoning on each of the four parts.
 */
export async function deleteTodo(
  ctx: ServiceContext,
  id: string,
  input: DeleteTodoInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push(stampActor(ctx, buildDeleteTodoEntry(ctx, id, input)));
}

/** Append a progress `note` event to a to-do's history (EI-402). One push; the
 * caller sizes `durableHlcQueue` at 1. `via` is stamped from `ctx`. */
export async function addNote(
  ctx: ServiceContext,
  todoId: string,
  text: string,
  push: PushTransport,
): Promise<PushResponse> {
  return push(stampActor(ctx, buildAddNoteEntry(ctx, todoId, text)));
}
