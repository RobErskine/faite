"use client";

import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CornerDownRight,
  ListChecks,
  MapPin,
  Paperclip,
  Repeat,
} from "lucide-react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { edge, tint } from "@/lib/colors";
import { priorityRail, railBackgroundImage } from "@/lib/priority";
import type { CivilDate, Label as LabelRecord, ReminderPreset, Todo } from "@/lib/schema";
import { formatDeadlineDue, formatShortDateAsOf, isDeadlineMissed } from "@/lib/scheduling";
import { reminderLabelFor } from "@/lib/reminder-presets";
import { describeOverflowAge, formatOverflowAge } from "@/lib/rollover-events";

/**
 * Shared with `command-palette.tsx` — see the note there on why `TodoCard`
 * itself (drag, keyboard nav, checkbox) cannot be reused directly. These are
 * the presentational pieces of the board card factored out so both surfaces
 * render priority, deadline/location/recurrence, and label badges the same
 * way.
 */

/**
 * An absolutely positioned span, not `border-l` — see `TodoCard` for the four
 * reasons (box-sizing alignment, border mitring against `border-b`, the drop
 * indicator's flight target, and same-priority runs reading as one stripe).
 * Callers that don't share those constraints (e.g. the command palette) can
 * override `className`.
 */
export function PriorityRail({
  priority,
  className,
}: {
  priority: Todo["priority"];
  className?: string;
}) {
  const rail = priorityRail(priority);
  if (!rail) return null;
  return (
    <span
      aria-hidden
      data-priority-rail={priority}
      /*
        Achromatic (docs/DESIGN.md §7, decision A): the rail is `--foreground`
        at the level's opacity, so it inverts with the theme and never collides
        with a list's hue or the urgency red. Every level below P1 is broken to
        its own rhythm — solid, long dash, short dash, sparse dots — so a level
        can be read without a neighbour to compare it against. Drawn as a
        repeating gradient rather than a border, because the rail is a span,
        not a border (see TodoCard for why).
      */
      style={{
        width: rail.width,
        opacity: rail.opacity,
        ...(railBackgroundImage(rail)
          ? { backgroundImage: railBackgroundImage(rail)! }
          : { backgroundColor: "var(--foreground)" }),
      }}
      /*
        `inset-y-1`, not `inset-y-0`. The rail used to run the full row height
        and borrow its gap from the row's `border-b` — a 1px divider that the
        Air pass removed (docs/DESIGN.md, 2026-09-05) without anything here
        noticing. Rows sit flush now, so consecutive rails abutted exactly:
        measured 669.3 → 669.3, 704.5 → 704.5, four separate levels fusing
        into one tapering stripe down the column.

        The 4px is deliberate rather than restoring the old 1px. A 1px gap was
        legible when a divider line sat in it; with nothing there it reads as
        continuous. This makes the tick its own mark, which is what the level
        is supposed to be.
      */
      className={cn("pointer-events-none absolute inset-y-1 left-0", className)}
    />
  );
}

/**
 * The same rail, drawn inline instead of pinned to a card's edge — for a menu
 * row or a select trigger, where it has to sit in text flow beside a word.
 *
 * Deliberately `PriorityRail` with a positioning override rather than a second
 * component: width, opacity and each level's rhythm all come from
 * `PRIORITY_RAILS`, and a copy would drift the first time one of them changed.
 */
export function PriorityGlyph({ priority }: { priority: Todo["priority"] }) {
  return (
    <PriorityRail
      priority={priority}
      className="relative inset-y-auto left-auto h-3.5 shrink-0"
    />
  );
}

/**
 * The inline glyph run — deadline-ahead, rollover, location, recurrence —
 * meant to sit inside a title's inline flow, immediately before the title
 * text. Each glyph is its own tooltip trigger; a missed deadline is NOT
 * included here, it gets the loud badge in `TodoMetaBadges` instead. Neither
 * is an overflowed todo's rollover history — see `TodoMetaBadges`'s
 * Overflow age badge for that.
 *
 * Purely visual: the glyphs carry no hidden text. Their words are in
 * `todoRowName`, which the row sets as its name, so a sentence placed here
 * cannot jump ahead of the title (EI-381).
 */
export function TitleMarkers({
  todo,
  today,
  recurrenceSummary,
  rolledFrom,
}: {
  todo: Todo;
  today: CivilDate;
  recurrenceSummary?: string;
  /** Set only while the todo is still rolling — on today's column, not yet
   * in Overflow. See `rollEventsFor` in `lib/rollover-events.ts`. */
  rolledFrom?: { from: CivilDate; rolls: number; overflowsIn: number };
}) {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  /** Quiet inline marker for a deadline still ahead; a missed one gets the loud badge. */
  const dueAhead = todo.deadline && !deadlineMissed ? todo.deadline : null;

  return (
    <>
      {rolledFrom && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                data-rollover-marker
                className="mr-1 inline-block align-[-0.1875em] text-muted-foreground"
              >
                <CornerDownRight className="size-3" aria-hidden />
              </span>
            }
          />
          <TooltipContent>
            {/* `TooltipContent`'s popup is `inline-flex` (row), so two direct
              children sit side by side, not stacked — this wrapper is the
              flex item, and stacks its own children as a column. */}
            <span className="flex flex-col text-center">
              <span>
                Rolled from {formatShortDateAsOf(rolledFrom.from, today)} - {rolledFrom.rolls}{" "}
                {rolledFrom.rolls === 1 ? "day" : "days"}
              </span>
              <span>
                Overflow in {rolledFrom.overflowsIn} {rolledFrom.overflowsIn === 1 ? "day" : "days"}
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      )}
      {dueAhead && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                data-deadline-marker
                className="mr-1 inline-block align-[-0.1875em] text-muted-foreground"
              >
                <CalendarCheck className="size-3" aria-hidden />
              </span>
            }
          />
          <TooltipContent>{formatDeadlineDue(dueAhead, today)}</TooltipContent>
        </Tooltip>
      )}
      {todo.location && (
        <Tooltip>
          {/*
            A `span` trigger, deliberately: Base UI adds no role and no
            tabIndex of its own, so this stays non-interactive content inside
            the title rather than a control nested in a control.
          */}
          <TooltipTrigger
            render={
              <span
                data-location-pin
                className="mr-1 inline-block align-[-0.1875em] text-muted-foreground"
              >
                <MapPin className="size-3" aria-hidden />
              </span>
            }
          />
          <TooltipContent>{todo.location}</TooltipContent>
        </Tooltip>
      )}
      {todo.recurrenceParentId && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                data-recurrence-marker
                className="mr-1 inline-block align-[-0.1875em] text-muted-foreground"
              >
                <Repeat className="size-3" aria-hidden />
              </span>
            }
          />
          <TooltipContent>
            {recurrenceSummary ?? "Part of a repeating series"}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

export interface TodoRowNameInput {
  todo: Todo;
  labels: LabelRecord[];
  today: CivilDate;
  recurrenceSummary?: string;
  rolledFrom?: { from: CivilDate; rolls: number; overflowsIn: number };
  showScheduledDate?: boolean;
  missedCount?: number | null;
  overflow?: { from: CivilDate; since: CivilDate };
  reminderPresets?: ReminderPreset[];
  subtaskCount?: { done: number; total: number } | null;
  attachmentCount?: number;
  /** "Completed Oct 14, 3:12 PM · planned Oct 12" — `formatCompletionStamp`. */
  completionStamp?: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything `TitleMarkers` and `TodoMetaBadges` show, as one spoken string.
 * The caller sets it as the row's `aria-label` (EI-381). This exists because
 * a name built from the row's DOM read badly in Chrome.
 *
 * EI-378 gave each part a visually hidden comma, and production read "Call
 * grandma , Priority 2 , 10:00 AM". The stray spaces came from Chrome, not
 * from the markup: when it builds a name from content, it adds a space at
 * every block-level boundary, and the title (`-webkit-box`), each badge (a
 * flex item) and every `sr-only` span (absolutely positioned, so blockified)
 * is one. No hidden-text trick can attach a comma to the text before it. The
 * DOM also put the glyphs' sentences first ("Rolled from Oct 11, … Call
 * dentist"), so the name did not start with the title. happy-dom has no
 * layout, so none of this showed up in a unit test.
 *
 * An explicit name has no layout to depend on. It always starts with the
 * title (WCAG 2.5.3, and every `name: title` selector), and it reads the same
 * in every browser and in a test. The glyphs and badges carry no hidden text
 * of their own any more; this is the one place their words live, so a new
 * badge must be added here as well, or it is visible but silent.
 *
 * Clauses follow the screen order: title, priority, settled stamp, then the
 * title glyphs, then the badges. A badge whose glyph is not self-explanatory
 * ("1/3", a paperclip and "2", "×3") reads as its tooltip text.
 */
export function todoRowName({
  todo,
  labels,
  today,
  recurrenceSummary,
  rolledFrom,
  showScheduledDate,
  missedCount,
  overflow,
  reminderPresets,
  subtaskCount,
  attachmentCount,
  completionStamp,
}: TodoRowNameInput): string {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  const parts: string[] = [todo.title];
  const push = (part: string | null | undefined | false) => {
    if (part) parts.push(part);
  };

  push(priorityRail(todo.priority)?.label);
  // "Completed Oct 14 · 3:12 PM · planned Oct 12": the dots are visual
  // punctuation, so the spoken form uses the same commas as everything else.
  push(completionStamp?.split(" · ").join(", "));

  // TitleMarkers, in its order.
  if (rolledFrom) {
    push(
      `Rolled from ${formatShortDateAsOf(rolledFrom.from, today)}, ${plural(rolledFrom.rolls, "day", "days")} ago`,
    );
    push(`Overflow in ${plural(rolledFrom.overflowsIn, "day", "days")}`);
  }
  if (todo.deadline && !deadlineMissed) push(formatDeadlineDue(todo.deadline, today));
  if (todo.location) push(`Location: ${todo.location}`);
  if (todo.recurrenceParentId) push(`Repeats: ${recurrenceSummary ?? "part of a repeating series"}`);

  // TodoMetaBadges, in its order. The Overflow age is the full sentence here
  // ("In Overflow since Oct 6, 9 days"), not the badge's "since Oct 6 ·
  // 9 days": a screen reader has no column around the card to supply it.
  if (showScheduledDate && todo.scheduledDate) {
    push(`Scheduled ${formatShortDateAsOf(todo.scheduledDate, today)}`);
  }
  if (todo.reminderTime) push(reminderLabelFor(todo.reminderTime, reminderPresets ?? []));
  if (subtaskCount && subtaskCount.total > 0) {
    push(`${subtaskCount.done} of ${subtaskCount.total} sub-tasks done`);
  }
  if ((attachmentCount ?? 0) > 0) push(plural(attachmentCount!, "attachment", "attachments"));
  if (overflow) push(describeOverflowAge(overflow.since, today));
  if (deadlineMissed && todo.deadline) push(formatDeadlineDue(todo.deadline, today));
  if ((missedCount ?? 0) > 1) push(`Missed ${missedCount} times in a row`);
  for (const label of labels) {
    if (todo.labelIds.includes(label.id)) push(label.emoji ? `${label.emoji} ${label.name}` : label.name);
  }

  return parts.join(", ");
}

/**
 * The badge row: a missed deadline, an outstanding-occurrences count, a
 * scheduled date (only when the caller opts in via `showScheduledDate` — the
 * board card only wants this away from its own column, the palette always
 * wants it since it has no column to imply the date), an Overflow-age badge,
 * and labels. Renders `null` when there is nothing to show.
 *
 * Dates carry the year when it is not this year (`formatShortDateAsOf`,
 * EI-387): "Oct 1, 2027", not a bare "Oct 1" that reads as this October.
 *
 * Purely visual, like `TitleMarkers`. Each badge's words are in
 * `todoRowName`, so a badge added here must be added there too.
 */
export function TodoMetaBadges({
  todo,
  labels,
  today,
  showScheduledDate,
  missedCount,
  overflow,
  reminderPresets,
  subtaskCount,
  attachmentCount,
}: {
  todo: Todo;
  labels: LabelRecord[];
  today: CivilDate;
  showScheduledDate?: boolean;
  missedCount?: number | null;
  /** Set only once the todo has crossed into Overflow. See `rollEventsFor`
   * in `lib/rollover-events.ts` — `since` is the `overflowed` event's day,
   * and the badge reads "since <since> · N days" (`formatOverflowAge`), so
   * each card reports its own wait. */
  overflow?: { from: CivilDate; since: CivilDate };
  /** Named reminder times (EI-106 P5) — resolves `todo.reminderTime` through
   * `reminderLabelFor` so a preset match reads "🌅 In the morning" instead
   * of a bare clock time. Omit (or pass `[]`) where presets aren't in scope;
   * the badge still renders, just always as a formatted clock time. */
  reminderPresets?: ReminderPreset[];
  /**
   * Sub-task done/total counts (EI-183) — see `use-board-data.ts`'s
   * `subtaskCounts`. Undefined/null, or a `total` of 0, shows no badge.
   */
  subtaskCount?: { done: number; total: number } | null;
  /** How many files are attached (EI-242) — see `use-board-data.ts`'s
   * `attachmentCounts`. Undefined or 0 shows no badge. */
  attachmentCount?: number;
}) {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  const todoLabels = labels.filter((l) => todo.labelIds.includes(l.id));

  const hasContent =
    todoLabels.length > 0 ||
    (deadlineMissed && todo.deadline) ||
    (showScheduledDate && todo.scheduledDate) ||
    (missedCount ?? 0) > 1 ||
    Boolean(overflow) ||
    Boolean(todo.reminderTime) ||
    (subtaskCount?.total ?? 0) > 0 ||
    (attachmentCount ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      {showScheduledDate && todo.scheduledDate && (
        <Badge variant="outline" className="num gap-1 text-2xs font-normal">
          <CalendarClock className="size-2.5" aria-hidden />
          {formatShortDateAsOf(todo.scheduledDate, today)}
        </Badge>
      )}
      {todo.reminderTime && (
        <Badge variant="outline" className="num gap-1 text-2xs font-normal">
          <Bell className="size-2.5" aria-hidden />
          {reminderLabelFor(todo.reminderTime, reminderPresets ?? [])}
        </Badge>
      )}
      {subtaskCount && subtaskCount.total > 0 && (
        <Badge
          variant="outline"
          className="num gap-1 text-2xs font-normal"
          title={`${subtaskCount.done} of ${subtaskCount.total} sub-tasks done`}
        >
          <ListChecks className="size-2.5" aria-hidden />
          {subtaskCount.done}/{subtaskCount.total}
        </Badge>
      )}
      {(attachmentCount ?? 0) > 0 && (
        <Badge
          variant="outline"
          className="num gap-1 text-2xs font-normal"
          title={`${attachmentCount} ${attachmentCount === 1 ? "attachment" : "attachments"}`}
        >
          <Paperclip className="size-2.5" aria-hidden />
          {attachmentCount}
        </Badge>
      )}
      {overflow && (
        <Tooltip>
          {/*
            A styled `span`, not a `<Badge>`, as the trigger itself — every
            other trigger in this file is a plain element for the same
            reason (§ location pin above): the badge's visual classes are
            applied directly rather than composing two render-prop components.

            Muted ink, not the urgent red (EI-374, docs/DESIGN.md §1): the
            Overflow column's rule and count already carry the urgency once,
            so a red pill on every card in it was a wall of red saying the
            same thing N times — and red at `text-2xs` breaks PRODUCT.md's
            "colored text never at the smallest size". Same quiet register as
            the rolled-over marker this badge replaces.

            Words only, no icon (EI-383). It used to carry ↳ too, which made
            one glyph mean two things: "rolled forward onto today" on the
            title marker, "sitting in Overflow" here. ↳ belongs to the roll.

            "since Oct 6 · 9 days" everywhere (EI-390): the start and the
            count, never "In Overflow" (the column says that once) and never
            a bare count, which under a "Scheduled Aug 30" read as "9 days
            late". The full sentence is the row's name (`todoRowName`) and the
            tooltip.

            Fit (measured at the 168px column floor, whose badge row is
            148px): 96–101px in Source Sans, 112–116px in Hyperlegible, so it
            stays one unit and, beside other badges, moves to its own line
            whole. The one string that cannot fit is a start in another year
            in Hyperlegible ("since Dec 30, 2025 · 290 days", 170px), so the
            badge may break — but only between its two halves, each of which
            stays unbroken (`whitespace-nowrap` per half, `flex-wrap` on the
            pill). `nums`, not `num`: a phrase with numbers in it, not a
            standalone number, stays in the text face (docs/DESIGN.md §2) —
            mono would have cost a third more width.
          */}
          <TooltipTrigger
            render={
              <span
                data-overflow-age
                className={cn(
                  badgeVariants({ variant: "outline" }),
                  "nums text-2xs font-normal text-muted-foreground",
                  "h-auto min-h-5 max-w-full flex-wrap justify-start gap-x-[0.25em] gap-y-0 whitespace-normal",
                )}
              >
                {formatOverflowAge(overflow.since, today)
                  .split(" · ")
                  .map((half, i) => (
                    // The space before "·" is trimmed at a line start, so a
                    // wrapped second half begins "· 9 days"; on one line the
                    // text reads exactly `formatOverflowAge`'s string.
                    <span key={half} className="whitespace-nowrap">
                      {i > 0 && " · "}
                      {half}
                    </span>
                  ))}
              </span>
            }
          />
          <TooltipContent>
            Scheduled {formatShortDateAsOf(overflow.from, today)} ·{" "}
            {describeOverflowAge(overflow.since, today)}
          </TooltipContent>
        </Tooltip>
      )}
      {/*
        The two red badges sit one step up, at `text-xs`, while their
        neighbors stay at `text-2xs`: colored text never at the smallest size
        (PRODUCT.md). The variant supplies `--urgent-foreground` ink (EI-382).
      */}
      {deadlineMissed && todo.deadline && (
        <Badge variant="destructive" className="text-xs font-normal">
          Deadline <span className="num">{formatShortDateAsOf(todo.deadline, today)}</span>
        </Badge>
      )}
      {(missedCount ?? 0) > 1 && (
        <Badge
          variant="destructive"
          className="num gap-1 text-xs font-normal"
          title={`Missed ${missedCount} times in a row`}
        >
          <Repeat className="size-2.5" aria-hidden />×{missedCount}
        </Badge>
      )}
      {todoLabels.map((label) => (
        <Badge
          key={label.id}
          variant="secondary"
          className="text-2xs font-normal"
          /*
            The identity ladder from lib/colors.ts, not a hand-rolled alpha:
            tint behind, edge around, and — the one place hue touches text
            (docs/DESIGN.md §1) — the label's own color on the name.
          */
          style={
            label.color
              ? { backgroundColor: tint(label.color), borderColor: edge(label.color), color: label.color }
              : undefined
          }
        >
          {label.emoji ? `${label.emoji} ` : ""}
          {label.name}
        </Badge>
      ))}
    </span>
  );
}
