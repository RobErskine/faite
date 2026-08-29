"use client";

import { CalendarOff, CalendarRange, ChevronDown } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Straight from `owner.ts` rather than re-exported through `repositories.ts`:
// that module pulls in Dexie, and this component has no other reason to.
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import { mutateSettings } from "@/lib/store/mutate";
import { VISIBLE_DAY_OPTIONS, type Settings, type TodoStatus } from "@/lib/schema";
import { cn } from "@/lib/utils";

/**
 * What the calendar half shows, as controls rather than settings-sheet fields.
 *
 * These three sit in the day track's own nav rather than in Settings because
 * they are things you change WHILE looking at the board — "hide what I've
 * finished", "just show me this week" — and a preference you reach for that
 * often stops being a preference. Settings holds the ones you set once.
 *
 * Every write goes straight to the store; `useSettings` in board.tsx re-renders
 * from Dexie. Nothing here holds local state, so two of these open at once (or
 * a change made from ⌘K) can't disagree with the board.
 */

const STATUS_OPTIONS: ReadonlyArray<{ value: TodoStatus; label: string }> = [
  { value: "open", label: "Todo" },
  { value: "done", label: "Completed" },
  { value: "dropped", label: "Marked as won't do" },
];

interface ViewSettingsProps {
  /** Raw Dexie row; undefined until the store has read it. */
  settings: Settings | undefined;
}

export function ViewSettings({ settings }: ViewSettingsProps) {
  const statuses = settings?.visibleStatuses ?? ["open"];
  const visibleDays = settings?.visibleDays ?? 7;
  const showWeekends = settings?.showWeekends ?? true;

  const toggleStatus = (value: TodoStatus, next: boolean) => {
    /*
      Unchecking the LAST status is refused rather than allowed.

      An empty board is a legal state that looks exactly like a broken one:
      every column empty, no error, and the cause three clicks away in a menu
      that has since closed. Refusing costs one line; an empty-state explaining
      it would cost a component.
    */
    if (!next && statuses.length <= 1) return;
    const nextStatuses = next
      ? // Rebuilt from STATUS_OPTIONS rather than appended, so the stored order
        // is always Todo, Completed, Won't do — the trigger label below reads
        // off it, and an append would make the label depend on click order.
        STATUS_OPTIONS.filter((o) => o.value === value || statuses.includes(o.value)).map(
          (o) => o.value,
        )
      : statuses.filter((s) => s !== value);
    void mutateSettings(LOCAL_OWNER_ID, { visibleStatuses: nextStatuses });
  };

  const statusLabel =
    statuses.length === STATUS_OPTIONS.length
      ? "All"
      : STATUS_OPTIONS.filter((o) => statuses.includes(o.value))
          .map((o) => o.label)
          .join(", ") || "None";

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Which statuses to show"
          className={cn(
            buttonVariants({ variant: "ghost", size: "xs" }),
            "max-w-56 text-muted-foreground",
          )}
        >
          <span className="truncate">View: {statusLabel}</span>
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-52">
          <DropdownMenuGroup>
            {STATUS_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={statuses.includes(option.value)}
                // The menu stays open: these three read as one multi-select,
                // and reopening it twice to see two statuses is the kind of
                // friction that makes people stop using a filter.
                closeOnClick={false}
                onCheckedChange={(checked) => toggleStatus(option.value, checked)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="How many day columns to show"
          className={cn(
            buttonVariants({ variant: "ghost", size: "xs" }),
            "text-muted-foreground",
          )}
        >
          {/* `nums` keeps the body font while switching to tabular figures, so
              the trigger's width does not jitter between 3, 5 and 7. */}
          <span className="nums">
            {visibleDays} day{visibleDays === 1 ? "" : "s"}
          </span>
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-40">
          <DropdownMenuRadioGroup
            value={String(visibleDays)}
            onValueChange={(value) =>
              void mutateSettings(LOCAL_OWNER_ID, { visibleDays: Number(value) })
            }
          >
            {VISIBLE_DAY_OPTIONS.map((days) => (
              <DropdownMenuRadioItem key={days} value={String(days)} className="nums">
                {days} day{days === 1 ? "" : "s"}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        Labelled with the STATE, not the action — "Hide weekends" next to two
        dropdowns that both report what you are looking at read as a claim
        about the board rather than a button, and there is no way to tell at a
        glance whether you are seeing the weekend or about to stop.

        So: "Weekends" (calendar intact) when they are there, "Weekends hidden"
        (calendar struck through) when they are not. Icon and label say the
        same thing twice on purpose; the icon is what carries at a glance.

        `CalendarRange` rather than `CalendarDays`, which would be the more
        literal week glyph: the date picker at the other end of this same bar
        already uses `CalendarDays`, and two identical icons a few hundred
        pixels apart doing unrelated things is worse than a slightly less
        literal one. The range bar also reads as "a span of days", which is
        what the strip covers.
      */}
      <Button
        variant="ghost"
        size="xs"
        aria-pressed={!showWeekends}
        className={cn(!showWeekends ? "bg-muted" : "text-muted-foreground")}
        onClick={() =>
          void mutateSettings(LOCAL_OWNER_ID, { showWeekends: !showWeekends })
        }
      >
        {showWeekends ? <CalendarRange aria-hidden /> : <CalendarOff aria-hidden />}
        {showWeekends ? "Weekends" : "Weekends hidden"}
      </Button>
    </div>
  );
}
