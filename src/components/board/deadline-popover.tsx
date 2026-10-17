"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  civilDateToLocalDate,
  localDateToCivilDate,
} from "@/components/ui/date-picker-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { QuickDatesGroup } from "@/components/board/date-popover";
import type { CivilDate } from "@/lib/schema";
import { formatShortDate } from "@/lib/scheduling";
import { cn } from "@/lib/utils";

interface DeadlinePopoverProps {
  /** Lands on the trigger `<button>` so the sheet's `<Label htmlFor>` still
   * addresses it. */
  id?: string;
  value: CivilDate | null;
  today: CivilDate;
  onChange: (next: CivilDate | null) => void;
}

/**
 * The Deadline field: the Date control's quick picks above the same calendar,
 * and nothing else. No time and no repeat — a deadline is a day, not a
 * schedule. No `disabled` day either: a deadline in the past is an ordinary
 * thing to record, and the card badges it rather than refusing it.
 *
 * Not `DatePickerField` with a flag: that component is also the repeat
 * dialog's end-date field, which should keep its plain look.
 */
export function DeadlinePopover({ id, value, today, onChange }: DeadlinePopoverProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? civilDateToLocalDate(value) : undefined;

  function commit(next: CivilDate | null) {
    onChange(next);
    setOpen(false);
  }

  return (
    // The clear button is a SIBLING of the trigger: a `<button>` inside a
    // `<button>` is invalid HTML.
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          id={id}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "w-full justify-start border-input font-normal",
            value && "pe-8",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-4 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{value ? formatShortDate(value) : "No deadline"}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <QuickDatesGroup today={today} onPick={commit} />
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => date && commit(localDateToCivilDate(date))}
            className="w-full"
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear date"
          className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
          style={{ insetInlineEnd: "0.25rem" }}
          onClick={() => commit(null)}
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
