import type { CivilDate, Todo } from "./schema";
import { civilDateOf } from "./scheduling";

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
 * 5. **No rescheduled / moved / edited events.** `updatedAt` is a single
 *    last-write stamp, not a log.
 * 6. **`createdAt` is a device wall clock.** A skewed or long-offline device
 *    can stamp an instant landing on the wrong civil day for the viewer.
 */

export type DayEventKind = "created" | "done" | "dropped";

export interface DayEvent {
  /** Stable React key. A todo can legitimately appear twice on one day. */
  key: string;
  kind: DayEventKind;
  /** The ISO instant it happened — `createdAt` or `completedAt`. */
  at: string;
  todo: Todo;
}

/**
 * Everything that happened to a to-do on `day`, oldest first.
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

/** Memoized time-of-day formatters, one per timezone. Mirrors `civilDateOf`. */
const TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * "9:41 AM" for an instant, in the user's timezone.
 *
 * Lives here rather than in `scheduling.ts` on purpose: every formatter there
 * is pinned to `timeZone: "UTC"` because it formats civil dates, and adding a
 * zone-aware instant formatter alongside them would undermine the invariant
 * that file's header sets out.
 */
export function formatEventTime(instant: string, timezone: string): string {
  let formatter = TIME_FORMATTERS.get(timezone);
  if (!formatter) {
    const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    try {
      formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    TIME_FORMATTERS.set(timezone, formatter);
  }

  const dt = new Date(instant);
  return Number.isNaN(dt.getTime()) ? "" : formatter.format(dt);
}
