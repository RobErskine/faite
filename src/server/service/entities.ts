import {
  buildCreateDayNoteEntry,
  buildCreateLabelEntry,
  buildCreateListEntry,
  buildCreateTabEntry,
  buildDeleteEntry,
  buildUpdateDayNoteEntry,
  buildUpdateLabelEntry,
  buildUpdateListEntry,
  buildUpdateTabEntry,
  type CreateLabelInput,
  type CreateListInput,
  type CreateTabInput,
  type UpdateDayNoteInput,
  type UpdateLabelInput,
  type UpdateListInput,
  type UpdateTabInput,
} from "@/lib/service/entities";
import type { ServiceContext } from "@/lib/service/context";
import type { CivilDate } from "@/lib/schema";
import type { PushResponse, SyncKind } from "@/lib/sync/wire";
import type { PushTransport } from "./todos";

/**
 * Server-side (REST/MCP) adapter over the generic builders in
 * `src/lib/service/entities.ts` — the sibling of `./todos.ts`, and Worker-only
 * for the same reason: it talks to a real Durable Object stub.
 *
 * Everything `./todos.ts`'s header says applies verbatim, and is not repeated
 * here. The one rule worth restating because it is the whole point:
 *
 * > a REST/MCP write is not a database write. It is a push.
 *
 * `PushTransport` and `pushTransportFor` are imported from `./todos` rather
 * than redeclared — one definition, so a route mixing todo and list writes
 * can hand both the same transport.
 *
 * `ctx.nextHlc` must be the DURABLE mode (`UserDurableObject.nextServerHlc()`,
 * via `durableHlcQueue`) for every UPDATE and DELETE here — those race a real
 * client clock, which the in-memory `serverHlcClock()` mode is not safe
 * against. Creates may use either, since a create has no `field_clocks` to
 * lose an LWW comparison against.
 *
 * Each function returns the entity id alongside the raw `PushResponse` for
 * creates, because `response.acked` lists OUTBOX ENTRY ids (`PushEntry.id`),
 * never the entity id a caller wants to read back — identical reasoning to
 * `createTodo`'s own doc comment.
 */

export type { PushTransport } from "./todos";
export { pushTransportFor } from "./todos";

export async function createList(
  ctx: ServiceContext,
  input: CreateListInput,
  push: PushTransport,
): Promise<{ response: PushResponse; listId: string }> {
  const entries = buildCreateListEntry(ctx, input);
  const response = await push(entries);
  return { response, listId: entries[0].entityId };
}

export async function updateList(
  ctx: ServiceContext,
  id: string,
  patch: UpdateListInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push(buildUpdateListEntry(ctx, id, patch));
}

export async function createLabel(
  ctx: ServiceContext,
  input: CreateLabelInput,
  push: PushTransport,
): Promise<{ response: PushResponse; labelId: string }> {
  const entries = buildCreateLabelEntry(ctx, input);
  const response = await push(entries);
  return { response, labelId: entries[0].entityId };
}

export async function updateLabel(
  ctx: ServiceContext,
  id: string,
  patch: UpdateLabelInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push(buildUpdateLabelEntry(ctx, id, patch));
}

export async function createTab(
  ctx: ServiceContext,
  input: CreateTabInput,
  push: PushTransport,
): Promise<{ response: PushResponse; tabId: string }> {
  const entries = buildCreateTabEntry(ctx, input);
  const response = await push(entries);
  return { response, tabId: entries[0].entityId };
}

export async function updateTab(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTabInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push(buildUpdateTabEntry(ctx, id, patch));
}

export async function createDayNote(
  ctx: ServiceContext,
  date: CivilDate,
  body: string,
  push: PushTransport,
): Promise<{ response: PushResponse; dayNoteId: string }> {
  const entries = buildCreateDayNoteEntry(ctx, date, body);
  const response = await push(entries);
  return { response, dayNoteId: entries[0].entityId };
}

export async function updateDayNote(
  ctx: ServiceContext,
  date: CivilDate,
  patch: UpdateDayNoteInput,
  push: PushTransport,
): Promise<PushResponse> {
  return push(buildUpdateDayNoteEntry(ctx, date, patch));
}

/**
 * Soft-delete any entity kind. Deliberately NOT per-entity: a delete carries
 * no input beyond the id, so four identical wrappers would be noise.
 *
 * **The dependent rehoming a real DELETE route needs is the CALLER's job**,
 * not this function's — `deleteList` rehomes its todos to Backlog,
 * `deleteTab` rehomes its lists to the default tab, `deleteLabel` strips
 * itself from every todo's `labelIds`. Those patches must land in the SAME
 * `push()` call as this tombstone, so the DO applies them in one
 * `transactionSync`. A route therefore builds the dependents' entries,
 * concatenates this one, and pushes the batch itself rather than calling
 * this and then pushing again. See A14/A15.
 */
export async function deleteEntity(
  ctx: ServiceContext,
  kind: SyncKind,
  id: string,
  push: PushTransport,
): Promise<PushResponse> {
  return push(buildDeleteEntry(ctx, kind, id));
}
