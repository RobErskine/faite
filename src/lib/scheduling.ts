import type { CivilDate, Settings, Todo } from "./schema";

/**
 * Where does a todo render?
 *
 * Overflow is DERIVED, never stored. The alternative — mutating scheduledDate
 * forward each night — needs a cron, breaks offline, destroys the user's
 * original intent, corrupts recurrence, and cannot be undone. Deriving it makes
 * the answer a pure function of stored data plus the clock, so every device
 * agrees without coordinating.
 *
 * All arithmetic here is on civil dates ("YYYY-MM-DD"). We never convert to an
 * instant, so DST transitions and travel cannot shift a day boundary.
 */

export const OVERFLOW = "overflow" as const;
export const PLANNING = "planning" as const;

export type Placement =
  /** Calendar half, on a specific day. */
  | { half: "calendar"; day: CivilDate }
  /** Calendar half, in the Overflow column. */
  | { half: "calendar"; day: typeof OVERFLOW }
  /** Planning half, in its list column. `awayDate` set if scheduled off-window. */
  | { half: typeof PLANNING; awayDate: CivilDate | null };

// ---------------------------------------------------------------------------
// Civil date arithmetic
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD" into numeric parts. No Date object, no timezone. */
function parts(date: CivilDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function toCivilDate(y: number, m: number, d: number): CivilDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/**
 * Days since the epoch for a civil date.
 *
 * Uses Date.UTC purely as a calendar calculator — noon UTC keeps us clear of
 * any rounding at midnight. The result is a pure day count, never a local time.
 *
 * Must be `floor`, not `round`: noon yields `N + 0.5`, and rounding a .5 goes
 * up, which silently shifts every derived date forward by a day.
 */
function toEpochDay(date: CivilDate): number {
  const { y, m, d } = parts(date);
  return Math.floor(Date.UTC(y, m - 1, d, 12) / 86_400_000);
}

function fromEpochDay(epochDay: number): CivilDate {
  const dt = new Date(epochDay * 86_400_000);
  return toCivilDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Calendar days between two civil dates. Negative if `to` precedes `from`. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Day of week, 0 = Sunday. */
export function dayOfWeek(date: CivilDate): number {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * Memoized instant -> `YYYY-MM-DD` formatters, one per timezone.
 *
 * Cached for the same reason the display formatters below are module-level:
 * constructing an `Intl.DateTimeFormat` is the expensive half, and
 * `civilDateOf` runs once per timestamp when the day sheet builds its timeline.
 */
const CIVIL_DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function civilDateFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = CIVIL_DATE_FORMATTERS.get(timezone);
  if (cached) return cached;

  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: timezone });
  } catch {
    // Unknown timezone: fall back to UTC rather than throwing mid-render.
    formatter = new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
  }
  CIVIL_DATE_FORMATTERS.set(timezone, formatter);
  return formatter;
}

/**
 * Today as a civil date in the user's timezone.
 *
 * `en-CA` formats as YYYY-MM-DD, which is exactly our storage shape.
 */
export function todayIn(timezone: string, now: Date = new Date()): CivilDate {
  return civilDateFormatter(timezone).format(now);
}

/**
 * The civil date an INSTANT falls on, in `timezone`. Null if unparseable.
 *
 * The only place this module converts an instant to a civil date, and it exists
 * because `createdAt`/`completedAt` are ISO instants while everything else here
 * reasons in civil dates. Which day an instant belongs to is a question only
 * the user's timezone can answer — a 4am-UTC completion is the previous day in
 * Los Angeles.
 *
 * Returns null rather than throwing: one malformed timestamp on one todo must
 * not take down a whole render.
 */
export function civilDateOf(instant: string, timezone: string): CivilDate | null {
  const dt = new Date(instant);
  if (Number.isNaN(dt.getTime())) return null;
  return civilDateFormatter(timezone).format(dt);
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/*
 * Formatters are module-level: constructing an Intl.DateTimeFormat is the
 * expensive part, and these run once per column and per card badge on every
 * render.
 *
 * `timeZone: "UTC"` throughout, paired with parsing at noon UTC below. A civil
 * date has no time and no zone, so handing it to a local-time formatter would
 * reintroduce exactly the drift the rest of this module exists to avoid.
 */
const WEEKDAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  timeZone: "UTC",
});
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Noon UTC keeps the formatter clear of any midnight rounding. */
function toUtcNoon(date: CivilDate): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** Column header parts: "Monday" plus "Aug 4, 2026". */
export function formatDay(date: CivilDate): { weekday: string; label: string } {
  const dt = toUtcNoon(date);
  return { weekday: WEEKDAY.format(dt), label: MONTH_DAY_YEAR.format(dt) };
}

/** Compact form for inline badges: "Aug 4". Year is almost always noise here. */
export function formatShortDate(date: CivilDate): string {
  return MONTH_DAY.format(toUtcNoon(date));
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

export interface RolloverOptions {
  workdaysOnly: boolean;
  workdays: number[];
}

export function isEligible(date: CivilDate, opts: RolloverOptions): boolean {
  if (!opts.workdaysOnly) return true;
  return opts.workdays.includes(dayOfWeek(date));
}

/**
 * How many eligible days a todo has rolled.
 *
 * Counts ELIGIBLE days, not calendar days: with workdaysOnly on, a Friday miss
 * viewed on Monday has rolled once, not three times. That is what makes
 * "overflow after 3 rolls" mean three actual working days.
 *
 * The scheduled day itself is not counted — being due today is zero rolls.
 */
export function rollsElapsed(
  scheduledDate: CivilDate,
  today: CivilDate,
  opts: RolloverOptions,
): number {
  const total = daysBetween(scheduledDate, today);
  if (total <= 0) return total;

  let rolls = 0;
  for (let i = 1; i <= total; i++) {
    if (isEligible(addDays(scheduledDate, i), opts)) rolls++;
  }
  return rolls;
}

/**
 * The next eligible day at or after `date`.
 *
 * Used only for rollover targets. A todo the user explicitly scheduled on a
 * Saturday still shows on Saturday — this never moves an unmissed todo.
 */
export function nextEligibleDay(date: CivilDate, opts: RolloverOptions): CivilDate {
  if (!opts.workdaysOnly) return date;
  let candidate = date;
  // Bounded: a full week is always enough unless every day is excluded.
  for (let i = 0; i < 7; i++) {
    if (isEligible(candidate, opts)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return date;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface PlacementContext {
  today: CivilDate;
  /** Days rendered in the calendar half, in order. */
  visibleWindow: CivilDate[];
  workdaysOnly: boolean;
  workdays: number[];
  overflowAfterDays: number;
}

export function contextFromSettings(
  settings: Pick<
    Settings,
    "timezone" | "workdaysOnly" | "workdays" | "overflowAfterDays" | "visibleDays"
  >,
  now: Date = new Date(),
  /**
   * Overrides `settings.visibleDays` for the rendered window length. The
   * board grows this past the setting as the calendar half scrolls or a todo
   * is scheduled further out — see `deriveColumn` below for why the window
   * has to keep pace with both.
   */
  renderedDays?: number,
): PlacementContext {
  const today = todayIn(settings.timezone, now);
  return {
    today,
    visibleWindow: buildWindow(today, renderedDays ?? settings.visibleDays),
    workdaysOnly: settings.workdaysOnly,
    workdays: settings.workdays,
    overflowAfterDays: settings.overflowAfterDays,
  };
}

/** The visible day columns, starting today. */
export function buildWindow(today: CivilDate, visibleDays: number): CivilDate[] {
  return Array.from({ length: visibleDays }, (_, i) => addDays(today, i));
}

/**
 * Decide where a todo renders.
 *
 * ```
 * unscheduled                  -> planning half, its list column
 * rolls <= 0                   -> calendar half, its scheduled day
 * rolls <= overflowAfterDays   -> calendar half, today
 * otherwise                    -> calendar half, Overflow
 * ```
 *
 * Then one override: if the resulting day is not in `ctx.visibleWindow`, the
 * todo renders in the planning half instead, flagged with `awayDate`.
 *
 * This used to be normal behaviour, tied to the 1/3/5/7-day toggle: the
 * window was always exactly `settings.visibleDays` long, so scheduling
 * something for next week routinely bounced it here. It is now a safety
 * valve only. The board grows `visibleWindow` (via `contextFromSettings`'s
 * `renderedDays`) to always cover the furthest-scheduled todo, so a real day
 * column is always waiting for anything within the day cap — this override
 * fires only past that cap, where rendering a day column is not an option
 * and the todo has to surface somewhere.
 */
export function deriveColumn(
  todo: Pick<Todo, "scheduledDate">,
  ctx: PlacementContext,
): Placement {
  const { scheduledDate } = todo;

  if (!scheduledDate) return { half: PLANNING, awayDate: null };

  const opts = { workdaysOnly: ctx.workdaysOnly, workdays: ctx.workdays };
  const rolls = rollsElapsed(scheduledDate, ctx.today, opts);

  let placement: Placement;

  if (rolls <= 0) {
    placement = { half: "calendar", day: scheduledDate };
  } else if (rolls <= ctx.overflowAfterDays) {
    placement = { half: "calendar", day: ctx.today };
  } else {
    return { half: "calendar", day: OVERFLOW };
  }

  // Overflow is always visible, so only real days need the window check.
  // `visibleWindow` is always contiguous from `today`, and `placement.day` is
  // always `today` or later by construction above, so an offset comparison is
  // exact and O(1) — unlike `.includes`, which `buildBoard` (lib/board.ts)
  // would otherwise run once per todo against an array up to a year long.
  if (
    placement.day !== OVERFLOW &&
    daysBetween(ctx.today, placement.day) >= ctx.visibleWindow.length
  ) {
    return { half: PLANNING, awayDate: scheduledDate };
  }

  return placement;
}

/**
 * Has this todo blown its deadline?
 *
 * Deadlines are independent of placement: they never exempt a todo from
 * overflow and never change its column. This is presentation only.
 */
export function isDeadlineMissed(
  todo: Pick<Todo, "deadline" | "status">,
  ctx: Pick<PlacementContext, "today">,
): boolean {
  if (!todo.deadline || todo.status !== "open") return false;
  return daysBetween(todo.deadline, ctx.today) > 0;
}

/**
 * How a deadline reads on a card's inline marker: "Due in 5 days: Aug 14".
 *
 * Kept here rather than in the component because it is date arithmetic with a
 * string on the end, and the plural/today/tomorrow boundaries are exactly the
 * kind of thing that is worth a test.
 */
export function formatDeadlineDue(deadline: CivilDate, today: CivilDate): string {
  const days = daysBetween(today, deadline);
  const date = formatShortDate(deadline);
  if (days === 0) return `Due today: ${date}`;
  if (days === 1) return `Due tomorrow: ${date}`;
  if (days > 1) return `Due in ${days} days: ${date}`;
  const late = -days;
  return `Overdue by ${late} ${late === 1 ? "day" : "days"}: ${date}`;
}

/**
 * The day a missed todo should land on when rescheduled forward.
 *
 * Honours the workday setting, so a Friday miss goes to Monday rather than
 * Saturday when workdaysOnly is on.
 */
export function rolloverTarget(
  from: CivilDate,
  opts: RolloverOptions,
): CivilDate {
  return nextEligibleDay(addDays(from, 1), opts);
}
