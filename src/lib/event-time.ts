/**
 * Instant formatting shared by every timeline UI — the day sheet
 * (`day-timeline.ts`) and the per-todo history log (`todo-timeline.ts`).
 *
 * Lives here rather than in `scheduling.ts` on purpose: every formatter
 * there is pinned to `timeZone: "UTC"` because it formats civil dates, and
 * adding a zone-aware instant formatter alongside them would undermine the
 * invariant that file's header sets out.
 */

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
