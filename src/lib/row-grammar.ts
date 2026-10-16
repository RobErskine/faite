import {
  CalendarDays,
  Clock,
  CornerDownRight,
  Flag,
  ListChecks,
  MapPin,
  Paperclip,
  Repeat,
} from "lucide-react";

/**
 * The to-do row's badge grammar, in one place (EI-395, docs/DESIGN.md §2).
 *
 * A plain module with no `"use client"`, on purpose: the board's row parts
 * (`todo-row-parts.tsx`) and the homepage's demo board and story panel (Server
 * Components, zero client JS) all read it, so the hero cannot drift from the
 * product's own row. Classes and icons, nothing that renders.
 *
 * The rules:
 *
 * - **Type.** `num` (the numeric face) only for a badge that is nothing but a
 *   count: "1/3", "3". Anything with a word or a date in it — "Oct 12",
 *   "2:00 PM", "☕ Afternoon", "Deadline Oct 12", "since Oct 6 · 9 days" — is
 *   `nums`: the text face with tabular figures. One family per badge.
 * - **Size.** Every badge is `text-2xs` on the 20px pill, except the two red
 *   verdicts, which are `text-xs`: colored text never at the smallest size
 *   (PRODUCT.md, EI-382).
 * - **Icons.** Every glyph on a row is 12px in muted ink — the title's markers
 *   and a badge's icon alike. The badge's words keep the badge's ink. The red
 *   verdicts carry no icon: their words are the whole message.
 * - **One icon, one meaning.** `ROW_ICONS` below; a test fails if two
 *   meanings share one.
 * - **Order.** `ROW_BADGE_ORDER`: the verdict, then when, then progress, then
 *   identity. `todoRowName` reads in the same order.
 */

/** A meaning on the row, and the one icon that draws it. */
export const ROW_ICONS = {
  /** ↳ — rolled forward onto today (the Faite Loop, still rolling). */
  rolled: CornerDownRight,
  /** A deadline still ahead. A missed one is the red "Deadline Oct 12" badge. */
  deadline: Flag,
  /** Part of a repeating series. Never "missed ×N", which is words only. */
  recurring: Repeat,
  location: MapPin,
  /** The scheduled date, shown away from its own day column and in ⌘K. */
  scheduled: CalendarDays,
  /**
   * `reminderTime` — the to-do's time of day. It also fires a foreground
   * reminder (`lib/reminders.ts`), but it is one field, and the control that
   * sets it is "Time" with this clock (`date-popover.tsx`). It wore a bell,
   * which said "a reminder" about a badge that reads "2:00 PM". The bell
   * waits for a reminder that exists apart from the time.
   */
  time: Clock,
  subtasks: ListChecks,
  attachments: Paperclip,
} as const;

export type RowIcon = keyof typeof ROW_ICONS;

/**
 * The title's inline glyphs, in reading order: the roll (where it stands in
 * the loop), then when (deadline ahead, repeats), then identity (where).
 */
export const ROW_GLYPH_ORDER = ["rolled", "deadline", "recurring", "location"] as const;

/**
 * The badge line, in order of importance. Verdict: a missed deadline, missed
 * occurrences, the Overflow age. When: the scheduled date, then the time —
 * date before time, the way every stamp in the app reads ("Oct 14,
 * 3:12 PM"). Progress: sub-tasks, attachments. Identity: labels.
 */
export const ROW_BADGE_ORDER = [
  "deadline-missed",
  "missed-occurrences",
  "overflow-age",
  "scheduled",
  "time",
  "subtasks",
  "attachments",
  "label",
] as const;

export type RowBadge = (typeof ROW_BADGE_ORDER)[number];

/** A title glyph's slot: inline, before the title text, on its first line. */
export const ROW_GLYPH_SLOT = "mr-1 inline-block align-[-0.1875em] text-muted-foreground";
/** The glyph itself — 12px, every one. */
export const ROW_GLYPH = "size-3";

/** The badge line under the title. */
export const ROW_BADGES = "mt-1.5 flex flex-wrap items-center gap-1";

/**
 * Applied on top of `badgeVariants(...)`. `[&>svg]:` because the badge base
 * already sizes its icon with `[&>svg]:size-3!` — the ink rides the same
 * selector.
 */
const ICON_INK = "[&>svg]:text-muted-foreground";

/** A badge with a word or a date in it: "Oct 12", "2:00 PM", "☕ Afternoon". */
export const ROW_BADGE_TEXT = `nums gap-1 text-2xs font-normal ${ICON_INK}`;
/** A badge that is only a count: "1/3", "3". */
export const ROW_BADGE_COUNT = `num gap-1 text-2xs font-normal ${ICON_INK}`;
/** A red verdict ("Deadline Oct 12", "Missed ×3"): words, one step up, no icon. */
export const ROW_BADGE_VERDICT = "nums text-xs font-normal";
/** A label chip (`secondary` variant, `labelChipStyle` for its ink). */
export const ROW_BADGE_LABEL = "text-2xs font-normal";
