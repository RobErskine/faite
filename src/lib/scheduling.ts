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
 * Today as a civil date in the user's timezone.
 *
 * `en-CA` formats as YYYY-MM-DD, which is exactly our storage shape.
 */
export function todayIn(timezone: string, now: Date = new Date()): CivilDate {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // Unknown timezone: fall back to UTC rather than throwing mid-render.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

interface RolloverOptions {
  workdaysOnly: boolean;
  workdays: number[];
}

function isEligible(date: CivilDate, opts: RolloverOptions): boolean {
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
): PlacementContext {
  const today = todayIn(settings.timezone, now);
  return {
    today,
    visibleWindow: buildWindow(today, settings.visibleDays),
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
 * Then one override: if the resulting day is not in the visible window, the
 * todo renders in the planning half instead, flagged with `awayDate`. That
 * follows from the rule "a todo is hidden from planning only when it is
 * actually visible in the calendar" — otherwise something scheduled three weeks
 * out would appear in neither half. A visible consequence is that changing the
 * 1/3/5/7-day toggle changes which todos appear below. That is intended.
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
  if (placement.day !== OVERFLOW && !ctx.visibleWindow.includes(placement.day)) {
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
