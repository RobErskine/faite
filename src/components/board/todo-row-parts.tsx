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
import { priorityRail } from "@/lib/priority";
import type { CivilDate, Label as LabelRecord, ReminderPreset, Todo } from "@/lib/schema";
import { formatDeadlineDue, formatShortDate, isDeadlineMissed } from "@/lib/scheduling";
import { reminderLabelFor } from "@/lib/reminder-presets";

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
        with a list's hue or the urgency red. P4 is dotted — a 1px repeating
        gradient rather than a border, because the rail is a span, not a
        border (see TodoCard for why).
      */
      style={{
        width: rail.width,
        opacity: rail.opacity,
        ...(rail.dotted
          ? {
              backgroundImage:
                "repeating-linear-gradient(to bottom, var(--foreground) 0 2px, transparent 2px 5px)",
            }
          : { backgroundColor: "var(--foreground)" }),
      }}
      className={cn("pointer-events-none absolute inset-y-0 left-0", className)}
    />
  );
}

/**
 * The inline glyph run — deadline-ahead, rollover, location, recurrence —
 * meant to sit inside a title's inline flow, immediately before the title
 * text. Each glyph is its own tooltip trigger; a missed deadline is NOT
 * included here, it gets the loud badge in `TodoMetaBadges` instead. Neither
 * is an overflowed todo's rollover history — see `TodoMetaBadges`'s "In
 * Overflow" badge for that.
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
                <span className="sr-only">
                  Rolled from {formatShortDate(rolledFrom.from)},{" "}
                  {rolledFrom.rolls} {rolledFrom.rolls === 1 ? "day" : "days"} ago. Overflow in{" "}
                  {rolledFrom.overflowsIn} {rolledFrom.overflowsIn === 1 ? "day" : "days"}.{" "}
                </span>
              </span>
            }
          />
          <TooltipContent>
            {/* `TooltipContent`'s popup is `inline-flex` (row), so two direct
              children sit side by side, not stacked — this wrapper is the
              flex item, and stacks its own children as a column. */}
            <span className="flex flex-col text-center">
              <span>
                Rolled from {formatShortDate(rolledFrom.from)} - {rolledFrom.rolls}{" "}
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
                <span className="sr-only">
                  {formatDeadlineDue(dueAhead, today)}.{" "}
                </span>
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
                <span className="sr-only">Location: {todo.location}. </span>
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
                <span className="sr-only">
                  Repeats: {recurrenceSummary ?? "part of a repeating series"}.{" "}
                </span>
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

/**
 * The badge row: a missed deadline, an outstanding-occurrences count, a
 * scheduled date (only when the caller opts in via `showScheduledDate` — the
 * board card only wants this away from its own column, the palette always
 * wants it since it has no column to imply the date), an Overflow-age badge,
 * and labels. Renders `null` when there is nothing to show.
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
   * in `lib/rollover-events.ts` — `rolls` counts eligible days since
   * `from`, the same clock that put it here. */
  overflow?: { from: CivilDate; since: CivilDate; rolls: number };
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
          {formatShortDate(todo.scheduledDate)}
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
          */}
          <TooltipTrigger
            render={
              <span
                className={cn(badgeVariants({ variant: "destructive" }), "num gap-1 text-2xs font-normal")}
              >
                <CornerDownRight className="size-2.5" aria-hidden />
                In Overflow {overflow.rolls} {overflow.rolls === 1 ? "day" : "days"}
              </span>
            }
          />
          <TooltipContent>
            Scheduled {formatShortDate(overflow.from)} · in Overflow since{" "}
            {formatShortDate(overflow.since)}
          </TooltipContent>
        </Tooltip>
      )}
      {deadlineMissed && todo.deadline && (
        <Badge variant="destructive" className="text-2xs font-normal">
          Deadline <span className="num">{formatShortDate(todo.deadline)}</span>
        </Badge>
      )}
      {(missedCount ?? 0) > 1 && (
        <Badge
          variant="destructive"
          className="num gap-1 text-2xs font-normal"
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
            (docs/DESIGN.md §1) — the label's own colour on the name.
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
