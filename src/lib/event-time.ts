/**
 * Instant formatting shared by every timeline UI — the day sheet
 * (`day-timeline.ts`) and the per-todo history log (`todo-timeline.ts`).
 *
 * Lives here rather than in `scheduling.ts` on purpose: every formatter
 * there is pinned to `timeZone: "UTC"` because it formats civil dates, and
 * adding a zone-aware instant formatter alongside them would undermine the
 * invariant that file's header sets out.
 */

import { civilDateOf, formatDay, formatShortDate } from "./scheduling";

/** Memoized time-of-day formatters, one per timezone. Mirrors `civilDateOf`. */
const TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** "9:41 AM" for an instant, in the user's timezone. */
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

/** Memoized short-date formatters ("Aug 10"), one per timezone. */
const DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * "Aug 10 · 9:41 AM" for an instant, in the user's timezone — the date is
 * ALWAYS shown, unlike `formatEventWhen` (`day-timeline.ts`), which only
 * prefixes the date when it differs from the day being viewed. A todo's
 * history spans months, so there is no single "the day being viewed" to
 * omit it relative to.
 */
export function formatEventStamp(instant: string, timezone: string): string {
  const dt = new Date(instant);
  if (Number.isNaN(dt.getTime())) return "";

  let dateFormatter = DATE_FORMATTERS.get(timezone);
  if (!dateFormatter) {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    try {
      dateFormatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone });
    } catch {
      dateFormatter = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    DATE_FORMATTERS.set(timezone, dateFormatter);
  }

  return `${dateFormatter.format(dt)} · ${formatEventTime(instant, timezone)}`;
}

/**
 * "Completed Aug 14 · 9:41 AM" for a settled todo, or null when there is
 * nothing to say.
 *
 * `done` and `dropped` are worded differently on purpose. `statusPatch`
 * stamps `completedAt` for both — the field really means "settled at" — but
 * "Completed" over an abandoned to-do claims credit for work that was
 * explicitly given up on, which is the distinction `todoStatusSchema` keeps
 * `dropped` separate for in the first place. The UI never says "dropped"
 * (EI-377), so it reads "Marked won’t do Aug 14 · 9:41 AM".
 *
 * `plannedFor` keeps the plan visible once the card has left it (EI-380):
 * settled work sits on the day it was FINISHED (`placeSettled`, lib/board.ts),
 * so a rolled card ticked today is on today's column while its
 * `scheduledDate` still says Oct 12. The caller passes that date only when
 * the card sits somewhere else, and it reads
 * "Completed Oct 14 · 9:41 AM · planned Oct 12". The year is added only when
 * it differs from the completion's, the same rule `dayLabel` uses.
 *
 * Takes primitives rather than a `Todo` so this module stays schema-free, the
 * way every other formatter here already is.
 */
export function formatCompletionStamp(
  status: "open" | "done" | "dropped",
  completedAt: string | null,
  timezone: string,
  plannedFor: string | null = null,
): string | null {
  if (status === "open" || !completedAt) return null;

  // `formatEventStamp` returns "" for an unparseable instant. Passing that
  // through would render an empty tooltip popup on hover — a control that
  // reacts by showing nothing reads as a bug, so say nothing instead.
  const stamp = formatEventStamp(completedAt, timezone);
  if (!stamp) return null;

  const settled = `${status === "done" ? "Completed" : "Marked won’t do"} ${stamp}`;
  if (!plannedFor) return settled;

  const finishedOn = civilDateOf(completedAt, timezone);
  const planned =
    finishedOn && finishedOn.slice(0, 4) !== plannedFor.slice(0, 4)
      ? formatDay(plannedFor).label
      : formatShortDate(plannedFor);
  return `${settled} · planned ${planned}`;
}
