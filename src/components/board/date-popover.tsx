"use client";

import { useState } from "react";
import { ArrowLeft, CalendarDays, Clock, Repeat, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  civilDateToLocalDate,
  localDateToCivilDate,
} from "@/components/ui/date-picker-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReminderPicker } from "@/components/board/reminder-picker";
import type { RecurrenceInfo } from "@/components/board/repeat-section";
import { parseDatePhrase } from "@/lib/quick-add";
import { DATE_POPOVER_KINDS, quickRescheduleDate } from "@/lib/quick-reschedule";
import { formatReminderTime } from "@/lib/reminder-presets";
import { summarizeSchedule } from "@/lib/recurrence";
import type { CivilDate, ReminderPreset, Todo } from "@/lib/schema";
import { daysBetween, formatDay, formatShortDate } from "@/lib/scheduling";
import { cn } from "@/lib/utils";

/**
 * Prose for a preset row's trailing edge: the weekday inside the coming week,
 * the short date beyond it.
 *
 * "Next week — Mon" is ambiguous the moment it is more than seven days out,
 * and "Tomorrow — Sep 11" spends a whole date saying what the label already
 * said. Seven days is where the weekday stops being enough on its own.
 */
function whenHint(date: CivilDate, today: CivilDate): string {
  return daysBetween(today, date) < 7 ? formatDay(date).weekday : formatShortDate(date);
}

interface DatePopoverProps {
  /** Lands on the trigger `<button>` so the sheet's `<Label htmlFor>` still
   * addresses it — `button` is a labelable element. */
  id?: string;
  todo: Todo;
  presets: ReminderPreset[];
  /** Null when this to-do is not part of a series. */
  recurrence: RecurrenceInfo | null;
  today: CivilDate;
  onSave: (id: string, patch: Partial<Todo>) => void;
  /** Opens the sheet's one `RepeatDialog` — to start a series or to change
   * the rule, whichever applies. Absent disables the Repeat button. */
  onOpenRepeat?: () => void;
}

/**
 * One control for *when*, replacing three fields that described one idea.
 *
 * Date, Reminder and Repeat used to be three sibling fields in the sheet, and
 * two of them silently disagreed: an occurrence's date could be moved while
 * every series action still anchored to the slot it was born in (EI-318 §0,
 * fixed in `occurrenceAnchor`). Three fields also let the sheet claim a
 * to-do was on Sep 14 while the repeat block underneath said it happened
 * every Monday. Folding time and repeat into the date control is what makes
 * that contradiction unsayable.
 *
 * Four ways in, deliberately, because people reach for different ones:
 * type it, pick a named day, pick a square on a month, or hand the schedule
 * over to a rule.
 *
 * ## What it does NOT own
 *
 * `RepeatDialog` stays in `todo-sheet.tsx` as a sibling of the sheet content,
 * and this component only asks for it via `onOpenRepeat`. A dialog rendered
 * inside a popover inside a sheet is three stacked focus traps, and the
 * middle one closing takes the top one with it. Reminder is different — a
 * combobox is a popup, not a trap — so `ReminderPicker` does render here, in
 * a second panel rather than a nested popup.
 *
 * ## Escape
 *
 * Three layers can be open at once: the reminder combobox, this popover, the
 * sheet. One Escape must close exactly one, innermost first. That works
 * because `ReminderPicker` keeps `ComboboxEmpty` mounted at all times
 * (`docs/PICKERS.md` §2) — without it the combobox declines the key and the
 * sheet, three levels up, takes it instead. `date-popover.test.tsx` presses
 * Escape once per layer, in order, because the failure is silent.
 */
export function DatePopover({
  id,
  todo,
  presets,
  recurrence,
  today,
  onSave,
  onOpenRepeat,
}: DatePopoverProps) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"date" | "time">("date");
  const [query, setQuery] = useState("");

  const value = todo.scheduledDate;
  const typed = parseDatePhrase(query, today);
  const selected = value ? civilDateToLocalDate(value) : undefined;

  function close() {
    setOpen(false);
    setQuery("");
    setPanel("date");
  }

  function commit(next: CivilDate) {
    onSave(todo.id, { scheduledDate: next });
    close();
  }

  function clear() {
    // Clearing the date orphans any reminder — it resolves against
    // `scheduledDate` (lib/reminders.ts) and would otherwise silently
    // resurrect the moment a date is set again.
    onSave(todo.id, { scheduledDate: null, reminderTime: null });
    close();
  }

  // The date first, because that is what the field is for; the time beside it
  // because a reminder with no date cannot exist. The rule is NOT spelled out
  // here — at this width it would truncate to nothing, and the repeat summary
  // sits directly below the field saying it in full. The icon is the cue.
  const label = value
    ? todo.reminderTime
      ? `${formatShortDate(value)} · ${formatReminderTime(todo.reminderTime)}`
      : formatShortDate(value)
    : recurrence
      ? summarizeSchedule(recurrence.rule, recurrence.seriesStart)
      : "No date";

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <div className="relative">
        <PopoverTrigger
          id={id}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "w-full justify-start border-input font-normal",
            value && "pe-8",
            !value && !recurrence && "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-4 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{label}</span>
          {recurrence && (
            <Repeat
              className="size-3.5 shrink-0 opacity-60"
              aria-label="Repeats"
              role="img"
            />
          )}
        </PopoverTrigger>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clear date"
            className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
            style={{ insetInlineEnd: "0.25rem" }}
            onClick={clear}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>

      <PopoverContent align="start" className="w-72 p-0">
        {panel === "time" ? (
          <div className="space-y-2 p-3">
            <button
              type="button"
              onClick={() => setPanel("date")}
              className="focus-ring flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" aria-hidden />
              Back to date
            </button>
            <ReminderPicker todo={todo} presets={presets} onSave={onSave} />
          </div>
        ) : (
          <>
            <div className="border-b p-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typed) {
                    e.preventDefault();
                    commit(typed);
                  }
                }}
                placeholder="Type a date…"
                aria-label="Type a date"
                className="focus-ring h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            {/* The parsed suggestion, above the presets rather than replacing
                them: typing narrows nothing here, so hiding the named rows
                would only cost the user their way back. */}
            {query.trim() !== "" && (
              <div className="border-b p-1">
                {typed ? (
                  <PresetRow
                    label={formatShortDate(typed)}
                    hint={whenHint(typed, today)}
                    onClick={() => commit(typed)}
                  />
                ) : (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">
                    Not a date we recognize.
                  </p>
                )}
              </div>
            )}

            {/* A named group, so the four rows are reachable as a set — by a
                screen reader, and by a test that would otherwise have to tell
                "Today" apart from the calendar's own today cell. */}
            <div role="group" aria-label="Quick dates" className="border-b p-1">
              {DATE_POPOVER_KINDS.map((kind) => {
                const date = quickRescheduleDate(kind, today);
                return (
                  <PresetRow
                    key={kind}
                    label={PRESET_LABELS[kind]}
                    hint={whenHint(date, today)}
                    onClick={() => commit(date)}
                  />
                );
              })}
            </div>

            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => date && commit(localDateToCivilDate(date))}
              className="w-full"
            />

            <div className="grid grid-cols-2 gap-2 border-t p-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!value}
                onClick={() => setPanel("time")}
              >
                <Clock className="size-3.5" aria-hidden />
                Time
              </Button>
              <Button
                variant="outline"
                size="sm"
                // A series needs a day to anchor to — `createSeriesFromTodo`
                // throws without one, and there is nothing sensible to repeat
                // from anyway.
                disabled={!value || !onOpenRepeat}
                onClick={() => {
                  close();
                  onOpenRepeat?.();
                }}
              >
                <Repeat className="size-3.5" aria-hidden />
                Repeat
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Labels for the four rows, keyed off the shared vocabulary so they cannot
 * drift from the card menu's wording. */
const PRESET_LABELS: Record<(typeof DATE_POPOVER_KINDS)[number], string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  thisWeekend: "This weekend",
  nextWeek: "Next week",
};

function PresetRow({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
