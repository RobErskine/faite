import type { CivilDate, Todo } from "./schema";
import { type PlacementContext, formatShortDate, rollsElapsed, rolloverTarget } from "./scheduling";
import { zonedInstant } from "./zoned";

/**
 * The Faite Loop, made visible: the individual rolls a todo has made on its
 * way toward (or into) Overflow, derived from `scheduledDate` the same way
 * `deriveColumn` derives placement — no event rows, no writes.
 *
 * One derivation, three consumers: the day timeline, the per-todo History,
 * and (via `rollsElapsed` alone) the card affordances all agree because they
 * all come from here. See docs/FAITE-LOOP.md.
 */

export interface RollEvent {
  /** `rolledOver` for each day it rolled forward; `overflowed` once, the day
   * it first crossed into Overflow. Nothing is emitted for days spent
   * sitting in Overflow after that — there is no new placement to report. */
  kind: "rolledOver" | "overflowed";
  /** The day this event happened on. */
  day: CivilDate;
  /** The todo's original scheduled date, unchanged across every event in a
   * todo's sequence — the anchor a "rolled over from Aug 12" marker reads. */
  from: CivilDate;
  /** How many eligible days elapsed as of `day`. 1-indexed. */
  rolls: number;
  /** Eligible days from `day` until this todo crosses into Overflow — the
   * same units as `rolls`, so a still-rolling card can say when that's
   * coming, not just how far it's come. 0 on the `overflowed` event itself
   * (it already happened, as of `day`). */
  overflowsIn: number;
}

/**
 * Every roll (and the overflow, if it happened) a still-open, non-recurring
 * todo has made as of `ctx.today`, oldest first.
 *
 * Settled todos never roll (`placeSettled` in lib/board.ts agrees) and
 * recurring todos bypass the loop entirely — one miss sends an occurrence
 * straight to Overflow (see recurrence-expand.ts), so there is no gradual
 * roll sequence to report for them.
 */
export function rollEventsFor(
  todo: Pick<Todo, "status" | "scheduledDate" | "recurrenceParentId">,
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays" | "overflowAfterDays">,
): RollEvent[] {
  if (todo.status !== "open") return [];
  if (todo.recurrenceParentId) return [];

  const { scheduledDate } = todo;
  if (!scheduledDate) return [];

  const opts = { workdaysOnly: ctx.workdaysOnly, workdays: ctx.workdays };
  const totalRolls = rollsElapsed(scheduledDate, ctx.today, opts);
  if (totalRolls <= 0) return [];

  // Bounded by overflowAfterDays + 1, not by the todo's age: once past the
  // threshold the todo is in Overflow for good, so nothing more to compute.
  const events: RollEvent[] = [];
  let day = scheduledDate;
  for (let rolls = 1; rolls <= totalRolls; rolls++) {
    day = rolloverTarget(day, opts);
    // Fixed by rolls/overflowAfterDays alone — 0 exactly when this event IS
    // the overflow (rolls === overflowAfterDays + 1).
    const overflowsIn = ctx.overflowAfterDays - rolls + 1;
    if (rolls <= ctx.overflowAfterDays) {
      events.push({ kind: "rolledOver", day, from: scheduledDate, rolls, overflowsIn });
    } else {
      events.push({ kind: "overflowed", day, from: scheduledDate, rolls, overflowsIn });
      break;
    }
  }
  return events;
}

export interface RolledTodo {
  todo: Todo;
  /** Eligible days elapsed as of `day` — 1-indexed, same field `RollEvent`
   * carries. Per-todo, not per-group: two todos landing on the same `day`
   * can have different `rolls` if they were originally scheduled on
   * different days, which is why this can't live on `DailyRollSummary`
   * itself alongside `todos: Todo[]` the way it used to. */
  rolls: number;
  /** The todo's original scheduled date — the anchor a "3 days, from Aug 19"
   * cell reads, same field `RollEvent.from` carries. */
  from: CivilDate;
}

export interface DailyRollSummary {
  key: string;
  kind: "rolledOver" | "overflowed";
  /** The day this group of rolls happened on. */
  day: CivilDate;
  /** `day` at 00:00 in `timezone` — same synthetic-instant convention as
   * `rollTimelineEvents` (`todo-timeline.ts`), so a summary sorts alongside
   * real events by `at` without a special case. */
  at: string;
  /** Every todo that rolled (or overflowed) on `day`, each with its own
   * roll count and origin date, unordered. */
  todos: RolledTodo[];
}

/**
 * One row per `(day, kind)` across every todo, for a whole-app activity feed
 * — "6 to-dos rolled over" instead of `rollTimelineEvents`'s one-row-per-todo
 * shape, which would drown a global feed the way an uncollapsed per-todo log
 * would (see that function's comment).
 *
 * Two limits worth knowing before trusting this as "what rolled":
 *
 * 1. **Answers "what is rolling," not "what rolled."** `rollEventsFor` only
 *    fires for todos that are STILL open and STILL scheduled as of
 *    `ctx.today` (see its own doc comment) — a todo that rolled three times
 *    and was then completed contributes nothing here, retroactively. Real
 *    per-roll history would need logged events, not this derivation.
 * 2. **Rescheduling rewrites the past.** Like every rollover view in this
 *    app, changing a todo's `scheduledDate` changes which days it appears to
 *    have rolled through on next render (`day-timeline.ts` limit 8).
 *
 * Cost is naturally bounded, not something this function has to enforce:
 * `rollEventsFor` only ever looks back `overflowAfterDays + 1` days (≤31) per
 * todo, the same computation the board already does every render for card
 * badges — so the result set stays small regardless of table size.
 */
export function dailyRollSummaries(
  todos: readonly Todo[],
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays" | "overflowAfterDays">,
  timezone: string,
): DailyRollSummary[] {
  const groups = new Map<string, DailyRollSummary>();

  for (const todo of todos) {
    for (const roll of rollEventsFor(todo, ctx)) {
      const key = `${roll.kind}:${roll.day}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, kind: roll.kind, day: roll.day, at: zonedInstant(roll.day, "00:00", timezone), todos: [] };
        groups.set(key, group);
      }
      group.todos.push({ todo, rolls: roll.rolls, from: roll.from });
    }
  }

  return [...groups.values()].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}

/**
 * The live worked example shown in Settings → Faite Loop, e.g.
 * "Miss Aug 12 → rolls to Aug 13, Aug 14, Aug 15 → Overflow on Aug 16".
 *
 * Anchored at `ctx.today` purely for realistic-looking dates — it is not
 * claiming anything was actually missed today.
 */
export interface LoopExample {
  /** The example's "missed" day — `ctx.today`, purely for realistic dates. */
  missed: CivilDate;
  /** Each day the example rolls through on its way to Overflow, oldest
   * first. Empty when `overflowAfterDays` is 0 — no rolling, straight to
   * Overflow the next eligible day. */
  rollDays: CivilDate[];
  /** The day the example crosses into Overflow. */
  overflowDay: CivilDate;
}

/**
 * The dates behind the Settings → Faite Loop worked example — shared by
 * `describeLoop` (the sentence) and the Settings UI's three-box illustration
 * (`loop-example.tsx`), so they can never show different dates for the same
 * settings.
 */
export function loopExample(
  ctx: Pick<PlacementContext, "today" | "overflowAfterDays" | "workdaysOnly" | "workdays">,
): LoopExample {
  const opts = { workdaysOnly: ctx.workdaysOnly, workdays: ctx.workdays };
  const missed = ctx.today;

  const rollDays: CivilDate[] = [];
  let day = missed;
  for (let i = 0; i < ctx.overflowAfterDays; i++) {
    day = rolloverTarget(day, opts);
    rollDays.push(day);
  }
  const overflowDay = rolloverTarget(day, opts);

  return { missed, rollDays, overflowDay };
}

export function describeLoop(
  ctx: Pick<PlacementContext, "today" | "overflowAfterDays" | "workdaysOnly" | "workdays">,
): string {
  const { missed, rollDays, overflowDay } = loopExample(ctx);

  if (rollDays.length === 0) {
    return `Miss ${formatShortDate(missed)} → Overflow on ${formatShortDate(overflowDay)}`;
  }

  const rollSummary =
    rollDays.length <= 4
      ? rollDays.map(formatShortDate).join(", ")
      : `${formatShortDate(rollDays[0])} … ${formatShortDate(rollDays[rollDays.length - 1])} (${rollDays.length} days)`;

  return `Miss ${formatShortDate(missed)} → rolls to ${rollSummary} → Overflow on ${formatShortDate(overflowDay)}`;
}
