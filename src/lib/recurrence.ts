import { z } from "zod";
import { civilDateSchema, type CivilDate } from "./schema";
import { addDays, dayOfWeek, formatShortDate } from "./scheduling";

/**
 * Recurrence rules: a versioned JSON blob stored verbatim in
 * `Todo.recurrenceRule`, never RRULE.
 *
 * RRULE's only advantage is interop, and it is gone the moment
 * `anchor: "completed"` needs a non-standard extension — no real consumer
 * will honour it either way. RRULE's `UNTIL` is also a UTC date-time when
 * `DTSTART` is a date-time, which would drag instants into this civil-date
 * layer. A Zod schema over `JSON.parse` gets validation, defaults, and a type
 * for a fraction of the parsing surface.
 *
 * `anchor` lives INSIDE the rule, never as a sibling column: the rule syncs
 * as one field under field-level LWW, so splitting it would let device A's
 * anchor edit merge with device B's interval edit into a schedule neither
 * user asked for.
 */

export const RECURRENCE_FREQS = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const RECURRENCE_ANCHORS = ["scheduled", "completed"] as const;
export type RecurrenceAnchor = (typeof RECURRENCE_ANCHORS)[number];

export const recurrenceRuleSchema = z.object({
  /** Schema version. Bump and branch in `parseRule` before changing shape. */
  v: z.literal(1),
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().min(1).default(1),
  /**
   * 0 = Sunday. Weekly only. Empty means "the series start's own weekday" —
   * the natural default for "repeat every N weeks" with no day picked.
   */
  byDay: z.array(z.number().int().min(0).max(6)).default([]),
  /**
   * "Based on" in the custom-repeat dialog. `completed` ignores `byDay` and
   * steps a single interval forward from the last completion — see
   * `nextAfterCompletion`.
   */
  anchor: z.enum(RECURRENCE_ANCHORS).default("scheduled"),
  /** Inclusive. */
  until: civilDateSchema.nullable().default(null),
  /** Total occurrences, series start counted as the first. */
  count: z.number().int().min(1).nullable().default(null),
});
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export function defaultRule(seriesStart: CivilDate): RecurrenceRule {
  return {
    v: 1,
    freq: "weekly",
    interval: 1,
    byDay: [dayOfWeek(seriesStart)],
    anchor: "scheduled",
    until: null,
    count: null,
  };
}

/** Null on anything malformed — a bad rule must not crash a render. */
export function parseRule(raw: string | null | undefined): RecurrenceRule | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = recurrenceRuleSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function serializeRule(rule: RecurrenceRule): string {
  return JSON.stringify(rule);
}

// ---------------------------------------------------------------------------
// Month/year arithmetic — scheduling.ts has none of this.
// ---------------------------------------------------------------------------

function partsOf(date: CivilDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function toCivil(y: number, m: number, d: number): CivilDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Days in month `m` (1-based) of year `y`. Noon UTC avoids rounding. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
}

/**
 * Add calendar months. Clamps the day when the target month is shorter —
 * Jan 31 + 1 month = Feb 28 (Feb 29 in a leap year), not "March 3". This is
 * the one defensible policy: rolling forward into the next month silently
 * changes which day of the month the series lands on every time a 31st
 * crosses a 30-day month, while clamping keeps "the last day of the month"
 * stable for a series anchored there.
 */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const { y, m, d } = partsOf(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return toCivil(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Same clamp policy as `addMonths` — Feb 29 + 1 year = Feb 28. */
export function addYears(date: CivilDate, years: number): CivilDate {
  return addMonths(date, years * 12);
}

// ---------------------------------------------------------------------------
// Occurrence generation
// ---------------------------------------------------------------------------

/**
 * Safety valve against a pathological rule (e.g. `interval` huge with no
 * `until`/`count`) looping past any reasonable window. Not a real limit for
 * any rule a human would configure through the UI.
 */
const MAX_ITERATIONS = 5000;

/**
 * Yields occurrence dates in increasing order, starting at `seriesStart`,
 * honouring `interval`, `byDay` (weekly), `until`, and `count`. Unbounded
 * above `until`/`count` — callers must stop pulling, which `occurrencesBetween`
 * does via its `to` bound.
 *
 * Civil dates compare correctly with plain string `<`/`>`/`<=`/`>=` because
 * `YYYY-MM-DD` is fixed-width — used throughout instead of `daysBetween`.
 */
export function* iterateOccurrences(
  rule: RecurrenceRule,
  seriesStart: CivilDate,
): Generator<CivilDate> {
  let emitted = 0;
  const withinLimits = (date: CivilDate): boolean => {
    if (rule.until && date > rule.until) return false;
    if (rule.count !== null && emitted >= rule.count) return false;
    return true;
  };

  if (rule.freq === "daily") {
    let date = seriesStart;
    for (let i = 0; i < MAX_ITERATIONS && withinLimits(date); i++) {
      yield date;
      emitted++;
      date = addDays(date, rule.interval);
    }
    return;
  }

  if (rule.freq === "weekly") {
    const days = rule.byDay.length > 0
      ? [...rule.byDay].sort((a, b) => a - b)
      : [dayOfWeek(seriesStart)];
    const weekStart = addDays(seriesStart, -dayOfWeek(seriesStart));
    for (let week = 0, iterations = 0; iterations < MAX_ITERATIONS; week++) {
      if (week % rule.interval !== 0) continue;
      const thisWeekStart = addDays(weekStart, week * 7);
      let anyWithinLimits = false;
      let anyPastUntil = false;
      for (const wd of days) {
        const date = addDays(thisWeekStart, wd);
        if (date < seriesStart) continue;
        iterations++;
        if (!withinLimits(date)) {
          if (rule.until && date > rule.until) anyPastUntil = true;
          continue;
        }
        anyWithinLimits = true;
        yield date;
        emitted++;
      }
      // Once every day in a week is past `until` (or `count` is spent), no
      // later week can produce anything either — stop rather than looping to
      // MAX_ITERATIONS on a short, old series.
      if (!anyWithinLimits && (anyPastUntil || (rule.count !== null && emitted >= rule.count))) {
        return;
      }
    }
    return;
  }

  const step = rule.freq === "monthly" ? addMonths : addYears;
  for (let k = 0; k < MAX_ITERATIONS; k++) {
    const date = step(seriesStart, k * rule.interval);
    if (!withinLimits(date)) return;
    yield date;
    emitted++;
  }
}

/** Occurrence dates in `[from, to]`, both inclusive. */
export function occurrencesBetween(
  rule: RecurrenceRule,
  seriesStart: CivilDate,
  from: CivilDate,
  to: CivilDate,
): CivilDate[] {
  const out: CivilDate[] = [];
  for (const date of iterateOccurrences(rule, seriesStart)) {
    if (date > to) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/**
 * `anchor: "completed"` — the next occurrence is one interval past the last
 * COMPLETION, not derived from the rule's calendar alignment. `byDay` is
 * meaningless here (there is no "next Monday" once the schedule floats with
 * whenever the user finishes), so it is ignored: one step of `freq`/`interval`
 * forward from `lastCompleted`.
 */
export function nextAfterCompletion(rule: RecurrenceRule, lastCompleted: CivilDate): CivilDate {
  switch (rule.freq) {
    case "daily":
      return addDays(lastCompleted, rule.interval);
    case "weekly":
      return addDays(lastCompleted, rule.interval * 7);
    case "monthly":
      return addMonths(lastCompleted, rule.interval);
    case "yearly":
      return addYears(lastCompleted, rule.interval);
  }
}

/**
 * The occurrence immediately after `date`, which need not itself be a real
 * occurrence of the rule.
 *
 * Used to anchor a brand new template one occurrence past an existing one-off
 * todo that is becoming a series — see `createSeriesFromTodo`
 * (`lib/store/repositories.ts`). Storing `sourceTodo.scheduledDate` itself as
 * the new template's `scheduledDate` would generate a virtual occurrence on
 * the same day as the real, untouched todo it came from.
 */
export function firstOccurrenceAfter(rule: RecurrenceRule, date: CivilDate): CivilDate {
  if (rule.anchor === "completed") return nextAfterCompletion(rule, date);
  const it = iterateOccurrences(rule, date);
  it.next(); // `date` itself, always the generator's first value.
  const next = it.next();
  if (next.done) {
    throw new Error(
      "firstOccurrenceAfter: rule has no occurrence after the seed date (count/until too tight)",
    );
  }
  return next.value;
}

/**
 * The next occurrence strictly after `after`, or null if the rule has none —
 * past `until`/`count`, or `anchor: "completed"`, which has no fixed
 * schedule to compute from at all (the next instance doesn't exist until the
 * current one is actually completed — see `lib/recurrence-expand.ts`).
 *
 * Non-throwing sibling of `firstOccurrenceAfter`: this is meant to be called
 * from a render memo (the repeat section's "Next occurrence" line), where a
 * thrown error crashes the whole board rather than one dialog. A series
 * whose `until` has already passed is an entirely ordinary state, not a
 * programming error.
 */
export function nextOccurrenceAfter(
  rule: RecurrenceRule,
  seriesStart: CivilDate,
  after: CivilDate,
): CivilDate | null {
  if (rule.anchor === "completed") return null;
  for (const date of iterateOccurrences(rule, seriesStart)) {
    if (date > after) return date;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Occurrence identity
// ---------------------------------------------------------------------------

/**
 * Deterministic id for a materialized occurrence: `${templateId}@${date}`.
 *
 * Not a hash. Two devices materializing the same occurrence offline must
 * converge on one row, and a hash needs nothing over a readable composite —
 * WebCrypto's `digest` is async besides, which every call site here (drag
 * handlers, collision detection, the board's synchronous render memo) cannot
 * afford. `@` appears in no UUIDv7, no civil date, and none of the board's
 * seven droppable-id namespaces (`lib/board.ts`).
 *
 * This extends an existing precedent rather than breaking one: seeded rows
 * already use deterministic ids for the same convergence reason (`seed:tab:
 * my-lists`, `lib/store/repositories.ts`).
 */
export function occurrenceId(templateId: string, date: CivilDate): string {
  return `${templateId}@${date}`;
}

export function parseOccurrenceId(id: string): { templateId: string; date: CivilDate } | null {
  const at = id.indexOf("@");
  if (at < 0) return null;
  const date = id.slice(at + 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { templateId: id.slice(0, at), date };
}

// ---------------------------------------------------------------------------
// Human-readable summary
// ---------------------------------------------------------------------------

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Every 2 weeks on Mon, Wed, until Dec 31 2026" — the repeat dialog's summary line. */
export function summarizeRule(rule: RecurrenceRule, seriesStart: CivilDate): string {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.freq];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;

  if (rule.freq === "weekly") {
    const days = rule.byDay.length > 0 ? rule.byDay : [dayOfWeek(seriesStart)];
    const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_ABBR[d]).join(", ");
    text += ` on ${names}`;
  }

  if (rule.anchor === "completed") text += ", based on completion date";
  if (rule.count) text += `, ${rule.count} time${rule.count === 1 ? "" : "s"}`;
  else if (rule.until) text += `, until ${rule.until}`;

  return text;
}

/**
 * The schedule half of `summarizeRule`, without the end condition — "Every 2
 * weeks on Mon, Wed". Additive: `summarizeRule` is untouched so its existing
 * tests stay valid. Exists for the repeat section's structured display,
 * where schedule and end condition render as separate lines.
 */
export function summarizeSchedule(rule: RecurrenceRule, seriesStart: CivilDate): string {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.freq];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;

  if (rule.freq === "weekly") {
    const days = rule.byDay.length > 0 ? rule.byDay : [dayOfWeek(seriesStart)];
    const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_ABBR[d]).join(", ");
    text += ` on ${names}`;
  }

  if (rule.anchor === "completed") text += ", based on completion date";
  return text;
}

/** "Ends after 5 times" / "Ends Aug 7" / "Never ends" — the repeat section's end-condition line. */
export function summarizeEnd(rule: RecurrenceRule): string {
  if (rule.count) return `Ends after ${rule.count} time${rule.count === 1 ? "" : "s"}`;
  if (rule.until) return `Ends ${formatShortDate(rule.until)}`;
  return "Never ends";
}
