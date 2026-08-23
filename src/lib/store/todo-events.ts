import type { CivilDate, Priority, TodoEvent } from "@/lib/schema";
import { newId, now } from "./mutate";
import { getCurrentOwnerId } from "./owner";

/**
 * The per-todo history log — see `todoEventSchema` in `lib/schema.ts` for the
 * sync-kind shape, and the ticket (EI-94) for the full design.
 *
 * `kind` on the wire is `z.string()`, not an enum, so this module's kinds are
 * a convention the render layer trusts, not a contract the schema enforces —
 * an event whose `kind` isn't one of these renders as a neutral "Updated" row
 * instead of throwing (see `todo-timeline.ts`).
 */
export type TodoEventKind =
  | "created"
  | "scheduled"
  | "unscheduled"
  | "moved"
  | "done"
  | "dropped"
  | "reopened"
  | "edited"
  | "deleted";

interface EmptyPayload {
  v: 1;
}

export interface ScheduledPayload {
  v: 1;
  from: CivilDate | null;
  to: CivilDate | null;
}

export interface MovedPayload {
  v: 1;
  /** Denormalized alongside the id, so "Moved to Groceries" still reads that
   * way after Groceries is renamed or deleted — the id resolves through
   * `listsById` for an accent color when it can, and degrades to no accent
   * when it can't. */
  fromListId: string | null;
  fromListName: string | null;
  toListId: string | null;
  toListName: string | null;
}

export interface EditedPayload {
  v: 1;
  /** Field names touched by the patch, e.g. `["title", "priority"]`. */
  fields: string[];
  /** Values captured only for small categorical fields — never `title` or
   * `description`, which would roughly double note-edit storage and create a
   * surface where deleted text lives forever in a synced table. */
  to?: { priority?: Priority | null; deadline?: CivilDate | null };
}

/** Cap on `DeletedPayload.title` — long enough for any real title, short
 * enough that a pathological one can't bloat a synced table. */
export const DELETED_TITLE_MAX_LENGTH = 200;

export interface DeletedPayload {
  v: 1;
  /**
   * A one-time title snapshot, unlike `EditedPayload`'s deliberate omission
   * of title/description — that omission is about `edited`, which fires on
   * every keystroke-committed change and would double note-edit storage.
   * `deleted` fires at most once per todo, ever, and the title is exactly
   * what a global activity feed needs to render a since-removed todo's row
   * without a live lookup. Truncated to `DELETED_TITLE_MAX_LENGTH`;
   * description is still never captured.
   */
  title: string;
}

export type TodoEventPayload =
  | EmptyPayload
  | ScheduledPayload
  | MovedPayload
  | EditedPayload
  | DeletedPayload;

/**
 * Fields that trigger an `edited` event when patched through `updateTodo`.
 *
 * Deliberately NOT "every Todo field" — omissions, and why:
 * - `position` — presentation, not history.
 * - `updatedAt` — set on every write, would fire on everything.
 * - `ownerId` — device adoption (`adopt-owner.ts:42`), not a user edit.
 * - `scheduledAt` — a shadow of `scheduledDate`, already covered by it.
 * - `status`/`completedAt` — dedicated `setTodoStatus` kind, not `updateTodo`.
 * - `labelIds` — dedicated `toggleTodoLabel` path, not in this event set.
 * - `recurrenceRule`/`recurrenceParentId` — logged explicitly by
 *   `createSeriesFromTodo`/`setSeriesUntil` with `fields: ["recurrenceRule"]`.
 *
 * `scheduledDate` and `listId` ARE included even though `scheduleTodo`/
 * `moveTodoToList` also exist as dedicated repository functions with their
 * own kinds (`scheduled`/`moved`) — the todo sheet's Date field and List
 * select both patch these fields straight through `updateTodo`, bypassing
 * those functions. Rather than teach `updateTodo` to reclassify a date/list
 * change into a different event kind (duplicating `scheduleTodo`/
 * `moveTodoToList`'s logic and risking drift between the two paths), a
 * sheet-driven date/list change simply logs as `edited` with the field name
 * — visible in history, just not relabeled as `scheduled`/`moved`.
 */
export const JOURNALLED_FIELDS = new Set([
  "title",
  "description",
  "priority",
  "deadline",
  "reminderTime",
  "scheduledDate",
  "listId",
  "projectId",
  "location",
  "placeId",
]);

/** Fields whose new value is worth capturing in an `edited` payload's `to`. */
const VALUE_CAPTURED_FIELDS = new Set(["priority", "deadline"]);

/**
 * Builds an `edited` payload from a patch, capturing values only for
 * `VALUE_CAPTURED_FIELDS`. Returns `null` if the patch touches no journalled
 * field — the caller's signal to skip logging entirely.
 */
export function buildEditedPayload(patch: Record<string, unknown>): EditedPayload | null {
  const fields = Object.keys(patch).filter((field) => JOURNALLED_FIELDS.has(field));
  if (fields.length === 0) return null;

  const to: EditedPayload["to"] = {};
  for (const field of fields) {
    if (!VALUE_CAPTURED_FIELDS.has(field)) continue;
    (to as Record<string, unknown>)[field] = patch[field];
  }

  return {
    v: 1,
    fields,
    ...(Object.keys(to).length > 0 ? { to } : {}),
  };
}

/**
 * Builds one history-log row, ready to pass into `mutate()`'s or `create()`'s
 * `opts.events`. Called from `repositories.ts`'s call sites — never from
 * `mutate()` itself, and never for a remote-applied change (`apply-remote.ts`
 * doesn't call `repositories.ts`, so this path is correct by construction)
 * or an undo replay (`undo.ts` calls `mutate()` directly, bypassing every
 * function that calls this).
 *
 * `at` defaults to `now()` — the fact happened now — but callers that log a
 * synthetic or backdated entry can pass their own.
 */
export function logTodoEvent(
  todoId: string,
  kind: TodoEventKind,
  payload: TodoEventPayload | null = null,
  at: string = now(),
): TodoEvent {
  const timestamp = now();
  return {
    id: newId(),
    ownerId: getCurrentOwnerId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    todoId,
    kind,
    at,
    payload: payload ? JSON.stringify(payload) : null,
  };
}

/**
 * The inverse of `logTodoEvent`'s payload serialization. A malformed payload
 * parses to `null` rather than throwing — an unreadable payload must still
 * render its row (as a neutral "Updated" line with no detail), not crash the
 * whole timeline.
 */
export function parseEventPayload(payload: string | null): unknown {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
