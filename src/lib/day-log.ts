import type { CivilDate, Todo, TodoEvent } from "./schema";
import { civilDateOf } from "./scheduling";
import { parseEventPayload } from "./store/todo-events";

/**
 * What got done, and what got decided, on one past day — the History sheet's
 * model (EI-322).
 *
 * Built from the real event log (`todoEvents`, EI-94) and NOTHING else.
 * `day-timeline.ts` answers a similar question for the day sheet, but it
 * derives the answer from the current state of each to-do, so the past moves:
 * reopening a to-do erases the day it was done, and a reschedule rewrites
 * where it appears to have been (that module's header, limits 1–8). A record
 * of the past that changes later is not a record, so this module reads only
 * rows that were written when the thing happened and never change after.
 *
 * Only what the log holds is shown. It starts on 2026-08-01
 * (`HISTORY_STARTS_AT`), and nothing earlier is backfilled.
 */

/** One row in the History sheet. Several events can collapse into one row. */
export interface DayLogEntry {
  /** Stable React key. */
  key: string;
  todoId: string;
  kind: "done" | "dropped" | "scheduled" | "unscheduled" | "moved" | "deleted" | "created";
  /** The instant of the LAST event this row stands for. */
  at: string;
  title: string;
  /** The to-do is gone (tombstoned, or no row at all). Its row is not a link. */
  deleted: boolean;
  /** The to-do's current list, for the row's accent. */
  listId: string | null;
  /** `scheduled`/`unscheduled`: the first `from` and the last `to` of the day. */
  from?: CivilDate | null;
  to?: CivilDate | null;
  /** `moved`: where it ended up. */
  toListId?: string | null;
  toListName?: string | null;
  /** The decision was made in Overdrive (EI-321's `via`). */
  viaOverdrive: boolean;
}

export interface DayLog {
  /** Finished. */
  done: DayLogEntry[];
  /** Won't do, rescheduled, sent back to a list, deleted. */
  decisions: DayLogEntry[];
  /** Created. */
  added: DayLogEntry[];
}

/** The fields of a to-do this needs — a `bulkGet` result, tombstones included. */
export type DayLogTodo = Pick<Todo, "title" | "deletedAt" | "listId">;

const STATUS_KINDS = new Set(["done", "dropped", "reopened"]);
const SCHEDULE_KINDS = new Set(["scheduled", "unscheduled"]);

/** Fallback when a to-do has no row and no title snapshot anywhere. */
const UNKNOWN_TITLE = "Deleted to-do";

type Payload = {
  via?: string;
  from?: CivilDate | null;
  to?: CivilDate | null;
  fromListId?: string | null;
  toListId?: string | null;
  toListName?: string | null;
  title?: string;
} | null;

const payloadOf = (event: TodoEvent) => parseEventPayload(event.payload) as Payload;
const byAt = (a: { at: string }, b: { at: string }) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/**
 * Undone events are tombstoned (`deletedAt`), and an undo means it did not
 * happen. `edited`/`attached`/`detached` are real history but not a
 * look-back's business: a list of every retitle would bury what got done.
 */
function eventsOn(events: readonly TodoEvent[], day: CivilDate, timezone: string): TodoEvent[] {
  return events
    .filter((e) => !e.deletedAt && civilDateOf(e.at, timezone) === day)
    .sort(byAt);
}

export function buildDayLog(
  events: readonly TodoEvent[],
  todosById: ReadonlyMap<string, DayLogTodo>,
  day: CivilDate,
  timezone: string,
): DayLog {
  const log: DayLog = { done: [], decisions: [], added: [] };

  const byTodo = new Map<string, TodoEvent[]>();
  for (const event of eventsOn(events, day, timezone)) {
    const list = byTodo.get(event.todoId);
    if (list) list.push(event);
    else byTodo.set(event.todoId, [event]);
  }

  for (const [todoId, todoEvents] of byTodo) {
    const todo = todosById.get(todoId);
    const snapshot = todoEvents
      .map((e) => (e.kind === "deleted" ? payloadOf(e)?.title : undefined))
      .find(Boolean);
    const base = {
      todoId,
      title: todo?.title ?? snapshot ?? UNKNOWN_TITLE,
      deleted: !todo || !!todo.deletedAt,
      listId: todo?.listId ?? null,
    };
    const entry = (
      kind: DayLogEntry["kind"],
      at: string,
      via: boolean,
      extra: Partial<DayLogEntry> = {},
    ): DayLogEntry => ({ key: `${todoId}:${kind}`, kind, at, viaOverdrive: via, ...base, ...extra });

    // Status: the LAST change of the day is what the day ended with. Done
    // then reopened the same afternoon is not something that got done.
    const lastStatus = todoEvents.filter((e) => STATUS_KINDS.has(e.kind)).at(-1);
    if (lastStatus?.kind === "done" || lastStatus?.kind === "dropped") {
      const row = entry(lastStatus.kind, lastStatus.at, payloadOf(lastStatus)?.via === "overdrive");
      (lastStatus.kind === "done" ? log.done : log.decisions).push(row);
    }

    // A list move comes first, because it decides whether an `unscheduled`
    // below is worth its own row.
    const moves = todoEvents.filter((e) => e.kind === "moved");
    const firstMove = moves[0];
    const lastMove = moves.at(-1);
    const moved =
      !!firstMove &&
      !!lastMove &&
      (payloadOf(firstMove)?.fromListId ?? null) !== (payloadOf(lastMove)?.toListId ?? null);
    if (moved) {
      const last = payloadOf(lastMove);
      log.decisions.push(
        entry("moved", lastMove.at, moves.some((e) => payloadOf(e)?.via === "overdrive"), {
          toListId: last?.toListId ?? null,
          toListName: last?.toListName ?? null,
        }),
      );
    }

    // Several reschedules in one day are one decision: where it started the
    // day, and where it ended up. Moving it and moving it back is none.
    const schedules = todoEvents.filter((e) => SCHEDULE_KINDS.has(e.kind));
    if (schedules.length > 0) {
      const from = payloadOf(schedules[0])?.from ?? null;
      const last = schedules.at(-1)!;
      const to = payloadOf(last)?.to ?? null;
      // Sending a to-do back to a list clears its day, and "Sent back to
      // Groceries" already says so. A second "Unscheduled" row would repeat it.
      const explainedByMove = moved && to === null;
      if (from !== to && !explainedByMove) {
        log.decisions.push(
          entry(to ? "scheduled" : "unscheduled", last.at, schedules.some((e) => payloadOf(e)?.via === "overdrive"), {
            from,
            to,
          }),
        );
      }
    }

    const deletion = todoEvents.find((e) => e.kind === "deleted");
    if (deletion) log.decisions.push(entry("deleted", deletion.at, false));

    const creation = todoEvents.find((e) => e.kind === "created");
    if (creation) log.added.push(entry("created", creation.at, false));
  }

  log.done.sort(byAt);
  log.decisions.sort(byAt);
  log.added.sort(byAt);
  return log;
}

/**
 * The days in `events` on which something was finished or let go — the
 * calendar's dots. Presence only: a count would be a score, and
 * `docs/DESIGN.md` §4 rules those out.
 *
 * Uses the same "last status change of the day wins" rule as `buildDayLog`,
 * so a day never shows a dot over an empty Done list.
 */
export function activeDays(events: readonly TodoEvent[], timezone: string): Set<CivilDate> {
  const lastStatus = new Map<string, { day: CivilDate; kind: string }>();
  for (const event of [...events].sort(byAt)) {
    if (event.deletedAt || !STATUS_KINDS.has(event.kind)) continue;
    const day = civilDateOf(event.at, timezone);
    if (day) lastStatus.set(`${day}|${event.todoId}`, { day, kind: event.kind });
  }
  const days = new Set<CivilDate>();
  for (const { day, kind } of lastStatus.values()) {
    if (kind === "done" || kind === "dropped") days.add(day);
  }
  return days;
}

/** What a day's calendar cell shows as its tint — see `dayTints`. */
export interface DayTint {
  /** A tintable `#rrggbb` color — the caller's resolver already checked. */
  color: string;
  /** The list that contributed most to `color`, for the day's label. */
  listName: string;
}

/**
 * Where a list id points, for tinting: its effective color (own, else its
 * tab's) and its name. `null` for no list, a list with no color, or a color
 * the UI cannot tint. Passed in so this module never learns about
 * `colors.ts` or the list maps.
 */
export type ListTintResolver = (listId: string | null) => { color: string; name: string } | null;

/**
 * Each day's tint in `events`: the effective list color with the most
 * completions that day (EI-323).
 *
 * - **Completed only.** A day of letting things go is not tinted.
 * - **Same "last change of the day" rule** as `buildDayLog` and `activeDays`,
 *   so a to-do finished and reopened that afternoon does not count.
 * - **Grouped by color, not by list**, so two lists that share a color pool
 *   their completions; the winning color's label names the list inside it
 *   with the most.
 * - **Ties go to the most recent completion.** Deterministic, and it favors
 *   what the day ended on.
 * - **The list at the time.** A `done` row's payload records where the to-do
 *   was when it was finished (`StatusPayload`); older rows fall back to the
 *   to-do's current list from `todosById`.
 *
 * Deliberately NOT returned: how many. The caller paints every tint at one
 * strength, so the calendar says which list a day was about, never how
 * much of it there was (`docs/DESIGN.md` §4).
 */
export function dayTints(
  events: readonly TodoEvent[],
  todosById: ReadonlyMap<string, Pick<Todo, "listId">>,
  resolve: ListTintResolver,
  timezone: string,
): Map<CivilDate, DayTint> {
  // The last status change per (day, to-do), same as `activeDays`.
  const last = new Map<string, { day: CivilDate; event: TodoEvent }>();
  for (const event of [...events].sort(byAt)) {
    if (event.deletedAt || !STATUS_KINDS.has(event.kind)) continue;
    const day = civilDateOf(event.at, timezone);
    if (day) last.set(`${day}|${event.todoId}`, { day, event });
  }

  type Tally = { count: number; lastAt: string; names: Map<string, number> };
  const byDay = new Map<CivilDate, Map<string, Tally>>();
  for (const { day, event } of last.values()) {
    if (event.kind !== "done") continue;
    const payload = payloadOf(event) as { listId?: string | null } | null;
    const listId =
      payload && "listId" in payload
        ? (payload.listId ?? null)
        : (todosById.get(event.todoId)?.listId ?? null);
    const resolved = resolve(listId);
    if (!resolved) continue;

    const colors = byDay.get(day) ?? new Map<string, Tally>();
    byDay.set(day, colors);
    const tally = colors.get(resolved.color) ?? { count: 0, lastAt: "", names: new Map() };
    colors.set(resolved.color, tally);
    tally.count += 1;
    if (event.at > tally.lastAt) tally.lastAt = event.at;
    tally.names.set(resolved.name, (tally.names.get(resolved.name) ?? 0) + 1);
  }

  const tints = new Map<CivilDate, DayTint>();
  for (const [day, colors] of byDay) {
    let winner: [string, Tally] | null = null;
    for (const entry of colors) {
      const [, tally] = entry;
      if (
        !winner ||
        tally.count > winner[1].count ||
        (tally.count === winner[1].count && tally.lastAt > winner[1].lastAt)
      ) {
        winner = entry;
      }
    }
    if (!winner) continue;
    const [color, tally] = winner;
    const listName = [...tally.names].sort((a, b) => b[1] - a[1])[0][0];
    tints.set(day, { color, listName });
  }
  return tints;
}
