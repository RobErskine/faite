"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ComponentProps, ComponentType } from "react";
import {
  ArrowRightLeft,
  Calendar as CalendarIcon,
  CalendarOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  createHoverCardHandle,
} from "@/components/ui/hover-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { civilDateToLocalDate, localDateToCivilDate } from "@/components/ui/date-picker-field";
import { Label } from "@/components/ui/label";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Separator } from "@/components/ui/separator";
import { edge, effectiveListColor, isTintableColor, tint } from "@/lib/colors";
import {
  activeDays,
  buildDayLog,
  dayCompletions,
  dayTints,
  type DayLogEntry,
  type ListCompletions,
  type ListResolver,
} from "@/lib/day-log";
import { formatEventTime } from "@/lib/event-time";
import { addDays, formatDay, formatShortDate } from "@/lib/scheduling";
import type { CivilDate, DayNote, List, Tab } from "@/lib/schema";
import { parseEventPayload } from "@/lib/store/todo-events";
import { useEventsBetween, useTodosById } from "@/lib/store/hooks";
import { HISTORY_STARTS_AT } from "@/lib/todo-timeline";
import { useExitRetained } from "@/lib/use-exit-retained";
import { cn } from "@/lib/utils";
import { zonedInstant } from "@/lib/zoned";
import { TimelineList, TimelineRow } from "./timeline";

/**
 * History (EI-322): pick a past day, see what got done and what got decided.
 *
 * The board is forward-only — it starts at today and never scrolls back — and
 * that stays true. The past lives here instead, one day at a time, read from
 * the real event log (`lib/day-log.ts`), so what it shows for a day cannot
 * change later.
 *
 * Plain rows, no `TodoCard`, like `ActivitySheet` — so it is safe inside the
 * board's DndContext. Nothing runs while it has never been opened: every
 * query lives in `HistorySheetContent`, which is not rendered until then.
 */

/** The first day the log has anything for. Nothing earlier is backfilled. */
const HISTORY_START_DAY: CivilDate = HISTORY_STARTS_AT.slice(0, 10);

const ENTRY_ICON: Record<DayLogEntry["kind"], ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  done: Check,
  dropped: X,
  scheduled: CalendarIcon,
  unscheduled: CalendarOff,
  moved: ArrowRightLeft,
  deleted: Trash2,
  created: Plus,
};

function entryLabel(entry: DayLogEntry): string {
  switch (entry.kind) {
    case "done":
      return "Completed";
    case "dropped":
      return "Won't do";
    case "scheduled":
      return entry.from ? "Rescheduled" : "Scheduled";
    case "unscheduled":
      return "Unscheduled";
    case "moved":
      return "Moved";
    case "deleted":
      return "Deleted";
    case "created":
      return "Added";
  }
}

function entryDetail(entry: DayLogEntry): string | null {
  const parts: string[] = [];
  if (entry.kind === "scheduled" && entry.to) {
    parts.push(
      entry.from
        ? `${formatShortDate(entry.from)} → ${formatShortDate(entry.to)}`
        : `For ${formatShortDate(entry.to)}`,
    );
  }
  if (entry.kind === "unscheduled" && entry.from) parts.push(`Was on ${formatShortDate(entry.from)}`);
  if (entry.kind === "moved") parts.push(`To ${entry.toListName ?? "no list"}`);
  if (entry.viaOverdrive) parts.push("In Overdrive");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** `YYYY-MM-01` for the month `day` falls in. */
const monthOf = (day: CivilDate): CivilDate => `${day.slice(0, 7)}-01`;

/** `YYYY-MM-01`, `n` months after (or before, for a negative `n`) `month`. */
function addMonths(month: CivilDate, n: number): CivilDate {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** `YYYY-MM-01` of the month after `month`. */
const nextMonth = (month: CivilDate): CivilDate => addMonths(month, 1);

/**
 * How much of the calendar is on screen (EI-323). Every span is ROLLING: it
 * ends at the anchor month and reaches back, so Quarter in September is
 * Jul–Sep, not a calendar quarter — the month you are in is always in view.
 */
type CalendarView = "month" | "quarter" | "year";

const VIEWS: ReadonlyArray<{
  value: CalendarView;
  label: string;
  span: number;
  /** The day button's height. Fixed, not `aspect-square`: a square cell at
   * the sheet's full width would make one month ~550px tall. */
  cellHeight: string;
  /** The months' layout. Container queries, not viewport breakpoints —
   * what matters is the sheet's width, which on a 1289px window is only
   * ~490px inside. `@md` (448px) is the widest breakpoint that still puts a
   * quarter side by side there; a phone (~358px) stacks. */
  months: string;
  /** Year only: twelve months must fit a sheet, so the labels shrink too. */
  compact?: boolean;
  /** The day picker's minimum cell width. Seven of the default 28px are
   * 196px — wider than one of three columns in a ~490px sheet, so the
   * months overlap unless the cells can shrink to fit. */
  cellSize?: string;
}> = [
  { value: "month", label: "Month", span: 1, cellHeight: "h-10", months: "flex flex-col" },
  {
    value: "quarter",
    label: "Quarter",
    span: 3,
    cellHeight: "h-8 text-xs",
    months: "grid grid-cols-1 gap-6 @md:grid-cols-3 @md:gap-3",
    cellSize: "[--cell-size:--spacing(5)]",
  },
  {
    value: "year",
    label: "Year",
    span: 12,
    cellHeight: "h-5 text-[0.65rem]",
    months: "grid grid-cols-2 gap-x-3 gap-y-4 @md:grid-cols-3 @2xl:grid-cols-4",
    compact: true,
    cellSize: "[--cell-size:--spacing(5)]",
  },
];

/**
 * The hover card behind each day with completions (EI-324). ONE card for the
 * whole calendar — Year has up to 365 days — opened by whichever day is under
 * the pointer: every trigger shares `handle` and passes its day as the
 * payload.
 *
 * Read through context rather than a closure because the day picker takes its
 * `DayButton` as a component: one defined inside the sheet would be a new
 * component every render, and remounting every day button loses focus.
 */
const DayCardsContext = createContext<{
  handle: ReturnType<typeof createHoverCardHandle<CivilDate>>;
  completions: ReadonlyMap<CivilDate, readonly ListCompletions[]>;
} | null>(null);

function HistoryDayButton(props: ComponentProps<typeof CalendarDayButton>) {
  const cards = useContext(DayCardsContext);
  const day = localDateToCivilDate(props.day.date);
  if (!cards?.completions.has(day)) return <CalendarDayButton {...props} />;
  return (
    // A plain span WRAPS the day button rather than `render`ing it: a Base
    // UI trigger composed onto another component can drop its pointer
    // handlers (see the checkbox tooltip in `todo-card.tsx`), and the day
    // button keeps its own ref for the picker's keyboard focus.
    <HoverCardTrigger
      handle={cards.handle}
      payload={day}
      delay={300}
      render={<span className="flex w-full" />}
    >
      <CalendarDayButton {...props} />
    </HoverCardTrigger>
  );
}

/**
 * What a day's completions were, one row per list, most first — and why the
 * day has the tint it has. Each row wears its list's tint at the calendar's
 * one strength. Counts per list only: no day total, no comparison with other
 * days (`docs/DESIGN.md` §7, 2026-09-11). Won't do is not here, as it never
 * tints a day.
 */
function DayCompletionsCard({ day, rows }: { day: CivilDate; rows: readonly ListCompletions[] }) {
  const { weekday, label } = formatDay(day);
  return (
    <HoverCardContent side="top" className="w-60 space-y-1.5 p-2">
      <p className="type-eyebrow">
        Completed <span className="num normal-case text-muted-foreground">· {formatShortDate(day)}</span>
      </p>
      <ul aria-label={`Completed on ${weekday}, ${label}`} className="space-y-px">
        {rows.map((row) => (
          <li
            key={row.listId}
            className="flex items-center gap-2 px-2 py-1"
            style={row.color ? { backgroundColor: tint(row.color)! } : undefined}
          >
            <span className="num w-5 shrink-0 text-right">{row.count}</span>
            {/* The board's checked checkbox, drawn: a done to-do, not a control. */}
            <span
              aria-hidden
              className="flex size-4 shrink-0 items-center justify-center border border-primary bg-primary text-primary-foreground"
            >
              <Check className="size-3.5" />
            </span>
            <span className="min-w-0 truncate">{row.name}</span>
          </li>
        ))}
      </ul>
    </HoverCardContent>
  );
}

interface HistorySheetProps {
  /** The day on screen; null closes the sheet. */
  day: CivilDate | null;
  today: CivilDate;
  timezone: string;
  /** Every day note — the sheet looks up the one for the day on screen. */
  dayNotes: ReadonlyMap<CivilDate, DayNote>;
  /** Live AND archived lists, so a filed list still colors its rows. */
  listsById: ReadonlyMap<string, List>;
  /** Where a to-do with no list lives — `DaySheet`'s same fallback. */
  backlog: List | undefined;
  tabsById: ReadonlyMap<string, Pick<Tab, "color">>;
  onSelectDay: (day: CivilDate) => void;
  onClose: () => void;
  onSaveNote: (day: CivilDate, body: string) => void;
  onOpenTodo: (todoId: string) => void;
}

export function HistorySheet({ day: dayProp, ...rest }: HistorySheetProps) {
  // Held through the close so the sheet can animate out — see
  // src/lib/use-exit-retained.ts.
  const { value: day, open } = useExitRetained(dayProp);
  if (!day) return null;
  return <HistorySheetContent open={open} day={day} {...rest} />;
}

function HistorySheetContent({
  open,
  day,
  today,
  timezone,
  dayNotes,
  listsById,
  backlog,
  tabsById,
  onSelectDay,
  onClose,
  onSaveNote,
  onOpenTodo,
}: Omit<HistorySheetProps, "day"> & { day: CivilDate; open: boolean }) {
  const { weekday, label } = formatDay(day);

  const [view, setView] = useState<CalendarView>("month");
  const { span, cellHeight, months: monthsLayout, compact, cellSize } = VIEWS.find(
    (v) => v.value === view,
  )!;

  // `anchor` is the LAST month on screen; the window reaches `span - 1`
  // months back from it. It follows the day only when the day leaves the
  // window (the ‹ / › day buttons, a deep link, a smaller view) — clicking a
  // day already on screen must not slide Quarter or Year out from under the
  // pointer. Adjusted during render with the `lastSeen` pattern, not an
  // effect (`.ai/lessons.md`).
  const [anchor, setAnchor] = useState<CivilDate>(() => monthOf(day));
  const [seen, setSeen] = useState(`${day}|${view}`);
  if (`${day}|${view}` !== seen) {
    setSeen(`${day}|${view}`);
    const dayMonth = monthOf(day);
    if (dayMonth > anchor || dayMonth < addMonths(anchor, -(span - 1))) setAnchor(dayMonth);
  }
  const firstMonth = addMonths(anchor, -(span - 1));

  // Two indexed range scans on `todoEvents.at`: the months on screen, for the
  // dots and tints, and the day on screen, for the log. See `useEventsBetween`.
  const monthEvents = useEventsBetween(
    zonedInstant(firstMonth, "00:00", timezone),
    zonedInstant(nextMonth(anchor), "00:00", timezone),
  );
  const dayEvents = useEventsBetween(
    zonedInstant(day, "00:00", timezone),
    zonedInstant(addDays(day, 1), "00:00", timezone),
  );
  const todoIds = useMemo(() => [...new Set(dayEvents.map((e) => e.todoId))], [dayEvents]);
  const todosById = useTodosById(todoIds);

  const log = useMemo(
    () => buildDayLog(dayEvents, todosById, day, timezone),
    [dayEvents, todosById, day, timezone],
  );
  const dots = useMemo(
    () => [...activeDays(monthEvents, timezone)].map(civilDateToLocalDate),
    [monthEvents, timezone],
  );

  // Tints (EI-323). A completion written since EI-323 carries the list it
  // happened in; only older ones need the to-do's current list, so only
  // those ids are read — for a year of new rows, none.
  const lookupIds = useMemo(
    () => [
      ...new Set(
        monthEvents
          .filter((e) => {
            if (e.kind !== "done") return false;
            const payload = parseEventPayload(e.payload) as { listId?: unknown } | null;
            return !payload || !("listId" in payload);
          })
          .map((e) => e.todoId),
      ),
    ],
    [monthEvents],
  );
  const legacyTodos = useTodosById(lookupIds);
  const resolveList = useCallback<ListResolver>(
    (listId) => {
      const list = (listId ? listsById.get(listId) : undefined) ?? backlog;
      if (!list) return null;
      const color = effectiveListColor(list, tabsById);
      return { id: list.id, name: list.name, color: isTintableColor(color) ? color : null };
    },
    [listsById, backlog, tabsById],
  );
  // Each day's completions per list — the hover card's rows (EI-324) — and
  // the tint picked from them, so the card always explains the color.
  const completions = useMemo(
    () => dayCompletions(monthEvents, legacyTodos, resolveList, timezone),
    [monthEvents, legacyTodos, resolveList, timezone],
  );
  const tints = useMemo(() => dayTints(completions), [completions]);
  const [cardHandle] = useState(() => createHoverCardHandle<CivilDate>());
  const dayCards = useMemo(() => ({ handle: cardHandle, completions }), [cardHandle, completions]);
  // One day-picker modifier per color, each with its own inline background
  // (`modifiersStyles` lands on the day cell). ONE strength for every tint —
  // 1 completion or 20 look the same, so this says which list a day was
  // about and never how much (docs/DESIGN.md §4).
  const { tintModifiers, tintStyles } = useMemo(() => {
    const modifiers: Record<string, Date[]> = {};
    const styles: Record<string, { backgroundColor: string }> = {};
    const keys = new Map<string, string>();
    for (const [tinted, { color }] of tints) {
      const key = keys.get(color) ?? `tint${keys.size}`;
      keys.set(color, key);
      (modifiers[key] ??= []).push(civilDateToLocalDate(tinted));
      styles[key] = { backgroundColor: tint(color)! };
    }
    return { tintModifiers: modifiers, tintStyles: styles };
  }, [tints]);

  const note = dayNotes.get(day);
  const isEmpty = log.done.length + log.decisions.length + log.added.length === 0;
  const beforeHistory = day < HISTORY_START_DAY;

  const accentFor = (entry: DayLogEntry) => {
    const listId = entry.kind === "moved" ? entry.toListId : entry.listId;
    return edge(effectiveListColor(listId ? listsById.get(listId) : undefined, tabsById));
  };

  const section = (title: string, entries: DayLogEntry[]) =>
    entries.length > 0 && (
      <section className="space-y-1.5">
        {/* No count in the heading: a day's total is a score, and
            docs/DESIGN.md §4 rules those out. The hover card's per-list
            counts are the one exception (§7, 2026-09-11). */}
        <h3 className="type-eyebrow">{title}</h3>
        <TimelineList ariaLabel={`${title} on ${weekday}, ${label}`}>
          {entries.map((entry, index) => {
            const detail = entryDetail(entry);
            return (
              <TimelineRow
                key={entry.key}
                icon={ENTRY_ICON[entry.kind]}
                label={entryLabel(entry)}
                at={entry.at}
                when={formatEventTime(entry.at, timezone)}
                accent={accentFor(entry)}
                isLast={index === entries.length - 1}
              >
                <p className="mt-0.5 text-sm">
                  {entry.deleted ? (
                    <span className="text-muted-foreground line-through">{entry.title}</span>
                  ) : (
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => onOpenTodo(entry.todoId)}
                    >
                      {entry.title}
                    </button>
                  )}
                </p>
                {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
              </TimelineRow>
            );
          })}
        </TimelineList>
      </section>
    );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Same width override as `DaySheet` and `ActivitySheet` — see the
          comment there on why it has to match the `data-[side=right]:`
          modifier. */}
      <SheetContent className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]">
        <SheetHeader className="pr-10">
          <SheetTitle className="font-heading uppercase tracking-tight">History</SheetTitle>
          <SheetDescription className="text-xs">
            What got done, and decided, on a past day.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <Tabs value={view} onValueChange={(next) => setView(next as CalendarView)} className="gap-3">
            <TabsList aria-label="How much of the calendar to show" className="w-full">
              {VIEWS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* One panel, for whichever tab is active: the calendar itself.
                `@container` so the months lay out by the SHEET's width. */}
            <TabsContent value={view} className="@container">
              <DayCardsContext.Provider value={dayCards}>
                <Calendar
                  mode="single"
                  required
                  // Square cells (EI-324): a tinted day is a solid block, and
                  // same-color days side by side join into one bar. No gap on
                  // purpose — the bar shows what a run of days was about.
                  className={cn("w-full bg-transparent p-0 [--cell-radius:0px]", cellSize)}
                  classNames={{
                    root: "w-full",
                    months: `relative ${monthsLayout}`,
                    month: "flex w-full min-w-0 flex-col gap-2",
                    week: "mt-1 flex w-full",
                    // Replaces the shared cell class outright — `classNames`
                    // is spread after the defaults, it does not merge. Same as
                    // the default minus `aspect-square` and the range-mode
                    // rounding this single-date picker never uses.
                    day: "group/day relative w-full rounded-(--cell-radius) p-0 text-center select-none",
                    // `rounded-none` beats `Button`'s own radius — `CalendarDayButton`
                    // merges this class last.
                    day_button: `aspect-auto rounded-none ${cellHeight}`,
                    ...(compact
                      ? {
                          weekday: "flex-1 text-[0.6rem] font-normal text-muted-foreground select-none",
                          caption_label: "text-xs font-medium select-none",
                        }
                      : {}),
                  }}
                  components={{ DayButton: HistoryDayButton }}
                  showOutsideDays={false}
                  numberOfMonths={span}
                  pagedNavigation
                  selected={civilDateToLocalDate(day)}
                  onSelect={(date) => onSelectDay(localDateToCivilDate(date))}
                  month={civilDateToLocalDate(firstMonth)}
                  onMonthChange={(date) =>
                    setAnchor(addMonths(monthOf(localDateToCivilDate(date)), span - 1))
                  }
                  // Not the log's first month: with several months on screen
                  // that would push the window FORWARD past today (Aug–Oct in
                  // place of Jul–Sep). Far enough back that the LAST month on
                  // screen can still be the first month the log has.
                  startMonth={civilDateToLocalDate(addMonths(monthOf(HISTORY_START_DAY), -(span - 1)))}
                  endMonth={civilDateToLocalDate(today)}
                  disabled={[
                    { after: civilDateToLocalDate(today) },
                    { before: civilDateToLocalDate(HISTORY_START_DAY) },
                  ]}
                  modifiers={{ active: dots, ...tintModifiers }}
                  modifiersStyles={tintStyles}
                  modifiersClassNames={{
                    // A dot under the number, presence only (no count, no heat).
                    // It stays on a tinted day too, so color is never the only
                    // signal. `z-20` puts it above the day button (`z-10`).
                    active:
                      "after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-foreground/60 data-[selected=true]:after:bg-primary-foreground",
                  }}
                  labels={{
                    labelDayButton: (date, modifiers) => {
                      const mostly = tints.get(localDateToCivilDate(date));
                      return `${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${
                        modifiers.active ? ", something finished" : ""
                      }${mostly ? `, mostly ${mostly.listName}` : ""}`;
                    },
                  }}
                />
              </DayCardsContext.Provider>
              <HoverCard handle={cardHandle}>
                {({ payload }) => {
                  const rows = payload ? completions.get(payload) : undefined;
                  return payload && rows ? <DayCompletionsCard day={payload} rows={rows} /> : null;
                }}
              </HoverCard>
            </TabsContent>
          </Tabs>

          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate">
              <span className="font-heading text-base font-semibold uppercase tracking-tight">{weekday}</span>{" "}
              <span className="num text-xs text-muted-foreground">{label}</span>
            </h3>
            {day !== today && (
              <Button variant="outline" size="xs" onClick={() => onSelectDay(today)}>
                Today
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Previous day"
              disabled={day <= HISTORY_START_DAY}
              onClick={() => onSelectDay(addDays(day, -1))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Next day"
              disabled={day >= today}
              onClick={() => onSelectDay(addDays(day, 1))}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>

          {beforeHistory ? (
            <p className="text-sm text-muted-foreground">
              History starts {formatDay(HISTORY_START_DAY).label}.
            </p>
          ) : isEmpty ? (
            <p className="text-sm text-muted-foreground">
              {day === today
                ? "Nothing finished or decided on this day yet."
                : "Nothing finished or decided on this day."}
            </p>
          ) : (
            <>
              {section("Done", log.done)}
              {section("Decisions", log.decisions)}
              {section("Added", log.added)}
            </>
          )}

          <Separator />

          <div className="space-y-1.5">
            <Label>Notes</Label>
            {/* Keyed by day: `MarkdownField` reads its value once at mount
                (see markdown-editor.tsx), so stepping to another day must
                remount it or it would keep the first day's text. */}
            <MarkdownField
              key={day}
              value={note?.body ?? ""}
              placeholder="Anything worth remembering about this day"
              ariaLabel={`Notes for ${weekday}, ${label}`}
              className="min-h-[20vh]"
              onCommit={(next) => onSaveNote(day, next)}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
