import type { CivilDate, Todo } from "./schema";
import { type PlacementContext, formatShortDate, rollsElapsed, rolloverTarget } from "./scheduling";

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
    if (rolls <= ctx.overflowAfterDays) {
      events.push({ kind: "rolledOver", day, from: scheduledDate, rolls });
    } else {
      events.push({ kind: "overflowed", day, from: scheduledDate, rolls });
      break;
    }
  }
  return events;
}

/**
 * The live worked example shown in Settings → Faite Loop, e.g.
 * "Miss Aug 12 → rolls to Aug 13, Aug 14, Aug 15 → Overflow on Aug 16".
 *
 * Anchored at `ctx.today` purely for realistic-looking dates — it is not
 * claiming anything was actually missed today.
 */
export function describeLoop(
  ctx: Pick<PlacementContext, "today" | "overflowAfterDays" | "workdaysOnly" | "workdays">,
): string {
  const opts = { workdaysOnly: ctx.workdaysOnly, workdays: ctx.workdays };
  const missed = ctx.today;

  if (ctx.overflowAfterDays === 0) {
    const overflowDay = rolloverTarget(missed, opts);
    return `Miss ${formatShortDate(missed)} → Overflow on ${formatShortDate(overflowDay)}`;
  }

  const rollDays: CivilDate[] = [];
  let day = missed;
  for (let i = 0; i < ctx.overflowAfterDays; i++) {
    day = rolloverTarget(day, opts);
    rollDays.push(day);
  }
  const overflowDay = rolloverTarget(day, opts);

  const rollSummary =
    rollDays.length <= 4
      ? rollDays.map(formatShortDate).join(", ")
      : `${formatShortDate(rollDays[0])} … ${formatShortDate(rollDays[rollDays.length - 1])} (${rollDays.length} days)`;

  return `Miss ${formatShortDate(missed)} → rolls to ${rollSummary} → Overflow on ${formatShortDate(overflowDay)}`;
}
