"use client";

import { ChevronDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Straight from `owner.ts` rather than re-exported through `repositories.ts`:
// that module pulls in Dexie, and this component has no other reason to.
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import { mutateSettings } from "@/lib/store/mutate";
import { VISIBLE_DAY_OPTIONS, type Settings, type TodoStatus } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { SavedViewsSection } from "./saved-views-section";
import { useAssigneesById } from "./assignees-context";
import {
  ASSIGNEE_FILTER_ME,
  setAssigneeFilter,
  useAssigneeFilter,
} from "@/lib/assignee-filter";

/**
 * What the calendar half shows, as controls rather than settings-sheet fields.
 *
 * These sit in the day track's own nav rather than in Settings because they
 * are things you change WHILE looking at the board — "hide what I've
 * finished", "just show me this week" — and a preference you reach for that
 * often stops being a preference. Settings holds the ones you set once.
 *
 * Two triggers (EI-392). "View: …" holds which statuses show, whether
 * weekends get full columns, and saved views; the day count keeps its own,
 * because it is the one you change most and its label is the state. Weekends
 * and Saved views used to be two more peers in the date row — a toggle and a
 * bare bookmark icon — and both are part of what you are viewing.
 *
 * Every write goes straight to the store; `useSettings` in board.tsx re-renders
 * from Dexie. Nothing here holds local state, so two of these open at once (or
 * a change made from ⌘K) can't disagree with the board.
 */

const STATUS_OPTIONS: ReadonlyArray<{ value: TodoStatus; label: string }> = [
  { value: "open", label: "To-do" },
  { value: "done", label: "Completed" },
  { value: "dropped", label: "Marked as won't do" },
];

const ALL_ASSIGNEES = "__all__";

interface ViewSettingsProps {
  /** Raw Dexie row; undefined until the store has read it. */
  settings: Settings | undefined;
}

export function ViewSettings({ settings }: ViewSettingsProps) {
  const statuses = settings?.visibleStatuses ?? ["open"];
  const visibleDays = settings?.visibleDays ?? 7;
  const showWeekends = settings?.showWeekends ?? true;

  const assignees = [...useAssigneesById().values()].sort((a, b) => a.name.localeCompare(b.name));
  const rawAssigneeFilter = useAssigneeFilter();
  // Same guard as `use-board-data.ts`: a filter naming a vanished assignee
  // reads as Everyone rather than as a stale radio.
  const assigneeFilter =
    rawAssigneeFilter === ASSIGNEE_FILTER_ME || assignees.some((a) => a.id === rawAssigneeFilter)
      ? rawAssigneeFilter
      : null;

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
        // is always To-do, Completed, Won't do — the trigger label below reads
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

  const assigneeName =
    assigneeFilter === ASSIGNEE_FILTER_ME
      ? "Me"
      : assignees.find((a) => a.id === assigneeFilter)?.name;

  const dayLabel = `${visibleDays} day${visibleDays === 1 ? "" : "s"}`;

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        {/*
          Both triggers' accessible names START with their visible text
          (WCAG 2.5.3, Label in Name; EI-377). A voice-control user says what
          they see — "click View: To-do" — and a name of only "Which statuses
          to show" gives them nothing to say. The purpose stays on as a suffix
          for screen readers.
        */}
        <DropdownMenuTrigger
          aria-label={`View: ${statusLabel} — which statuses to show, weekends, saved views`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "xs" }),
            "max-w-56 text-muted-foreground",
          )}
        >
          <span className="truncate">
            View: {statusLabel}
            {assigneeName ? ` · ${assigneeName}` : ""}
          </span>
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Show</DropdownMenuLabel>
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
          {assignees.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {/* Only once there is someone to filter by (EI-402). One pick:
                  everyone, my own to-dos, or one assignee's. Device-local —
                  see `lib/assignee-filter.ts`. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Who</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={assigneeFilter ?? ALL_ASSIGNEES}
                  onValueChange={(value) =>
                    setAssigneeFilter(value === ALL_ASSIGNEES ? null : value)
                  }
                >
                  <DropdownMenuRadioItem value={ALL_ASSIGNEES}>Everyone</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value={ASSIGNEE_FILTER_ME}>Me</DropdownMenuRadioItem>
                  {assignees.map((assignee) => (
                    <DropdownMenuRadioItem key={assignee.id} value={assignee.id}>
                      {assignee.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          {/*
            Checked means weekends get full columns; off collapses each
            weekend into a strip. Same words as ⌘K's "Show weekends" /
            "Hide weekends" (command-registry.ts) — one wording for one
            setting. Stays open on click, like the statuses above.
          */}
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={showWeekends}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                void mutateSettings(LOCAL_OWNER_ID, { showWeekends: checked })
              }
            >
              Show weekends
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <SavedViewsSection settings={settings} />
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${dayLabel} — how many day columns to show`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "xs" }),
            "text-muted-foreground",
          )}
        >
          {/* `nums` keeps the body font while switching to tabular figures, so
              the trigger's width does not jitter between 3, 5 and 7. */}
          <span className="nums">{dayLabel}</span>
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
    </div>
  );
}
