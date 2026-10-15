"use client";

import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  ListClock,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { civilDateToLocalDate } from "@/components/ui/date-picker-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CivilDate, Settings } from "@/lib/schema";
import { addDays, formatShortDate } from "@/lib/scheduling";
import { ViewSettings } from "./view-settings";

const WEEK = 7;
const MONTH = 30;
const QUARTER = 90;

/**
 * Jump distances, quantized to whole pages of the current view.
 *
 * The board stays day-indexed throughout (see the header comment below) —
 * this is still calendar days, never `addMonths`. But stepping 30 raw days
 * in, say, a 3-day view puts the grid on a different weekday every jump.
 * Rounding to the nearest whole page keeps the columns on a stable grid and
 * guarantees a jump never skips or repeats a day. `page` is the MEASURED
 * column count (`visibleCount` from useDayTrack), so a viewport too narrow
 * for the chosen view pages by what actually fits, not by the setting.
 *
 * Rigid columns (desktop-board.tsx sets --column-min == --column-max) bound
 * `visibleCount` at roughly the view's day count — inflated a little by
 * collapsed weekend strips — so Week/Month/Quarter can never quantize to the
 * same distance. The ‹ and › steps are one page: `pageAlignedJump(1, page)`.
 */
export function pageAlignedJump(base: number, page: number): number {
  const p = Math.max(1, page);
  return Math.max(p, Math.round(base / p) * p);
}

interface DateNavProps {
  /** Raw Dexie row, passed straight through to `ViewSettings`. */
  settings: Settings | undefined;
  today: CivilDate;
  /** Day index at the track's left edge, from useDayTrack. */
  anchorIndex: number;
  /**
   * The page size ‹ and › step by and the Jump menu's steps quantize to
   * (far-width columns that fit), from useDayTrack. Not the title's span —
   * see `visibleThrough`.
   */
  visibleCount: number;
  /**
   * The last day index actually on screen, from useDayTrack — the range
   * title's end. Separate from `visibleCount` since EI-384: with a wide Today
   * the first page shows fewer days than a later one, and a column a little
   * under half visible still shows its date.
   */
  visibleThrough: number;
  canJumpBack: (delta: number) => boolean;
  canJumpForward: (delta: number) => boolean;
  onJump: (delta: number) => void;
  /** Jumps to an absolute day index — the date picker's only use of the hook. */
  onJumpToDate: (target: number) => void;
  onToday: () => void;
  /** Opens the global activity feed (`ActivitySheet`). Sits here, not in
   * `AppHeader`, because `DateNav` — unlike the header — is already rendered
   * by both shells with an identical calendar-button neighbor in both the
   * `compact` and full branches, so one placement covers desktop and phone
   * with no new prop threading through either shell. */
  onOpenActivity: () => void;
  /**
   * Opens the History sheet (EI-322) — the one way to look at a past day.
   * The board itself never scrolls before today, and that is deliberate: the
   * past is a separate place, not more columns to the left. The button sits
   * directly LEFT of the range label for the same reason — earlier is to the
   * left of now.
   */
  onOpenHistory: () => void;
  /**
   * The phone shell's context bar (`phone-board.tsx`, mobile plan M3). Drops
   * `ViewSettings` (the day-count toggle is moot — the pager always shows
   * one; saved views snapshot `visibleDays` among other fields, so they are
   * moot for the same reason), the ‹ › steps and the Jump menu's
   * week/month/quarter steps, which a swipe already does faster. Range label,
   * Today, and the date picker survive: swipe has no equivalent for "jump to
   * a specific far-out date."
   */
  compact?: boolean;
  /**
   * The phone pager's page indicator (EI-383), `compact` only. Overflow is
   * page −1 of the Days pager, and from Today nothing said it was there: the
   * pager has no dots, and a swipe you don't know about is a page you never
   * see. So today's page — the one page that sits next to Overflow — shows a
   * quiet "‹ Overflow 8" before the range, pointing the way the swipe goes.
   *
   * Only at `anchorIndex === 0`: on later days `Today` is the way back (and
   * claims the width this would need at 375px), and on the Overflow page the
   * heading already says where you are.
   */
  overflowPeek?: { count: number; onShow: () => void };
}

/**
 * The bar above the day track: where you are, how the board is filtered, and
 * how to move. Mirrors the "My Lists / Archived" bar above the planning track
 * so the two halves stay visually symmetric.
 *
 * Three groups, read left to right (EI-392): **where** (History, the range),
 * **what** (View, day count), **move** (‹ Today › Jump, Activity). It used to
 * be ten peers — ‹ Quarter ‹ Month ‹ Week Today Week › Month › Quarter ›
 * beside View, the day count, Weekends, Saved views, a date picker, Activity
 * and History — and the jump buttons read as view switches ("Month" looked
 * like a month view; it scrolled 28 days). Now:
 *
 * - ‹ and › step one page, the move you make most. Disabled at the ends
 *   rather than hidden, so the cluster never shifts under the pointer.
 * - "Today" is always there, disabled while you are on it.
 * - "Jump" holds the week/month/quarter steps, both ways, beside the
 *   calendar: every far move in one popover, one click away.
 * - Weekends and Saved views live in the View menu (`view-settings.tsx`).
 *
 * Deltas are CALENDAR days, not `addMonths`/`addQuarters`: the board is
 * day-indexed throughout (see lib/scheduling.ts), and there is deliberately
 * no month-aware arithmetic there. "Month" reads correctly as a scroll
 * distance, and it keeps applicability below uniform across all three.
 * A jump step only renders when the jump it performs is possible.
 */
export function DateNav({
  settings,
  today,
  anchorIndex,
  visibleCount,
  visibleThrough,
  canJumpBack,
  canJumpForward,
  onJump,
  onJumpToDate,
  onToday,
  onOpenActivity,
  onOpenHistory,
  compact,
  overflowPeek,
}: DateNavProps) {
  const rangeStart = addDays(today, anchorIndex);
  const rangeEnd = addDays(today, Math.max(visibleThrough, anchorIndex));
  /*
    A negative anchor only happens on phone, where Overflow is page −1 of the
    pager (`phone-board.tsx`, `indexOffset` in `use-day-track.ts`). That page
    is not a day, so `today + anchorIndex` would title it with YESTERDAY's
    date — a day the board never shows (EI-374). It is titled by what it is.
  */
  const onOverflowPage = anchorIndex < 0;
  const range = onOverflowPage
    ? "Overflow"
    : rangeStart === rangeEnd
      ? formatShortDate(rangeStart)
      : `${formatShortDate(rangeStart)} – ${formatShortDate(rangeEnd)}`;

  // Computed once and reused for both the availability check and the click
  // handler below — canJumpBack/Forward must see the SAME quantized value
  // the click will actually jump by, or a button can render and then no-op.
  const page = pageAlignedJump(1, visibleCount);
  const weekStep = pageAlignedJump(WEEK, visibleCount);
  const monthStep = pageAlignedJump(MONTH, visibleCount);
  const quarterStep = pageAlignedJump(QUARTER, visibleCount);
  const jumpSteps: JumpStep[] = [
    { label: "Next week", delta: weekStep },
    { label: "Next month", delta: monthStep },
    { label: "Next quarter", delta: quarterStep },
    { label: "Previous week", delta: -weekStep },
    { label: "Previous month", delta: -monthStep },
    { label: "Previous quarter", delta: -quarterStep },
  ].filter(({ delta }) => (delta > 0 ? canJumpForward(delta) : canJumpBack(-delta)));
  // ‹ never strands you between pages: a step longer than the distance back
  // to today lands on today (a date pick can leave the anchor mid-page).
  const backStep = Math.min(page, anchorIndex);
  const pageLabel = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        {overflowPeek && anchorIndex === 0 && <OverflowPeek {...overflowPeek} />}
        <HistoryTrigger onClick={onOpenHistory} />
        {/*
          The board's one serif display moment (docs/DESIGN.md §2): "where am
          I" is the first thing worth reading on the page, and there was no
          `<h1>` anywhere under /board until this one.
        */}
        <h1 className="nums min-w-0 flex-1 truncate font-heading text-base font-semibold tracking-tight text-foreground">
          {range}
        </h1>
        {/* Off today in either direction — Overflow (−1) included. */}
        {anchorIndex !== 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onToday}>
            Today
          </Button>
        )}
        <JumpToDatePicker today={today} onSelect={onJumpToDate} />
        <ActivityTrigger onClick={onOpenActivity} />
      </div>
    );
  }

  return (
    /*
      Three tracks rather than the old `[label][ml-auto cluster]`, so the view
      controls sit centered on the BAR rather than centered on whatever the range
      label and the move cluster leave over. `flex-1` on the outer two is what
      does it: they claim equal space regardless of their content. `min-w-0`
      lets the label truncate instead of pushing the center off-axis.
    */
    <div className="flex items-center gap-2 px-4 py-2">
      {/*
        The board's one serif display moment (docs/DESIGN.md §2): "where am
        I" is the first thing worth reading on the page, and there was no
        `<h1>` anywhere under /board until this one.

        Wrapped with the History button so the pair shares the left track's
        `flex-1` — the view controls stay centered on the bar.
      */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <HistoryTrigger onClick={onOpenHistory} />
        <h1 className="nums min-w-0 truncate font-heading text-lg font-semibold tracking-tight text-foreground">
          {range}
        </h1>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg border border-line/60 bg-surface-0 p-0.5">
        <ViewSettings settings={settings} />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <StepButton
          direction="back"
          label={`Back ${pageLabel(backStep || page)}`}
          disabled={anchorIndex <= 0}
          onClick={() => onJump(-backStep)}
        />
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          disabled={anchorIndex === 0}
          onClick={onToday}
        >
          Today
        </Button>
        <StepButton
          direction="forward"
          label={`Forward ${pageLabel(page)}`}
          disabled={!canJumpForward(page)}
          onClick={() => onJump(page)}
        />
        <JumpMenu today={today} steps={jumpSteps} onJump={onJump} onSelectDate={onJumpToDate} />
        <ActivityTrigger onClick={onOpenActivity} />
      </div>
    </div>
  );
}

/**
 * "‹ Overflow 8" — see `DateNavProps.overflowPeek`. Muted ink and no rule:
 * Overflow's red lives on its own column (EI-374), and a pointer to it is
 * not the place to repeat it. The count is the unfiltered pile, the same
 * number the column header shows; an empty Overflow drops it rather than
 * printing a 0.
 *
 * The accessible name contains the visible words ("Show Overflow, 8 to-dos"
 * holds "Overflow 8" once punctuation is ignored), so voice control can say
 * what it sees.
 */
function OverflowPeek({ count, onShow }: { count: number; onShow: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0 gap-0.5 pl-1.5 text-muted-foreground"
      onClick={onShow}
      aria-label={count > 0 ? `Show Overflow, ${count} to-do${count === 1 ? "" : "s"}` : "Show Overflow"}
    >
      <ChevronLeft aria-hidden />
      Overflow
      {count > 0 && <span className="num ml-1">{count}</span>}
    </Button>
  );
}

/**
 * An icon-only control with its accessible name as a tooltip (EI-383's rule:
 * a sighted mouse user is owed the same words a screen reader hears).
 */
function IconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn("text-muted-foreground", className)}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function HistoryTrigger({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Open history" onClick={onClick} className="shrink-0">
      <History aria-hidden />
    </IconButton>
  );
}

function ActivityTrigger({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Open activity feed" onClick={onClick}>
      <ListClock aria-hidden />
    </IconButton>
  );
}

/** ‹ and ›, named for the distance they move ("Forward 6 days"). */
function StepButton({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "back" | "forward";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton label={label} onClick={onClick} disabled={disabled}>
      {direction === "back" ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
    </IconButton>
  );
}

interface JumpStep {
  label: string;
  /** Calendar days, already page-aligned; negative is back. */
  delta: number;
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
 *
 * The conversion itself moved to `ui/date-picker-field.tsx` when the sheet's
 * date fields became the second and third caller (EI-318); it is re-exported
 * here so this module's own callers did not have to move with it.
 */
export { civilDateToLocalDate };

export function daysBetweenLocalDates(from: Date, to: Date): number {
  const msPerDay = 86_400_000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

/**
 * The calendar the date picker and the Jump menu share. No upper bound:
 * picking any future date — a reminder a year and a half out, say — is meant
 * to work; `onSelect` (wired to `jumpToIndex` in useDayTrack) grows the
 * rendered window and the jump ceiling to reach it rather than the picker
 * refusing the date outright. Past dates stay disabled — the board never
 * scrolls before today.
 */
function JumpCalendar({
  today,
  onSelect,
}: {
  today: CivilDate;
  onSelect: (target: number) => void;
}) {
  const todayLocal = civilDateToLocalDate(today);
  return (
    <Calendar
      mode="single"
      defaultMonth={todayLocal}
      disabled={{ before: todayLocal }}
      onSelect={(date) => {
        if (!date) return;
        onSelect(daysBetweenLocalDates(todayLocal, date));
      }}
    />
  );
}

/** The phone bar's date picker: the calendar alone, behind its icon. */
function JumpToDatePicker({
  today,
  onSelect,
}: {
  today: CivilDate;
  onSelect: (target: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Jump to date"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-xs" }), "text-muted-foreground")}
      >
        <CalendarDays aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <JumpCalendar
          today={today}
          onSelect={(target) => {
            onSelect(target);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Jump" (EI-392): every move longer than a page, in one place. The steps
 * sit in a column beside the calendar, so "next month" and "the 14th" are
 * the same click away and read as what they are — places to go, not views.
 * A popover rather than a menu because a calendar grid is not a menu item.
 *
 * The visible word is the whole accessible name, so voice control can say
 * "click Jump" (EI-377); the calendar icon keeps the glyph the old date
 * picker used, so the control a returning user reached for is still there.
 */
function JumpMenu({
  today,
  steps,
  onJump,
  onSelectDate,
}: {
  today: CivilDate;
  steps: JumpStep[];
  onJump: (delta: number) => void;
  onSelectDate: (target: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const forward = steps.filter((s) => s.delta > 0);
  const back = steps.filter((s) => s.delta < 0);
  const stepButton = ({ label, delta }: JumpStep) => (
    <Button
      key={label}
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={() => {
        onJump(delta);
        setOpen(false);
      }}
    >
      {label}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "text-muted-foreground")}
      >
        <CalendarDays aria-hidden />
        Jump
        <ChevronDown aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto flex-row gap-0 p-0">
        {steps.length > 0 && (
          <div
            role="group"
            aria-label="Jump by"
            className="flex w-36 flex-col gap-0.5 border-r border-line/60 p-1.5"
          >
            {forward.map(stepButton)}
            {forward.length > 0 && back.length > 0 && (
              <div role="separator" className="my-1 h-px bg-border" />
            )}
            {back.map(stepButton)}
          </div>
        )}
        <JumpCalendar
          today={today}
          onSelect={(target) => {
            onSelectDate(target);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
