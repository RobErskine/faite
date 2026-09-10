"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { Matcher } from "react-day-picker";

import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CivilDate } from "@/lib/schema";
import { formatShortDate, toCivilDate } from "@/lib/scheduling";
import { cn } from "@/lib/utils";

/**
 * The civil-date ↔ local-`Date` bridge, and the only place either direction
 * is written.
 *
 * `react-day-picker` speaks `Date`; every date this app stores is a
 * `CivilDate` string with no instant behind it. The conversion is safe in
 * exactly one form — build a LOCAL midnight and read back the LOCAL Y/M/D —
 * and unsafe in the obvious one: `new Date("2026-08-07")` parses as UTC
 * midnight, which is the previous day everywhere west of Greenwich, and
 * `.toISOString().slice(0, 10)` throws the day back into UTC on the way out.
 * Either alone shifts a date by one for half the planet; together they can
 * cancel and hide the bug until the clocks change.
 *
 * Originally `date-nav.tsx`'s, moved here when a second and third caller
 * appeared (EI-318). `date-nav.tsx` re-exports it so its own callers did not
 * have to move.
 */
export function civilDateToLocalDate(date: CivilDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The inverse. Local parts, never `toISOString` — see above. */
export function localDateToCivilDate(date: Date): CivilDate {
  return toCivilDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

interface DatePickerFieldProps {
  /** Lands on the trigger `<button>`, which `<label htmlFor>` can address —
   * `button` is a labelable element. */
  id?: string;
  value: CivilDate | null;
  /** `null` when the field is cleared. */
  onChange: (next: CivilDate | null) => void;
  placeholder?: string;
  /** Passed through to `react-day-picker`. Undefined allows every day —
   * which is the right default here, unlike the board's "Jump to date":
   * a deadline in the past is an ordinary thing to record. */
  disabled?: Matcher;
  clearable?: boolean;
  /** For a field with no visible `<Label>`. */
  "aria-label"?: string;
  className?: string;
}

/**
 * A date field that looks like an input and opens the board's own calendar.
 *
 * Replaces `<Input type="date">`, whose control is drawn by the OS: the sheet
 * showed one calendar and the board's date navigation showed another, in the
 * same product, on the same screen (EI-318).
 *
 * The plain form. `DatePopover` (`components/board/date-popover.tsx`) is the
 * richer one — typeahead, presets, time and repeat — and composes `Calendar`
 * directly rather than wrapping this, because it shares none of the trigger.
 * This one is for a field that means only "which day": Deadline, and the
 * repeat dialog's end date.
 */
export function DatePickerField({
  id,
  value,
  onChange,
  placeholder = "No date",
  disabled,
  clearable = true,
  "aria-label": ariaLabel,
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? civilDateToLocalDate(value) : undefined;
  const showClear = clearable && value !== null;

  return (
    // `relative`, with the clear button a SIBLING of the trigger rather than
    // a child: a `<button>` inside a `<button>` is invalid HTML, and the
    // inner click would open the popover on its way out.
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          aria-label={ariaLabel}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "w-full justify-start border-input font-normal",
            // Room for the clear button, on the inline end so it mirrors
            // for RTL rather than sitting on the wrong side.
            showClear && "pe-8",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-4 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{value ? formatShortDate(value) : placeholder}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected}
            disabled={disabled}
            onSelect={(date) => {
              if (!date) return;
              onChange(localDateToCivilDate(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear date"
          className="absolute inset-inline-end-1 top-1/2 -translate-y-1/2 text-muted-foreground"
          style={{ insetInlineEnd: "0.25rem" }}
          onClick={() => onChange(null)}
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
