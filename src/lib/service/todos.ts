import { uuidv7 } from "uuidv7";
import { positionAtEnd } from "@/lib/ordering";
import { todoSchema, type CivilDate, type Priority, type Todo } from "@/lib/schema";
import type { PushEntry } from "@/lib/sync/wire";
import type { ServiceContext } from "./context";

/**
 * Mirrors `repositories.ts`'s `CreateTodoInput` field-for-field — NOT
 * imported from there, even as a type-only import. `tsc -p
 * tsconfig.worker.json` (the DOM-less Workers program this module has to
 * live in — see `context.ts`) checks a whole imported *source* file the
 * moment anything imports a type from it, `import type` or not; it only
 * skips checking `.d.ts` files. `repositories.ts` transitively imports
 * Dexie/`localStorage` (`store/mutate.ts`, `store/owner.ts`,
 * `sync/hlc.ts`), so importing even its types from here would fail
 * `npm run typecheck`'s worker pass. Same tradeoff `hlc-core.ts` already
 * made for the same reason — see its file header. Keep this in sync with
 * `repositories.ts`'s `CreateTodoInput` by hand.
 */
export interface CreateTodoInput {
  title: string;
  listId?: string | null;
  scheduledDate?: CivilDate | null;
  deadline?: CivilDate | null;
  priority?: Priority | null;
  description?: string | null;
  location?: string | null;
  projectId?: string | null;
  labelIds?: string[];
  position?: string;
  reminderTime?: string | null;
  placeId?: string | null;
  /** Versioned JSON blob — see `lib/capture-source.ts`. Groundwork for D5. */
  source?: string | null;
}

/**
 * Transport-agnostic builders for `todo` writes — the flagship example of
 * the shape described in `context.ts`. The pattern (build a full record,
 * validate it against the P1 Zod schema, wrap it as a `PushEntry`) is
 * mechanical to repeat for the other nine `EntityKind`s; only `todo` is
 * built out here to keep this scaffold reviewable in one sitting.
 *
 * These builders deliberately do NOT touch `src/lib/store/repositories.ts`
 * or Dexie. `CreateTodoInput` is imported as a TYPE ONLY (erased at compile
 * time — no runtime coupling to Dexie), reused rather than redeclared so the
 * two input shapes cannot drift. The record-building logic below is
 * necessarily a second copy of `repositories.ts`'s `createTodo` defaults,
 * not a shared function — `repositories.ts` computes `position` from a
 * Dexie query (`nextTodoPosition`) and stamps timestamps/ids via
 * `store/mutate.ts`, both of which are browser-only. Reconciling the two
 * into one implementation would mean either dragging Dexie into a module
 * that has to run in a DOM-less Worker, or dragging a `push()`-shaped write
 * path into the client's synchronous Dexie transactions — both worse than
 * one small, obviously-mirrored duplication. See the file header on
 * `context.ts` for why this file has to stay DOM-free.
 *
 * "Build" is *all* these do — no I/O, no DO, no `fetch`. A caller turns the
 * returned `PushEntry` into a real write by handing it to `push()`, exactly
 * as the client's own outbox drain does. See `src/server/service/todos.ts`
 * for what that looks like from a server-side (REST/MCP) transport.
 */

function newOutboxEntryId(): string {
  return uuidv7();
}

/**
 * Fallback when the caller has no sibling positions to fractionally index
 * between — the transport-agnostic builder has no database to query the
 * way `repositories.ts`'s `nextTodoPosition()` does. A real REST/MCP route
 * needs to resolve a real "end of list" position itself (a `pull()` or a
 * dedicated read) and pass it in; this only covers "there was nothing to
 * compare against."
 */
function fallbackPosition(): string {
  return positionAtEnd(null);
}

/**
 * Builds the `PushEntry` for creating a todo. Does not create anything —
 * see the file header.
 */
export function buildCreateTodoEntry(ctx: ServiceContext, input: CreateTodoInput): PushEntry {
  const timestamp = new Date().toISOString();
  const todo: Todo = {
    id: uuidv7(),
    ownerId: ctx.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    title: input.title,
    description: input.description ?? null,
    status: "open",
    priority: input.priority ?? null,
    scheduledDate: input.scheduledDate ?? null,
    // Never stamped at creation — mirrors `repositories.ts`'s `createTodo`.
    scheduledAt: null,
    deadline: input.deadline ?? null,
    listId: input.listId ?? null,
    projectId: input.projectId ?? null,
    labelIds: input.labelIds ?? [],
    location: input.location ?? null,
    placeId: input.placeId ?? null,
    parentId: null,
    position: input.position ?? fallbackPosition(),
    recurrenceRule: null,
    recurrenceParentId: null,
    completedAt: null,
    reminderTime: input.reminderTime ?? null,
    source: input.source ?? null,
  };

  // The one safety net a hand-mirrored builder actually needs: fail loudly
  // here rather than let a malformed record reach `push()`, since nothing
  // downstream re-validates against the Zod source of truth before this hits
  // the wire.
  const validated = todoSchema.parse(todo);

  return {
    id: newOutboxEntryId(),
    kind: "todo",
    entityId: validated.id,
    // `PushEntry.patch` is JS-typed and un-narrowed by design (see
    // `wire.ts`) — a CREATE is simply a patch touching every field, the same
    // convention `store/mutate.ts`'s `create()` already uses for the
    // client's own outbox.
    patch: validated,
    hlc: ctx.nextHlc(),
  };
}

/** Fields a service-layer caller may patch. Mirrors `repositories.ts`'s
 * `updateTodo` signature: never `id`/`ownerId`/`createdAt`, which are
 * either identity or set once at creation. */
export type UpdateTodoInput = Partial<Omit<Todo, "id" | "ownerId" | "createdAt">>;

/**
 * Builds the `PushEntry` for patching an existing todo. `id` is the
 * `entityId` being patched, not part of the patch itself — same split
 * `PushEntry` already makes.
 */
export function buildUpdateTodoEntry(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTodoInput,
): PushEntry {
  const keys = Object.keys(patch) as (keyof UpdateTodoInput)[];
  if (keys.length === 0) {
    throw new Error("buildUpdateTodoEntry: empty patch");
  }

  // Validated field-by-field against exactly the keys present, via
  // `.pick()` — NOT `.partial().parse()` on the whole object. Every one of
  // `todoSchema`'s fields carries `.nullable().default(null)` (or similar),
  // and Zod applies a field's default to any key that's simply ABSENT from
  // the input, `.partial()` or not. Validating a `{ status: "done" }` patch
  // against `todoSchema.partial()` silently expands it to every other field
  // set back to its default — turning "update just `status`" into
  // "overwrite everything else on the wire" the moment it reaches `push()`.
  // `.pick()` only ever asks about keys that were actually provided.
  const mask = Object.fromEntries(keys.map((key) => [key, true])) as Record<
    keyof UpdateTodoInput,
    true
  >;
  const validated = todoSchema.pick(mask).parse(patch);

  return {
    id: newOutboxEntryId(),
    kind: "todo",
    entityId: id,
    patch: validated,
    hlc: ctx.nextHlc(),
  };
}
