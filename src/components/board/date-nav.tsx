"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CivilDate, Settings } from "@/lib/schema";
import { addDays, formatShortDate } from "@/lib/scheduling";
import { ViewSettings } from "./view-settings";
import { SavedViewsMenu } from "./saved-views-menu";

const WEEK = 7;
const MONTH = 30;
const QUARTER = 90;

interface DateNavProps {
  /** Raw Dexie row, passed straight through to `ViewSettings`. */
  settings: Settings | undefined;
  today: CivilDate;
  /** Day index at the track's left edge, from useDayTrack. */
  anchorIndex: number;
  /** How many day columns are currently in view, from useDayTrack. */
  visibleCount: number;
  canJumpBack: (delta: number) => boolean;
  canJumpForward: (delta: number) => boolean;
  onJump: (delta: number) => void;
  /** Jumps to an absolute day index — the date picker's only use of the hook. */
  onJumpToDate: (target: number) => void;
  onToday: () => void;
  /**
   * The phone shell's context bar (`phone-board.tsx`, mobile plan M3). Drops
   * `ViewSettings` (the day-count toggle is moot — the pager always shows
   * one), `SavedViewsMenu` (a saved view snapshots `visibleDays` among other
   * fields, so it's moot for the same reason), and the Quarter/Month/Week
   * jump buttons, which don't fit at phone width and duplicate what a swipe
   * already does faster. Range label, Today, and the date picker survive:
   * swipe has no equivalent for "jump to a specific far-out date."
   */
  compact?: boolean;
}

/**
 * Jump controls for the day track, sitting directly above it — mirrors the
 * "My Lists / Archived" bar above the planning track so the two halves stay
 * visually symmetric.
 *
 * Deltas are 7/30/90 CALENDAR days, not `addMonths`/`addQuarters`: the board
 * is day-indexed throughout (see lib/scheduling.ts), and there is deliberately
 * no month-aware arithmetic there. "Month" reads correctly as a scroll
 * distance, and it keeps applicability below uniform across all three.
 *
 * Every button only renders when the jump it performs is actually possible —
 * `‹ Week` is absent three days into the window, `Week ›` is absent at the
 * cap. `Today` fills the gap that leaves: it is the only way back once every
 * back button is hidden.
 */
export function DateNav({
  settings,
  today,
  anchorIndex,
  visibleCount,
  canJumpBack,
  canJumpForward,
  onJump,
  onJumpToDate,
  onToday,
  compact,
}: DateNavProps) {
  const rangeStart = addDays(today, anchorIndex);
  const rangeEnd = addDays(today, anchorIndex + Math.max(visibleCount - 1, 0));
  const range =
    rangeStart === rangeEnd
      ? formatShortDate(rangeStart)
      : `${formatShortDate(rangeStart)} – ${formatShortDate(rangeEnd)}`;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="num min-w-0 flex-1 truncate text-sm font-medium">{range}</span>
        {anchorIndex > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onToday}>
            Today
          </Button>
        )}
        <JumpToDatePicker today={today} onSelect={onJumpToDate} />
      </div>
    );
  }

  return (
    /*
      Three tracks rather than the old `[label][ml-auto cluster]`, so the view
      controls sit centred on the BAR rather than centred on whatever the range
      label and the jump cluster leave over. `flex-1` on the outer two is what
      does it: they claim equal space regardless of their content, which is why
      the middle stays put as jump buttons appear and disappear (they render
      conditionally — see the comment above this component). `min-w-0` lets the
      label truncate instead of pushing the centre off-axis.
    */
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="num min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {range}
      </span>

      <div className="flex items-center gap-1">
        <ViewSettings settings={settings} />
        <SavedViewsMenu settings={settings} />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {canJumpBack(QUARTER) && (
          <JumpButton label="Quarter" direction="back" onClick={() => onJump(-QUARTER)} />
        )}
        {canJumpBack(MONTH) && (
          <JumpButton label="Month" direction="back" onClick={() => onJump(-MONTH)} />
        )}
        {canJumpBack(WEEK) && (
          <JumpButton label="Week" direction="back" onClick={() => onJump(-WEEK)} />
        )}

        {anchorIndex > 0 && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onToday}>
            Today
          </Button>
        )}

        {canJumpForward(WEEK) && (
          <JumpButton label="Week" direction="forward" onClick={() => onJump(WEEK)} />
        )}
        {canJumpForward(MONTH) && (
          <JumpButton label="Month" direction="forward" onClick={() => onJump(MONTH)} />
        )}
        {canJumpForward(QUARTER) && (
          <JumpButton label="Quarter" direction="forward" onClick={() => onJump(QUARTER)} />
        )}

        <JumpToDatePicker today={today} onSelect={onJumpToDate} />
      </div>
    </div>
  );
}

function JumpButton({
  label,
  direction,
  onClick,
}: {
  label: string;
  direction: "back" | "forward";
  onClick: () => void;
}) {
  const icon =
    direction === "back" ? (
      <ChevronLeft aria-hidden />
    ) : (
      <ChevronRight aria-hidden />
    );
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn("text-muted-foreground", direction === "forward" && "flex-row-reverse")}
      onClick={onClick}
      aria-label={direction === "back" ? `Previous ${label.toLowerCase()}` : `Next ${label.toLowerCase()}`}
    >
      {icon}
      {label}
    </Button>
  );
}

/**
 * Local-time bridge for the calendar widget only.
 *
 * The rest of the app deliberately never converts a stored date to a JS
 * `Date` (see the header comment in lib/scheduling.ts) — DST and travel can
 * shift a `Date`-based day by one. `react-day-picker` has no civil-date mode,
 * so it has to operate on `Date` objects regardless; the trick that keeps
 * this safe is never mixing the two representations. Both the reference point
 * (`today`, turned into a LOCAL midnight `Date` here) and the picker's output
 * live entirely in local time, so counting whole days between them is exact
 * even across a DST transition — only cross-checking a local `Date` against a
 * UTC-parsed civil date risks the off-by-one this module exists to avoid.
 */
export function civilDateToLocalDate(date: CivilDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetweenLocalDates(from: Date, to: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function JumpToDatePicker({
  today,
  onSelect,
}: {
  today: CivilDate;
  onSelect: (target: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const todayLocal = civilDateToLocalDate(today);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Jump to date"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }), "text-muted-foreground")}
      >
        <CalendarDays aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        {/*
          No upper bound. Picking any future date — a reminder a year and a
          half out, say — is meant to work; `onSelect` (wired to `jumpToIndex`
          in useDayTrack) grows the rendered window and the jump ceiling to
          reach it rather than the picker refusing the date outright. Past
          dates stay disabled — the board never scrolls before today.
        */}
        <Calendar
          mode="single"
          defaultMonth={todayLocal}
          disabled={{ before: todayLocal }}
          onSelect={(date) => {
            if (!date) return;
            onSelect(daysBetweenLocalDates(todayLocal, date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
