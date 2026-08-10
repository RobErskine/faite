import type { DayColumn } from "@/lib/board";
import { weekendColumnId } from "@/lib/board";
import type { CivilDate } from "@/lib/schema";
import { addDays, dayOfWeek } from "@/lib/scheduling";

/**
 * Collapsing the weekend, as pure functions.
 *
 * THE CONSTRAINT THAT SHAPES ALL OF THIS: weekend days are never removed from
 * `PlacementContext.visibleWindow`. `deriveColumn` (lib/scheduling.ts) decides
 * whether a day is rendered with an O(1) offset check —
 * `daysBetween(today, day) >= visibleWindow.length` — which is only correct
 * because the window is contiguous from today. Punching Saturday out of it
 * would not hide Saturday; it would silently exile every Saturday-scheduled
 * todo to the planning half as an "away" card.
 *
 * So the window stays contiguous and this is a RENDERING concern: the board
 * builds every day column as usual, then groups the weekend ones into a single
 * collapsed slot on the way to the screen.
 */

/**
 * Which weekday numbers (0 = Sunday) count as the weekend.
 *
 * The complement of `settings.workdays`, rather than a hardcoded `[0, 6]`.
 * "Which days are the weekend" is already answered by that setting, and a
 * second answer here would drift from it the moment someone works Tue–Sat.
 */
export function weekendDaysFrom(workdays: readonly number[]): ReadonlySet<number> {
  const working = new Set(workdays);
  return new Set([0, 1, 2, 3, 4, 5, 6].filter((d) => !working.has(d)));
}

/**
 * How many CALENDAR days from `today` are needed to show `n` working days.
 *
 * This is what makes `settings.visibleDays` mean "columns you can see" once
 * weekends collapse: asking for 5 on a Friday returns 7, so the track holds
 * Fri, Sat, Sun, Mon, Tue, Wed, Thu — five real columns and one strip.
 *
 * The span always ENDS on a working day. Stopping one day later would leave a
 * trailing weekend strip with nothing after it: a control you can open to find
 * days that are only there because they were on the way to somewhere else.
 *
 * Two guards, both load-bearing:
 *  - every day being a weekend (`workdays: []`) has no answer, so it falls back
 *    to a plain calendar span rather than looping forever;
 *  - the loop is bounded at `7 * n` regardless, which is exact when only one
 *    day a week is a working day and generous everywhere else. A bound that
 *    can't be hit is still worth having in a function driven by stored data.
 */
export function calendarSpanFor(
  today: CivilDate,
  n: number,
  weekendDays: ReadonlySet<number>,
): number {
  if (n <= 0) return 0;
  if (weekendDays.size >= 7) return n;

  let working = 0;
  for (let i = 0; i < 7 * n; i++) {
    if (!weekendDays.has(dayOfWeek(addDays(today, i)))) {
      working++;
      if (working === n) return i + 1;
    }
  }
  return n;
}

/** One position in the day track: a real day column, or a collapsed run. */
export type TrackSlot =
  | { kind: "day"; column: DayColumn }
  | {
      kind: "weekend";
      /** `weekendColumnId(first day)` — the strip's droppable and nav id. */
      id: string;
      columns: DayColumn[];
    };

/**
 * Fold maximal runs of consecutive weekend days into one slot each.
 *
 * Runs rather than fixed Sat+Sun pairs, because the window starts at *today*
 * and can begin or end mid-weekend: opening the board on a Sunday should give
 * a one-day strip, not a two-day one that reaches back into yesterday.
 */
export function groupWeekendRuns(
  days: readonly DayColumn[],
  weekendDays: ReadonlySet<number>,
): TrackSlot[] {
  const slots: TrackSlot[] = [];
  let run: DayColumn[] = [];

  const flush = () => {
    if (run.length === 0) return;
    slots.push({ kind: "weekend", id: weekendColumnId(run[0].day), columns: run });
    run = [];
  };

  for (const column of days) {
    if (weekendDays.has(dayOfWeek(column.day))) {
      run.push(column);
    } else {
      flush();
      slots.push({ kind: "day", column });
    }
  }
  flush();

  return slots;
}

/** Every day column in a slot list, flattened back into track order. */
export function slotDayColumns(slots: readonly TrackSlot[]): DayColumn[] {
  return slots.flatMap((slot) => (slot.kind === "day" ? [slot.column] : slot.columns));
}
