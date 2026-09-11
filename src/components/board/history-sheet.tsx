"use client";

import { useMemo, useState } from "react";
import type { ComponentType } from "react";
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
import { Calendar } from "@/components/ui/calendar";
import { civilDateToLocalDate, localDateToCivilDate } from "@/components/ui/date-picker-field";
import { Label } from "@/components/ui/label";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Separator } from "@/components/ui/separator";
import { edge, effectiveListColor } from "@/lib/colors";
import { activeDays, buildDayLog, type DayLogEntry } from "@/lib/day-log";
import { formatEventTime } from "@/lib/event-time";
import { addDays, formatDay, formatShortDate } from "@/lib/scheduling";
import type { CivilDate, DayNote, List, Tab } from "@/lib/schema";
import { useEventsBetween, useTodosById } from "@/lib/store/hooks";
import { HISTORY_STARTS_AT } from "@/lib/todo-timeline";
import { useExitRetained } from "@/lib/use-exit-retained";
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

/** `YYYY-MM-01` of the month after `month`. */
function nextMonth(month: CivilDate): CivilDate {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
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
  tabsById,
  onSelectDay,
  onClose,
  onSaveNote,
  onOpenTodo,
}: Omit<HistorySheetProps, "day"> & { day: CivilDate; open: boolean }) {
  const { weekday, label } = formatDay(day);

  // The calendar's month follows the day when the day changes (the ‹ / ›
  // buttons, a deep link), and is free to browse otherwise. Adjusted during
  // render with the `lastSeen` pattern, not an effect (`.ai/lessons.md`).
  const [month, setMonth] = useState<CivilDate>(() => monthOf(day));
  const [seenDay, setSeenDay] = useState(day);
  if (day !== seenDay) {
    setSeenDay(day);
    setMonth(monthOf(day));
  }

  // Two indexed range scans on `todoEvents.at`: the month on screen, for the
  // dots, and the day on screen, for the log. See `useEventsBetween`.
  const monthEvents = useEventsBetween(
    zonedInstant(month, "00:00", timezone),
    zonedInstant(nextMonth(month), "00:00", timezone),
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
        {/* No count in the heading: a number of things done is a score,
            and docs/DESIGN.md §4 rules those out. */}
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
          <Calendar
            mode="single"
            required
            className="mx-auto bg-transparent"
            showOutsideDays={false}
            selected={civilDateToLocalDate(day)}
            onSelect={(date) => onSelectDay(localDateToCivilDate(date))}
            month={civilDateToLocalDate(month)}
            onMonthChange={(date) => setMonth(monthOf(localDateToCivilDate(date)))}
            startMonth={civilDateToLocalDate(HISTORY_START_DAY)}
            endMonth={civilDateToLocalDate(today)}
            disabled={{ after: civilDateToLocalDate(today) }}
            modifiers={{ active: dots }}
            modifiersClassNames={{
              // A dot under the number, presence only (no count, no heat).
              // `z-20` puts it above the day button, which is `z-10`.
              active:
                "after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-foreground/60 data-[selected=true]:after:bg-primary-foreground",
            }}
            labels={{
              labelDayButton: (date, modifiers) =>
                `${date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}${
                  modifiers.active ? ", something finished" : ""
                }`,
            }}
          />

          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate">
              <span className="font-heading text-base font-semibold uppercase tracking-tight">{weekday}</span>{" "}
              <span className="num text-xs text-muted-foreground">{label}</span>
            </h3>
            {day !== today && (
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onSelectDay(today)}>
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
            <p className="text-sm text-muted-foreground">Nothing finished or decided on this day.</p>
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
