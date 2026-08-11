import type { Todo } from "./schema";
import { zonedInstant } from "./zoned";

/**
 * Foreground reminders: fires while a tab is open, via a wall-clock poll
 * (see `components/board/use-reminders.ts`) rather than a background push —
 * background delivery needs a service worker, VAPID keys, and a Durable
 * Object alarm scheduler, none of which exist yet. Reliable delivery with the
 * app closed waits for Capacitor's local-notifications plugin, which can
 * reuse this same civil-date + time model unchanged.
 */

/**
 * Unique per (todo, date, time) — moving a reminder later the same day
 * re-arms it, and a completed/rescheduled/deleted todo naturally stops
 * matching (see `dueReminders`) without needing its key pruned specially.
 */
export function reminderFireKey(
  todo: Pick<Todo, "id" | "scheduledDate" | "reminderTime">,
): string {
  return `${todo.id}:${todo.scheduledDate}:${todo.reminderTime}`;
}

/**
 * Which todos are due for a reminder right now and haven't fired yet.
 *
 * Pure — no timers, no `Notification`, no `localStorage`. `fired` is the set
 * of already-delivered fire-keys; the caller owns persisting it.
 *
 * v1 fires ONLY when `scheduledDate === today` — not `deriveColumn`'s
 * rendered placement, which would also cover a rolled-over todo still
 * carrying an OLDER `scheduledDate`. That means the most overdue work (the
 * very thing "todo -> render in today's column" moved to today) gets no
 * reminder at all. Documented limitation, not an oversight: resolving
 * against the derived placement would mean recomputing it on every 30s
 * tick rather than once per todo, and it's cheaper to fix once N2/N3 exist
 * and reminders matter enough to invest in it.
 */
export function dueReminders(
  todos: readonly Todo[],
  today: string,
  nowIso: string,
  timezone: string,
  fired: ReadonlySet<string>,
): Todo[] {
  const now = new Date(nowIso).getTime();
  const due: Todo[] = [];
  for (const todo of todos) {
    if (todo.status !== "open") continue;
    if (!todo.reminderTime || todo.scheduledDate !== today) continue;
    if (fired.has(reminderFireKey(todo))) continue;
    const instant = zonedInstant(todo.scheduledDate, todo.reminderTime, timezone);
    if (new Date(instant).getTime() <= now) due.push(todo);
  }
  return due;
}
