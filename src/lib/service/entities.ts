import { uuidv7 } from "uuidv7";
import {
  dayNoteSchema,
  labelSchema,
  listSchema,
  tabSchema,
  type CivilDate,
  type DayNote,
  type Label,
  type List,
  type Tab,
} from "@/lib/schema";
import type { PushEntry, SyncKind } from "@/lib/sync/wire";
import type { ServiceContext } from "./context";

/**
 * Transport-agnostic builders for `list` / `label` / `tab` / `dayNote`
 * writes (A12, EI-292) — the generic sibling of `./todos.ts`.
 *
 * Same contract as that file, and the same constraints: DOM-free (see
 * `./context.ts`), no I/O, no Durable Object, no `fetch`. "Build" is all
 * these do. A caller turns the returned `PushEntry[]` into a real write by
 * handing it to `push()` — see `src/server/service/entities.ts`.
 *
 * ## Why this one is generic and `todos.ts` is not
 *
 * Not DRY for its own sake. The dynamic pick-from-present-keys mask in
 * `buildUpdate` below is safety-critical, and hand-writing it four more
 * times is four more chances to write `.partial()` instead.
 *
 * That is not hypothetical. `server/v1/validate.ts`'s own header records
 * that the static-`.partial()` version was that file's FIRST version, caught
 * by its tests before it shipped. Every field on these schemas carries a Zod
 * `.default()`, and `.default()` fires for any key the parser considers
 * ABSENT — so a static mask silently expands a one-field patch into one that
 * overwrites everything else (`.ai/lessons.md`, "A Zod field with
 * `.default()` fires on ANY absent key").
 *
 * The stakes here are higher than they were for todos. `listSchema.isBacklog`
 * defaults to `false`, so a static-mask rename of the Backlog list would
 * leave the account with no backlog at all, a `deleteList` guard that never
 * fires again, and homeless todos with nowhere to land. `tabSchema.isDefault`
 * is the identical shape.
 *
 * **`todos.ts` deliberately stays separate.** `buildCreateTodoEntry` returns
 * a companion `todoEvent` entry unconditionally and `buildUpdateTodoEntry`
 * returns one conditionally; folding that in would need a `companionEntries`
 * hook that makes this module harder to read than the duplication it
 * removes. Same spirit as that file's own "only `todo` is built out here."
 * None of the four kinds below has a journal.
 *
 * ## Mirrored, not imported
 *
 * The record-building defaults below are a second copy of
 * `src/lib/store/repositories.ts`'s own `createList`/`createLabel`/
 * `createTab`/`setDayNote`, for exactly the reason `todos.ts`'s header
 * gives: `repositories.ts` transitively imports Dexie and `localStorage`,
 * and `tsc -p tsconfig.worker.json` checks a whole imported *source* file
 * even for a type-only import. Keep them in sync by hand.
 */

function newOutboxEntryId(): string {
  return uuidv7();
}

/**
 * What varies between the four kinds. Everything else about a create, an
 * update and a delete is identical, which is the entire argument for this
 * module existing.
 */
interface EntityBuilderSpec {
  kind: SyncKind;
  /** The P1 Zod schema. The one safety net a hand-mirrored builder needs:
   * fail loudly here rather than let a malformed record reach `push()`,
   * since nothing downstream re-validates against the source of truth. */
  schema:
    | typeof listSchema
    | typeof labelSchema
    | typeof tabSchema
    | typeof dayNoteSchema;
}

const LIST: EntityBuilderSpec = { kind: "list", schema: listSchema };
const LABEL: EntityBuilderSpec = { kind: "label", schema: labelSchema };
const TAB: EntityBuilderSpec = { kind: "tab", schema: tabSchema };
const DAY_NOTE: EntityBuilderSpec = { kind: "dayNote", schema: dayNoteSchema };

/**
 * A CREATE is simply a patch touching every field — the same convention
 * `store/mutate.ts`'s `create()` uses for the client's own outbox, and the
 * reason `PushEntry.patch` is JS-typed and un-narrowed (see `wire.ts`).
 */
function buildCreate(
  ctx: ServiceContext,
  spec: EntityBuilderSpec,
  record: Record<string, unknown>,
): PushEntry[] {
  const validated = spec.schema.parse(record) as { id: string };

  return [
    {
      id: newOutboxEntryId(),
      kind: spec.kind,
      entityId: validated.id,
      patch: validated,
      hlc: ctx.nextHlc(),
    },
  ];
}

/**
 * Validated field-by-field against exactly the keys present, via `.pick()`
 * — never `.partial().parse()` on the whole object. See this file's header
 * for what the static form costs, and `buildUpdateTodoEntry`'s own comment
 * for the same reasoning applied to todos.
 *
 * Stamps `updatedAt`, which `mutate()` does on every client write.
 */
function buildUpdate(
  ctx: ServiceContext,
  spec: EntityBuilderSpec,
  id: string,
  patch: Record<string, unknown>,
): PushEntry[] {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new Error(`buildUpdate: empty patch for ${spec.kind}`);
  }

  const mask = Object.fromEntries(keys.map((key) => [key, true])) as Record<string, true>;
  // Same boundary cast as `server/v1/validate.ts`'s `parsePatchRequest`: the
  // mask is built at runtime from the caller's own keys, which Zod v4's
  // `.pick()` signature — wanting a statically-known subset of the shape —
  // can never express. `safeParse`/`parse` still checks every VALUE.
  const picked = (spec.schema as unknown as {
    pick(mask: Record<string, true>): { parse(value: unknown): Record<string, unknown> };
  }).pick(mask);

  const validated = picked.parse(patch);
  const stamped = { ...validated, updatedAt: new Date().toISOString() };

  return [
    {
      id: newOutboxEntryId(),
      kind: spec.kind,
      entityId: id,
      patch: stamped,
      hlc: ctx.nextHlc(),
    },
  ];
}

/**
 * Soft delete — a tombstone, never a row removal. `deletedAt` is not in
 * `SERVER_ONLY_FIELDS` (`wire.ts`), so it passes `sanitizePatch` like any
 * other field.
 *
 * Built directly rather than through `buildUpdate` because `deletedAt` is
 * the one field a route's `updatable` allow-list must never contain — DELETE
 * owns it, and routing it through the patch path would mean a PATCH could
 * reach it by naming it.
 */
export function buildDeleteEntry(
  ctx: ServiceContext,
  kind: SyncKind,
  id: string,
): PushEntry[] {
  const timestamp = new Date().toISOString();

  return [
    {
      id: newOutboxEntryId(),
      kind,
      entityId: id,
      patch: { deletedAt: timestamp, updatedAt: timestamp },
      hlc: ctx.nextHlc(),
    },
  ];
}

/* ------------------------------------------------------------------ lists */

export interface CreateListInput {
  name: string;
  /** Resolved by the caller from `UserDurableObject.nextPosition("list")` —
   * this module has no store to query. Same split as `CreateTodoInput`. */
  position: string;
  color?: string | null;
  emoji?: string | null;
  iconUrl?: string | null;
  tabId?: string | null;
  description?: string | null;
  defaultReminderPresetId?: string | null;
}

/** Never `isBacklog` (exactly one per user, minted at seed time) and never
 * `archivedWithTabId` (`archiveTab`'s own bookkeeping — see `listSchema`). */
export type UpdateListInput = Partial<
  Pick<
    List,
    | "name"
    | "color"
    | "emoji"
    | "iconUrl"
    | "tabId"
    | "description"
    | "defaultReminderPresetId"
    | "archivedAt"
    | "position"
  >
>;

export function buildCreateListEntry(ctx: ServiceContext, input: CreateListInput): PushEntry[] {
  const timestamp = new Date().toISOString();

  return buildCreate(ctx, LIST, {
    id: uuidv7(),
    ownerId: ctx.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name: input.name,
    isBacklog: false,
    archivedAt: null,
    archivedWithTabId: null,
    position: input.position,
    tabId: input.tabId ?? null,
    defaultReminderPresetId: input.defaultReminderPresetId ?? null,
    description: input.description ?? null,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    iconUrl: input.iconUrl ?? null,
  });
}

export function buildUpdateListEntry(
  ctx: ServiceContext,
  id: string,
  patch: UpdateListInput,
): PushEntry[] {
  return buildUpdate(ctx, LIST, id, patch);
}

/* ----------------------------------------------------------------- labels */

export interface CreateLabelInput {
  name: string;
  position: string;
  color?: string | null;
  emoji?: string | null;
  iconUrl?: string | null;
}

export type UpdateLabelInput = Partial<
  Pick<Label, "name" | "color" | "emoji" | "iconUrl" | "position">
>;

export function buildCreateLabelEntry(ctx: ServiceContext, input: CreateLabelInput): PushEntry[] {
  const timestamp = new Date().toISOString();

  return buildCreate(ctx, LABEL, {
    id: uuidv7(),
    ownerId: ctx.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name: input.name,
    position: input.position,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    iconUrl: input.iconUrl ?? null,
  });
}

export function buildUpdateLabelEntry(
  ctx: ServiceContext,
  id: string,
  patch: UpdateLabelInput,
): PushEntry[] {
  return buildUpdate(ctx, LABEL, id, patch);
}

/* ------------------------------------------------------------------- tabs */

export interface CreateTabInput {
  name: string;
  position: string;
  color?: string | null;
  emoji?: string | null;
  iconUrl?: string | null;
  description?: string | null;
}

/** Never `isDefault` — the guaranteed destination for lists rehomed by
 * `deleteTab`, exactly the role Backlog plays for todos (`tabSchema`). */
export type UpdateTabInput = Partial<
  Pick<Tab, "name" | "color" | "emoji" | "iconUrl" | "description" | "archivedAt" | "position">
>;

export function buildCreateTabEntry(ctx: ServiceContext, input: CreateTabInput): PushEntry[] {
  const timestamp = new Date().toISOString();

  return buildCreate(ctx, TAB, {
    id: uuidv7(),
    ownerId: ctx.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    name: input.name,
    description: input.description ?? null,
    isDefault: false,
    archivedAt: null,
    position: input.position,
    color: input.color ?? null,
    emoji: input.emoji ?? null,
    iconUrl: input.iconUrl ?? null,
  });
}

export function buildUpdateTabEntry(
  ctx: ServiceContext,
  id: string,
  patch: UpdateTabInput,
): PushEntry[] {
  return buildUpdate(ctx, TAB, id, patch);
}

/* -------------------------------------------------------------- day notes */

/**
 * Hand-mirrors `store/repositories.ts`'s `dayNoteId` — NOT imported, for the
 * reason this file's header gives (`repositories.ts` is Dexie-bound).
 *
 * The id being derived from the date, rather than random, is what lets
 * `PUT /api/v1/day-notes/{date}` be a clean upsert with no create/update
 * split at the URL. Keep the two in sync by hand.
 */
export function dayNoteIdFor(date: CivilDate): string {
  return `daynote:${date}`;
}

export type UpdateDayNoteInput = Partial<Pick<DayNote, "body" | "deletedAt">>;

/**
 * A day note for a date that has no row yet. The caller MUST have checked
 * that first — `date` is `notNull()` with no SQL default, so pushing a bare
 * `{ body }` patch at a non-existent id hits the DO's insert-with-
 * `FIELD_DEFAULTS` path (the EI-68 mechanism) and writes a garbage row.
 */
export function buildCreateDayNoteEntry(
  ctx: ServiceContext,
  date: CivilDate,
  body: string,
): PushEntry[] {
  const timestamp = new Date().toISOString();

  return buildCreate(ctx, DAY_NOTE, {
    id: dayNoteIdFor(date),
    ownerId: ctx.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    date,
    body,
  });
}

/**
 * Patch an existing day note. Clearing one is `{ body: "" }`, never a
 * tombstone: the id is deterministic and guaranteed to be recreated the next
 * time that day is opened, so `deletedAt` would only buy a
 * resurrect-vs-tombstone race — `dayNoteSchema`'s doc comment is explicit.
 *
 * `deletedAt: null` IS accepted here, mirroring `setDayNote`: a note written
 * to a day whose row was tombstoned by some older path has to come back.
 */
export function buildUpdateDayNoteEntry(
  ctx: ServiceContext,
  date: CivilDate,
  patch: UpdateDayNoteInput,
): PushEntry[] {
  return buildUpdate(ctx, DAY_NOTE, dayNoteIdFor(date), patch);
}
