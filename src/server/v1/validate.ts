import { z } from "zod";
import { todoSchema } from "@/lib/schema";

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
 * `null` for "malformed" (400) as well as "well-formed but empty" — an empty
 * patch is never a valid PATCH, same rule `buildUpdateTodoEntry` enforces.
 *
 * Builds its `.pick()` mask from the keys ACTUALLY PRESENT in `body` —
 * exactly `buildUpdateTodoEntry`'s own pattern, and for the identical
 * reason its comment gives: every `todoSchema` field carries a Zod
 * `.default(...)`, and `.default()` fires for any key Zod's parser
 * considers ABSENT regardless of whether `.partial()` made it optional. A
 * static `todoSchema.pick(ALL_FIELDS).partial()` — this file's FIRST
 * version, caught by this file's own tests before it ever shipped — silently
 * expanded `{ status: "done" }` into a patch touching all thirteen other
 * fields, each reset to its schema default. Sent to `push()`, that would
 * have overwritten a todo's title, description, dates, and list, the exact
 * "the API's write vanishes and looks like a sync bug" failure `docs/API.md`
 * warns a real write-vs-database-write confusion produces — except louder,
 * since here it wouldn't even vanish, it would actively clobber.
 */
export function parseUpdateTodoRequest(body: unknown): UpdateTodoRequest | null {
  if (typeof body !== "object" || body === null) return null;

  const keys = Object.keys(body).filter((key) => UPDATABLE_FIELDS.has(key));
  if (keys.length === 0) return null;

  const mask = Object.fromEntries(keys.map((key) => [key, true])) as Record<
    keyof UpdateTodoRequest,
    true
  >;
  const parsed = todoSchema.pick(mask).safeParse(body);
  return parsed.success ? (parsed.data as UpdateTodoRequest) : null;
}
