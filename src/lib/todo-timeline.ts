import type { CivilDate, Todo, TodoEvent } from "./schema";
import type { TodoEventKind } from "./store/todo-events";
import { parseEventPayload } from "./store/todo-events";
import { rollEventsFor } from "./rollover-events";
import {
  civilDateOf,
  dayLabel,
  formatShortDate,
  type PlacementContext,
} from "./scheduling";
import { zonedInstant } from "./zoned";

/**
 * Builds the per-todo History timeline (EI-94) from the real event log plus
 * one synthesized entry for todos that predate it — the render-time half of
 * the feature; `logTodoEvent` (`store/todo-events.ts`) is the write-time half.
 *
 * Also merges in the Faite Loop's `rolledOver`/`overflowed` rows (EI-96,
 * `lib/rollover-events.ts`), which are pure derivation like everything else
 * about rollover — there is no write path for them at all.
 */

export interface TodoTimelineEvent {
  key: string;
  /** Unrecognized kinds (a newer build's event, on an older cached bundle)
   * are passed through as-is — the render layer falls back to a neutral
   * "Updated" label rather than this module failing closed. */
  kind: TodoEventKind | string;
  at: string;
  payload: unknown;
  /** Field names touched, for an `edited` entry — populated here (from the
   * payload, or unioned across a coalesced run) so the render layer never
   * has to know about coalescing. */
  fields?: string[];
  /** True for the one derived `created` row with no real event behind it. */
  synthetic?: boolean;
}

export type TodoTimelineItem =
  | { type: "event"; event: TodoTimelineEvent }
  /** Groups the rows below it, exactly as the global activity feed does
   * (EI-318). A to-do's history spans months, and an undivided run of rows
   * each stamped with its own date is a list you have to read rather than
   * scan. */
  | { type: "day-header"; key: string; day: CivilDate; label: string }
  /** "History recorded from here" — shown once, at the OLDEST end, so the gap
   * beyond the first real event reads as "nothing was recorded" rather than
   * "nothing happened". Newest-first ordering puts that end at the bottom. */
  | { type: "marker"; key: "history-start" };

/**
 * Deploy date of the history log (EI-94) — a property of the BUILD, not a
 * synced setting: a device that installs later has no reason to see a
 * different cutoff than one that installed on launch day.
 *
 * Gates ONLY the "History recorded from here" marker, never whether a
 * `created` row is synthesized at all — that's `!hasRealCreated` below,
 * independently. The two are not the same condition: `createSeriesFromTodo`
 * deliberately logs no `created` event for a brand-new template (Phase 1),
 * so a post-launch template also takes the synthetic-`created` path, but
 * MUST NOT show the marker — there is no history gap to announce, it's a
 * todo type that just never gets that one specific event.
 *
 * REAL TRAP: `e2e/core-flows.spec.ts` freezes `Date.now()` at a fixed
 * instant (`FROZEN_TIME`, `e2e/support/fixtures.ts`). Every todo it creates
 * DOES get a real `created` event (`createTodo` always logs one), so the
 * marker never fires for them regardless of this constant — but keep this
 * BEFORE `FROZEN_TIME` anyway, since the synthetic path is exercised by
 * other fixtures/backfilled data at that same frozen instant.
 */
export const HISTORY_STARTS_AT = "2026-08-01T00:00:00.000Z";

/** Adjacent `edited` events within this window coalesce into one row. */
const COALESCE_WINDOW_MS = 2 * 60 * 1000;

/** Payload for the two Faite Loop (EI-96) rows below — derived, never
 * written, so this has no counterpart in `lib/store/todo-events.ts`. */
export interface RollSummaryPayload {
  v: 1;
  from: CivilDate;
  /** Eligible days elapsed as of this row's `at` — for `rolledOver` this is
   * the LAST roll in the collapsed run, matching the card badge's count. */
  rolls: number;
}

function editedFields(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const fields = (payload as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as string[]) : [];
}

function toTimelineEvent(row: TodoEvent): TodoTimelineEvent {
  const payload = parseEventPayload(row.payload);
  return {
    key: row.id,
    kind: row.kind,
    at: row.at,
    payload,
    ...(row.kind === "edited" ? { fields: editedFields(payload) } : {}),
  };
}

/**
 * Merges adjacent `edited` rows within `COALESCE_WINDOW_MS`, unioning
 * `fields` and keeping the EARLIEST `at`. Render-time only, on purpose — a
 * write-time version would need a Dexie read on the write path and would be
 * irreversible; this stays pure, unit-testable, and tunable forever.
 */
function coalesceEdited(events: readonly TodoTimelineEvent[]): TodoTimelineEvent[] {
  const result: TodoTimelineEvent[] = [];

  for (const event of events) {
    const prev = result.at(-1);
    const withinWindow =
      prev &&
      Math.abs(new Date(event.at).getTime() - new Date(prev.at).getTime()) <= COALESCE_WINDOW_MS;

    if (event.kind === "edited" && prev?.kind === "edited" && withinWindow) {
      result[result.length - 1] = {
        ...prev,
        fields: [...new Set([...(prev.fields ?? []), ...(event.fields ?? [])])],
      };
      continue;
    }
    result.push(event);
  }

  return result;
}

/**
 * The Faite Loop, summarized for History: every `rolledOver` day this todo
 * has passed through collapses into ONE row (a 30-day-old Overflow item
 * would otherwise drown the real log in identical rows), timestamped at the
 * first roll; `overflowed` — the day it crossed the threshold — stays its
 * own row, since that's the one fact worth calling out on its own.
 *
 * Unlike `coalesceEdited`, this doesn't need to scan for ADJACENT rows: a
 * todo has exactly one roll sequence, and `rollEventsFor` already returns it
 * in order, so the whole run is collapsed in one pass rather than merged
 * post-hoc against interleaved real events.
 */
function rollTimelineEvents(
  todo: Pick<Todo, "status" | "scheduledDate" | "recurrenceParentId">,
  ctx: PlacementContext,
  timezone: string,
): TodoTimelineEvent[] {
  const rolls = rollEventsFor(todo, ctx);
  if (rolls.length === 0) return [];

  const rolledOver = rolls.filter((r) => r.kind === "rolledOver");
  const overflowed = rolls.find((r) => r.kind === "overflowed");
  const events: TodoTimelineEvent[] = [];

  if (rolledOver.length > 0) {
    const first = rolledOver[0];
    const last = rolledOver[rolledOver.length - 1];
    events.push({
      key: `rollover:rolledOver:${first.day}`,
      kind: "rolledOver",
      at: zonedInstant(first.day, "00:00", timezone),
      payload: { v: 1, from: last.from, rolls: last.rolls } satisfies RollSummaryPayload,
    });
  }
  if (overflowed) {
    events.push({
      key: `rollover:overflowed:${overflowed.day}`,
      kind: "overflowed",
      at: zonedInstant(overflowed.day, "00:00", timezone),
      payload: { v: 1, from: overflowed.from, rolls: overflowed.rolls } satisfies RollSummaryPayload,
    });
  }
  return events;
}

export function buildTodoTimeline(
  events: readonly TodoEvent[],
  todo: Pick<Todo, "id" | "createdAt" | "status" | "scheduledDate" | "recurrenceParentId">,
  /** Omitted by callers/tests with no rollover to show — History then
   * renders the real log alone, same as before EI-96. */
  ctx?: PlacementContext,
  timezone = "UTC",
  /** Anchors the day headers' relative wording ("Yesterday", "3 days ago").
   * Falls back to `ctx.today`, and finally to the newest event's own day —
   * which makes the top header read "Today" for a caller that has neither,
   * rather than inventing a clock in a pure module. */
  today?: CivilDate,
): TodoTimelineItem[] {
  // Sort by `at`, tiebreak by `id` — UUIDv7 sorts by creation, mirroring
  // `day-timeline.ts`'s total-order rule.
  const sorted = [...events].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );

  const hasRealCreated = sorted.some((e) => e.kind === "created");
  const coalesced = coalesceEdited(sorted.map(toTimelineEvent));
  const rollEvents = ctx ? rollTimelineEvents(todo, ctx, timezone) : [];
  // Re-sort after merging: a roll's synthetic midnight instant can interleave
  // anywhere among the todo's real events.
  const all: TodoTimelineEvent[] = [...coalesced, ...rollEvents];

  if (!hasRealCreated) {
    all.push({
      key: `${todo.id}:synthetic-created`,
      kind: "created",
      at: todo.createdAt,
      payload: null,
      synthetic: true,
    });
  }

  // NEWEST FIRST, matching the global activity feed (EI-318). What a to-do
  // did most recently is what someone opening the sheet is looking for; the
  // oldest-first order made you scroll past months of settled history to
  // reach it.
  all.sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));

  const anchor = today ?? ctx?.today ?? civilDateOf(all[0]?.at ?? "", timezone);
  const items: TodoTimelineItem[] = [];
  let lastDay: CivilDate | null = null;

  for (const event of all) {
    const day = civilDateOf(event.at, timezone);
    if (day && day !== lastDay) {
      items.push({
        type: "day-header",
        key: `day:${day}`,
        day,
        label: anchor ? dayLabel(day, anchor) : formatShortDate(day),
      });
      lastDay = day;
    }
    items.push({ type: "event", event });
  }

  // Only a todo that genuinely predates the log gets the marker — a
  // post-launch recurrence template (no `created` event by design, see the
  // doc comment on HISTORY_STARTS_AT) gets the synthetic row alone. At the
  // BOTTOM now: newest-first puts the oldest end there, and the marker means
  // "nothing recorded beyond this point".
  if (!hasRealCreated && todo.createdAt < HISTORY_STARTS_AT) {
    items.push({ type: "marker", key: "history-start" });
  }

  return items;
}
