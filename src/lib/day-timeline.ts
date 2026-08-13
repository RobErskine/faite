import type { CivilDate, DayEventKind, Todo } from "./schema";
import { formatEventTime } from "./event-time";
import { civilDateOf, formatShortDate } from "./scheduling";

export { formatEventTime };

/**
 * What happened to a to-do on one calendar day.
 *
 * DERIVED from the timestamps a todo already carries, not read from an event
 * log — there is no events table, and adding one would be a different shape
 * from anything else that syncs here (every table is one mutable row per id,
 * merged field-by-field; an append-only log is neither). That trade is the same
 * one the board already makes with Overflow: history is computed from current
 * state, and current state is the only truth.
 *
 * The limits that follow are real, and worth knowing before trusting this as a
 * journal:
 *
 * 1. **Reopening erases history.** `statusPatch` (`store/repositories.ts`)
 *    writes `completedAt: null` when a todo goes back to `open`, so completing
 *    something on Monday and reopening it on Wednesday retroactively removes
 *    Monday's entry. Nothing can recover it.
 * 2. **Only the latest settle survives.** Done Monday, reopened, dropped Friday
 *    leaves one `completedAt`. Monday is gone.
 * 3. **`done` vs `dropped` is read from the CURRENT status.** `completedAt` is
 *    one column shared by both, so a todo dropped Monday and re-done Friday
 *    reads as done, on Friday only.
 * 4. **Deleted todos vanish from past days.** Callers pass `useTodos()`, which
 *    filters tombstones. Deliberate: a timeline showing items the board says
 *    do not exist is worse than one that agrees with the board.
 * 5. **Only the LATEST placement is knowable.** `scheduled` (below) reads
 *    `scheduledAt`, one column like `completedAt` — reschedule a todo twice and
 *    only the second move is recoverable. And it disappears retroactively the
 *    moment the todo is unscheduled or moved elsewhere, same as `done`/`dropped`
 *    disappearing on reopen.
 * 6. **No moved-list / edited-field events.** `updatedAt` is a single
 *    last-write stamp, not a log; only scheduling changes get their own field.
 * 7. **`createdAt` is a device wall clock.** A skewed or long-offline device
 *    can stamp an instant landing on the wrong civil day for the viewer.
 */

export type { DayEventKind };

export interface DayEvent {
  /** Stable React key. A todo can legitimately appear twice on one day. */
  key: string;
  kind: DayEventKind;
  /**
   * The ISO instant it happened — `createdAt`, `completedAt`, or `scheduledAt`.
   *
   * For every kind except `scheduled` this instant falls ON `day`, by
   * construction. `scheduled` is the exception: it belongs to `day` because
   * that is where the todo IS, not because the move happened then — dragging
   * something from today onto tomorrow is an event that belongs on tomorrow's
   * timeline, timestamped with today's instant. Render it accordingly; see
   * `formatEventWhen`.
   */
  at: string;
  todo: Todo;
}

/**
 * Everything that happened to, or is true of, a to-do on `day`, oldest first.
 *
 * A todo created and finished on the same day yields TWO entries. That is the
 * point — they are two events, and a journal that collapsed them would hide the
 * fact that the work was both started and finished that day.
 */
export function buildDayTimeline(
  todos: readonly Todo[],
  day: CivilDate,
  timezone: string,
): DayEvent[] {
  const events: DayEvent[] = [];

  for (const todo of todos) {
    if (civilDateOf(todo.createdAt, timezone) === day) {
      events.push({ key: `${todo.id}:created`, kind: "created", at: todo.createdAt, todo });
    }

    /*
      "Assigned here" is keyed by WHERE the todo currently sits, not by when
      `scheduledAt` falls — that is the whole point of this event. Moving a
      todo from today onto tomorrow, while looking at today, produces nothing;
      looking at tomorrow, it shows up there, stamped with today's instant.
      `scheduledAt` is null whenever `scheduledDate` is (see `listPatch`), so
      the null check is here for type-narrowing more than for filtering.
    */
    if (todo.scheduledDate === day && todo.scheduledAt) {
      events.push({
        key: `${todo.id}:scheduled`,
        kind: "scheduled",
        at: todo.scheduledAt,
        todo,
      });
    }

    // `completedAt` means "settled at" — it is stamped for `dropped` as well as
    // `done` — so the current status is what says which kind of settling it was.
    const settledKind: DayEventKind | null =
      todo.status === "done" ? "done" : todo.status === "dropped" ? "dropped" : null;

    if (
      settledKind &&
      todo.completedAt &&
      civilDateOf(todo.completedAt, timezone) === day
    ) {
      events.push({
        key: `${todo.id}:${settledKind}`,
        kind: settledKind,
        at: todo.completedAt,
        todo,
      });
    }
  }

  // Tie-broken by key so the order is TOTAL: two todos created in the same
  // millisecond must not swap places between renders.
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

/**
 * How a `DayEvent`'s instant should read on `day`'s timeline.
 *
 * Every kind except `scheduled` happens ON the day it is shown on, so a bare
 * time ("9:41 AM") is unambiguous. `scheduled` is the exception — its instant
 * can fall on a different calendar day than the one being viewed — so this
 * prefixes the date whenever the two differ, matching the request that
 * started this: viewing tomorrow should read "today, this was assigned here",
 * not a bare time that silently implies it happened tomorrow.
 */
export function formatEventWhen(
  instant: string,
  day: CivilDate,
  timezone: string,
): string {
  const time = formatEventTime(instant, timezone);
  const eventDay = civilDateOf(instant, timezone);
  return eventDay && eventDay !== day ? `${formatShortDate(eventDay)} · ${time}` : time;
}
