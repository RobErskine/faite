import { addDays, dayOfWeek, toCivilDate } from "./scheduling";
import type { CivilDate } from "./schema";

/**
 * The five named targets behind the card context menu's "Reschedule" submenu
 * (EI-283).
 *
 * Pure civil-date arithmetic, like `scheduling.ts` — every function here is
 * `(kind, from) -> CivilDate` and nothing reads the clock, the store, or the
 * DOM. That is what lets the menu render five resolved dates during a render
 * pass, and what keeps this importable from a Worker.
 *
 * Two rules decide what these dates MEAN, and both are deliberate:
 *
 * 1. The anchor is always TODAY, never the card's own `scheduledDate`. Half
 *    the board has no other anchor — a card in a list column is unscheduled —
 *    and the cards that most need a quick reschedule are anchored in the past:
 *    the Faite Loop renders a missed to-do in today's column while it still
 *    carries last week's date, so "in 2 days" measured from the stored date
 *    would land behind today and `deriveColumn` would roll it straight back.
 *    An action that visibly does nothing is the worst outcome here.
 *    `parseQuickAdd`'s "tomorrow" and `overdriveBase`'s never-the-past clamp
 *    already work this way.
 *
 * 2. Nothing snaps to an eligible day. A named row is a date the user chose,
 *    not a rollover the app performed on their behalf — the same rule
 *    `stageDate` follows ("a deliberately chosen Saturday stays on
 *    Saturday"), and the opposite of `rampDate`, which may snap precisely
 *    because the ramp never shows a bare offset. "Next month" landing on the
 *    3rd because the 1st is a Sunday would simply be wrong.
 *
 * Rule 2 is only honest because the menu renders each option's resolved date
 * beside its label (`rampLabel`), so "In 2 days" can never quietly mean
 * something else. Keep that column if you keep these rules.
 */

/** In `dayOfWeek`'s 0 = Sunday numbering. */
const SUNDAY = 0;
/** Where "next week" lands. */
const MONDAY = 1;
/** Where "this weekend" lands. */
const SATURDAY = 6;

export type QuickRescheduleKind =
  | "today"
  | "tomorrow"
  | "in2days"
  | "in3days"
  | "thisWeekend"
  | "nextWeek"
  | "nextMonth";

export interface QuickRescheduleOption {
  kind: QuickRescheduleKind;
  /** The menu row's own text. The resolved date is rendered separately. */
  label: string;
  /** Where this option puts the to-do. */
  date: CivilDate;
}

/**
 * Menu order and wording, in one place so the submenu and its tests cannot
 * drift. "In 2 days" rather than "+2 days": the menu is prose, and the
 * resolved date beside it already carries the precision.
 */
const QUICK_RESCHEDULE_LABELS: readonly {
  kind: QuickRescheduleKind;
  label: string;
}[] = [
  { kind: "today", label: "Today" },
  { kind: "tomorrow", label: "Tomorrow" },
  { kind: "in2days", label: "In 2 days" },
  { kind: "in3days", label: "In 3 days" },
  { kind: "thisWeekend", label: "This weekend" },
  { kind: "nextWeek", label: "Next week" },
  { kind: "nextMonth", label: "Next month" },
];

/**
 * The four the date popover shows above its calendar (EI-318), in this order.
 *
 * A subset, not a second vocabulary: every kind here is defined once above
 * and resolved by the same `quickRescheduleDate`, so the popover and the
 * card menu can never disagree about what "next week" means. The popover
 * shows fewer because it also has to fit a month grid and two footer buttons
 * inside one phone viewport, where a menu has the whole screen to grow into.
 */
export const DATE_POPOVER_KINDS = [
  "today",
  "tomorrow",
  "thisWeekend",
  "nextWeek",
] as const satisfies readonly QuickRescheduleKind[];

/**
 * The next `weekday` STRICTLY AFTER `from` — Monday asked from a Monday is
 * seven days later, not today.
 *
 * Deliberately not `quick-add.ts`'s private `nextWeekday`, which counts today
 * as a match because typing "fri" on a Friday sensibly means this Friday. A
 * menu row reading "Next week" that scheduled something for the current moment
 * would be a different promise entirely, so the two cannot share an
 * implementation.
 */
export function nextWeekdayAfter(weekday: number, from: CivilDate): CivilDate {
  // `|| 7` is what makes it strict: a difference of 0 means `from` already is
  // that weekday, which must advance a full week rather than stand still.
  const diff = ((weekday - dayOfWeek(from) + 7) % 7) || 7;
  return addDays(from, diff);
}

/**
 * The 1st of the month after `from`'s.
 *
 * Built from the date's own parts rather than by adding days, so it is exact
 * for every month length and needs no leap-year case: the day component is
 * discarded, which is the whole point.
 */
export function firstOfNextMonth(from: CivilDate): CivilDate {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  return m === 12 ? toCivilDate(y + 1, 1, 1) : toCivilDate(y, m + 1, 1);
}

/**
 * "This weekend" — the coming Saturday, or today when today is already the
 * weekend.
 *
 * Inclusive, unlike `nextWeekdayAfter`, and for quick-add's reason rather
 * than this module's: typing "fri" on a Friday sensibly means this Friday,
 * and "this weekend" on a Saturday plainly means today, not eight days away.
 * Sunday counts as the weekend it is the back half of, so it also resolves to
 * today. "Next week" stays strict — a row promising a fresh week that
 * resolved to the current moment would be a different promise entirely.
 */
function thisWeekendDate(from: CivilDate): CivilDate {
  const day = dayOfWeek(from);
  if (day === SATURDAY || day === SUNDAY) return from;
  return addDays(from, (SATURDAY - day + 7) % 7);
}

export function quickRescheduleDate(kind: QuickRescheduleKind, from: CivilDate): CivilDate {
  switch (kind) {
    case "today":
      return from;
    case "thisWeekend":
      return thisWeekendDate(from);
    case "tomorrow":
      return addDays(from, 1);
    case "in2days":
      return addDays(from, 2);
    case "in3days":
      return addDays(from, 3);
    case "nextWeek":
      return nextWeekdayAfter(MONDAY, from);
    case "nextMonth":
      return firstOfNextMonth(from);
  }
}

/** Every option in menu order, resolved against `from` (see rule 1 above). */
export function quickRescheduleOptions(from: CivilDate): QuickRescheduleOption[] {
  return QUICK_RESCHEDULE_LABELS.map(({ kind, label }) => ({
    kind,
    label,
    date: quickRescheduleDate(kind, from),
  }));
}
