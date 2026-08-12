"use client";

import { CalendarCheck, CalendarClock, MapPin, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { priorityRail } from "@/lib/priority";
import type { CivilDate, Label as LabelRecord, Todo } from "@/lib/schema";
import { formatDeadlineDue, formatShortDate, isDeadlineMissed } from "@/lib/scheduling";

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
      style={{ width: rail.width, backgroundColor: rail.color }}
      className={cn("pointer-events-none absolute inset-y-0 left-0", className)}
    />
  );
}

/**
 * The inline glyph run — deadline-ahead, location, recurrence — meant to sit
 * inside a title's inline flow, immediately before the title text. Each
 * glyph is its own tooltip trigger; a missed deadline is NOT included here,
 * it gets the loud badge in `TodoMetaBadges` instead.
 */
export function TitleMarkers({
  todo,
  today,
  recurrenceSummary,
}: {
  todo: Todo;
  today: CivilDate;
  recurrenceSummary?: string;
}) {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  /** Quiet inline marker for a deadline still ahead; a missed one gets the loud badge. */
  const dueAhead = todo.deadline && !deadlineMissed ? todo.deadline : null;

  return (
    <>
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
 * wants it since it has no column to imply the date), and labels. Renders
 * `null` when there is nothing to show.
 */
export function TodoMetaBadges({
  todo,
  labels,
  today,
  showScheduledDate,
  missedCount,
}: {
  todo: Todo;
  labels: LabelRecord[];
  today: CivilDate;
  showScheduledDate?: boolean;
  missedCount?: number | null;
}) {
  const deadlineMissed = isDeadlineMissed(todo, { today });
  const todoLabels = labels.filter((l) => todo.labelIds.includes(l.id));

  const hasContent =
    todoLabels.length > 0 ||
    (deadlineMissed && todo.deadline) ||
    (showScheduledDate && todo.scheduledDate) ||
    (missedCount ?? 0) > 1;

  if (!hasContent) return null;

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {showScheduledDate && todo.scheduledDate && (
        <Badge variant="outline" className="num gap-1 text-2xs font-normal">
          <CalendarClock className="size-2.5" aria-hidden />
          {formatShortDate(todo.scheduledDate)}
        </Badge>
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
          style={
            label.color
              ? { backgroundColor: `${label.color}20`, color: label.color }
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
