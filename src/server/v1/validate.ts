import { z } from "zod";
import { listSchema, todoSchema } from "@/lib/schema";

/**
 * Request validation for `/api/v1/todos` writes (A5, EI-230). Same
 * convention as `src/server/sync/validate.ts`/`places/validate.ts`: parse to
 * `null`, let the caller map that to a 400, never throw.
 *
 * Built off `todoSchema` — the same source `openapi/routes.ts` uses for the
 * response shape — via `.pick()`, rather than a hand-typed duplicate.
 * Deliberately excludes `position` (server-resolved via
 * `UserDurableObject.nextTodoPosition()`, never client-settable — see
 * `docs/API.md`'s "don't add a second answer") and every
 * `SERVER_ONLY_FIELDS`-adjacent field (`id`, `ownerId`, `version`, `hlc`,
 * the last two of which don't even exist on this schema).
 */

const OPTIONAL_ON_CREATE = {
  description: true,
  priority: true,
  scheduledDate: true,
  deadline: true,
  listId: true,
  projectId: true,
  labelIds: true,
  location: true,
  placeId: true,
  reminderTime: true,
  source: true,
  parentId: true,
} as const;

const CREATE_FIELDS = { title: true, ...OPTIONAL_ON_CREATE } as const;

export const createTodoRequestSchema = todoSchema.pick(CREATE_FIELDS).partial(OPTIONAL_ON_CREATE);

export type CreateTodoRequest = z.infer<typeof createTodoRequestSchema>;

export function parseCreateTodoRequest(body: unknown): CreateTodoRequest | null {
  const parsed = createTodoRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** `CREATE_FIELDS` plus the two fields only an update may touch — a new
 * todo is always `open` with no `completedAt` (`buildCreateTodoEntry`
 * hardcodes both), so neither belongs in `CREATE_FIELDS`. */
const UPDATABLE_FIELDS = new Set([...Object.keys(CREATE_FIELDS), "status", "completedAt"]);

/** For `openapi/routes.ts` — a STATIC, illustrative shape for docs. NEVER
 * used for real request parsing: see `parseUpdateTodoRequest`'s own doc
 * comment for why a static `.partial()` schema is actively unsafe here. */
export const updateTodoRequestSchema = todoSchema
  .pick({ ...CREATE_FIELDS, status: true, completedAt: true })
  .partial();

export type UpdateTodoRequest = z.infer<typeof updateTodoRequestSchema>;

/**
 * The shared PATCH parser (A11, EI-291). Returns `null` for "malformed"
 * (400) as well as "well-formed but empty" — an empty patch is never a valid
 * PATCH, the same rule `buildUpdateTodoEntry` enforces.
 *
 * **Builds its `.pick()` mask from the keys ACTUALLY PRESENT in `body`**,
 * rather than from a static `.partial()` schema. That is not a style
 * preference; it is the whole reason this function exists.
 *
 * Every field on these schemas carries a Zod `.default(...)`, and
 * `.default()` fires for any key Zod's parser considers ABSENT — regardless
 * of whether `.partial()` made it optional (`.ai/lessons.md`, "A Zod field
 * with `.default()` fires on ANY absent key"). A static
 * `todoSchema.pick(ALL_FIELDS).partial()` — this file's FIRST version,
 * caught by this file's own tests before it ever shipped — silently expanded
 * `{ status: "done" }` into a patch touching all thirteen other fields, each
 * reset to its schema default. Sent to `push()`, that would have overwritten
 * a todo's title, description, dates, and list: the exact "the API's write
 * vanishes and looks like a sync bug" failure `docs/API.md` warns about,
 * except louder, since it wouldn't vanish, it would actively clobber.
 *
 * **The exposure is worse on the entities A14/A15 add.** `listSchema` has
 * `isBacklog: z.boolean().default(false)`, so a static-`.partial()` PATCH
 * that merely renamed a list would also set `isBacklog: false` on the
 * Backlog list — leaving that account with no backlog, a delete guard that
 * never fires again, and homeless todos with nowhere to land. `tabSchema`
 * has the identical shape via `isDefault`. Extracting this once, rather than
 * hand-writing the mask per entity, is what keeps that from being rediscovered
 * four more times.
 *
 * `updatable` is the allow-list of field names a given route accepts; keys
 * outside it are dropped before the mask is built, so a caller can never
 * reach a server-owned field (`id`, `ownerId`, `position`, `deletedAt`) by
 * naming it.
 */
export function parsePatchRequest<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  updatable: ReadonlySet<string>,
  body: unknown,
): Partial<z.infer<S>> | null {
  if (typeof body !== "object" || body === null) return null;

  const keys = Object.keys(body).filter((key) => updatable.has(key));
  if (keys.length === 0) return null;

  // The mask is built at RUNTIME from the request's own keys, so its type is
  // `Record<string, true>` — while Zod v4's `.pick()` wants a mask whose keys
  // are STATICALLY known to be a subset of the schema's shape. A dynamic mask
  // can never satisfy that, so cast at this one boundary rather than weaken
  // the signature or hand-write the mask per entity (which is the thing this
  // function exists to prevent). Nothing is lost: `updatable` already
  // guarantees every surviving key names a real field, and `safeParse`
  // re-checks every VALUE against the real schema either way.
  const mask = Object.fromEntries(keys.map((key) => [key, true])) as Record<string, true>;
  const picked = (schema as unknown as {
    pick(mask: Record<string, true>): z.ZodObject<z.ZodRawShape>;
  }).pick(mask);

  const parsed = picked.safeParse(body);
  return parsed.success ? (parsed.data as Partial<z.infer<S>>) : null;
}

/** `PATCH /api/v1/todos/{id}`. See `parsePatchRequest` for why the mask is
 * dynamic — this is a three-line wrapper over it, not its own algorithm. */
export function parseUpdateTodoRequest(body: unknown): UpdateTodoRequest | null {
  return parsePatchRequest(todoSchema, UPDATABLE_FIELDS, body) as UpdateTodoRequest | null;
}

// ---------------------------------------------------------------- lists (A14)

/**
 * Deliberately excludes four fields, each for its own reason:
 *
 * - **`isBacklog`** — exactly one per account, minted at seed time. A caller
 *   setting it true would give the account two backlogs; setting it false on
 *   the real one leaves it with none, `deleteList`'s guard permanently
 *   disarmed, and homeless todos with nowhere to land.
 * - **`archivedWithTabId`** — `archiveTab`'s own bookkeeping. A client
 *   writing it corrupts `unarchiveTab`'s grouping (see `listSchema`).
 * - **`position`** — server-resolved from `nextPosition("list")`, never
 *   client-settable on create. `docs/API.md`: don't add a second answer.
 * - **`deletedAt`** — DELETE owns it. Reaching it through a PATCH would make
 *   a soft delete possible without the rehoming that has to accompany one.
 */
const LIST_OPTIONAL_ON_CREATE = {
  color: true,
  emoji: true,
  iconUrl: true,
  tabId: true,
  description: true,
  defaultReminderPresetId: true,
} as const;

const LIST_CREATE_FIELDS = { name: true, ...LIST_OPTIONAL_ON_CREATE } as const;

export const createListRequestSchema = listSchema
  .pick(LIST_CREATE_FIELDS)
  .partial(LIST_OPTIONAL_ON_CREATE);

export type CreateListRequest = z.infer<typeof createListRequestSchema>;

export function parseCreateListRequest(body: unknown): CreateListRequest | null {
  const parsed = createListRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** `archivedAt` is patchable — putting a list away is a real user action,
 * and unlike `deletedAt` it carries no rehoming. */
const UPDATABLE_LIST_FIELDS = new Set([
  ...Object.keys(LIST_CREATE_FIELDS),
  "archivedAt",
  // The client computes a valid fractional index; see `lib/ordering.ts`.
  // Allowed on PATCH but not create, so reorder needs no second endpoint.
  "position",
]);

/** For `openapi/routes.ts` — a STATIC, illustrative shape for docs only.
 * NEVER used for real parsing: see `parsePatchRequest`. */
export const updateListRequestSchema = listSchema
  .pick({ ...LIST_CREATE_FIELDS, archivedAt: true, position: true })
  .partial();

export type UpdateListRequest = z.infer<typeof updateListRequestSchema>;

export function parseUpdateListRequest(body: unknown): UpdateListRequest | null {
  return parsePatchRequest(listSchema, UPDATABLE_LIST_FIELDS, body) as UpdateListRequest | null;
}
