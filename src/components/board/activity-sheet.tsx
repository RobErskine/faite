"use client";

import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  Archive,
  ArrowRightLeft,
  Calendar,
  CalendarOff,
  Check,
  ChevronDown,
  CornerDownRight,
  Pencil,
  Plus,
  RotateCcw,
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HiddenByFilterNotice, TimelineList, TimelineRow } from "./timeline";
import { edge, effectiveListColor } from "@/lib/colors";
import { formatEventTime } from "@/lib/event-time";
import { formatShortDate, type PlacementContext } from "@/lib/scheduling";
import {
  buildGlobalTimeline,
  type GlobalTimelineEvent,
  type GlobalTimelineItem,
} from "@/lib/global-timeline";
import { dailyRollSummaries } from "@/lib/rollover-events";
import { useGlobalEvents, useTodoTitles } from "@/lib/store/hooks";
import { mutateSettings } from "@/lib/store/mutate";
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import type { ActivityEventKind, CivilDate, List, Settings, Tab, Todo } from "@/lib/schema";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
/**
 * Hard ceiling on how much of the log this feed will ever load. Past this
 * the feed shows a "not shown" marker rather than growing the query
 * indefinitely — a CAP, deliberately not a PRUNE, because nothing else in
 * this codebase prunes `todoEvents` either, and this feature isn't the place
 * to start:
 * - Server-side pruning would race the `since=0` catch-up path
 *   (`sql-limits.ts`'s doc comment) — the largest, least recoverable pull
 *   there is.
 * - Client-side hard delete writes no outbox entry, so the rows would simply
 *   reappear on the next full pull.
 * - Client-side soft delete would reuse `deletedAt`, which has exactly one
 *   sanctioned writer — undo tombstoning (`schema.ts`'s `todoEventSchema`
 *   doc comment) — and syncing that flag to every device would make the
 *   prune permanent everywhere at once.
 *
 * The real ceiling this doesn't solve is the DO's SQLite, which has no
 * compaction — a server-side archival sweep is a separate follow-up that
 * needs a wire-level "truncated before T" signal, not a bare `DELETE`.
 */
const MAX_SHOWN = 20 * PAGE_SIZE;

const ACTIVITY_EVENT_LABEL: Record<ActivityEventKind, string> = {
  created: "Created",
  scheduled: "Scheduled",
  unscheduled: "Unscheduled",
  moved: "Moved",
  done: "Completed",
  dropped: "Won't do",
  reopened: "Reopened",
  edited: "Edited",
  deleted: "Deleted",
  rolledOver: "Rolled over",
  overflowed: "Fell into Overflow",
};

const ACTIVITY_EVENT_ICON: Record<ActivityEventKind, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  created: Plus,
  scheduled: Calendar,
  unscheduled: CalendarOff,
  moved: ArrowRightLeft,
  done: Check,
  dropped: X,
  reopened: RotateCcw,
  edited: Pencil,
  deleted: Trash2,
  rolledOver: CornerDownRight,
  overflowed: Archive,
};

/** A `kind` outside this vocabulary (a newer build's event, read on an older
 * cached bundle) falls back to a neutral "Updated" row rather than
 * throwing — same contract as `todo-sheet.tsx`'s `HISTORY_EVENT_LABEL`. */
const FALLBACK_LABEL = "Updated";
const FALLBACK_ICON = Pencil;

/** Field names -> the label they read as in an `edited` row's detail line —
 * a local copy of `todo-sheet.tsx`'s `FIELD_LABELS`, not shared: each sheet
 * keeps its own event vocabulary local (`timeline.tsx`'s header comment). */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Notes",
  priority: "Priority",
  deadline: "Deadline",
  reminderTime: "Reminder",
  scheduledDate: "Date",
  listId: "List",
  projectId: "Project",
  location: "Location",
  placeId: "Place",
  recurrenceRule: "Repeat rule",
};

const ACTIVITY_KIND_FILTER_OPTIONS: ReadonlyArray<{ value: ActivityEventKind; label: string }> =
  (Object.keys(ACTIVITY_EVENT_LABEL) as ActivityEventKind[]).map((value) => ({
    value,
    label: ACTIVITY_EVENT_LABEL[value],
  }));
const ALL_ACTIVITY_KINDS: ActivityEventKind[] = ACTIVITY_KIND_FILTER_OPTIONS.map((o) => o.value);

function activityDetail(event: GlobalTimelineEvent): string | null {
  if (event.kind === "moved") {
    const payload = event.payload as { toListName?: string | null } | null;
    return `→ ${payload?.toListName ?? "Backlog"}`;
  }
  if (event.kind === "scheduled") {
    const payload = event.payload as { to?: CivilDate | null } | null;
    return payload?.to ? `→ ${formatShortDate(payload.to)}` : null;
  }
  if (event.kind === "edited") {
    const fields = event.fields ?? [];
    if (fields.length === 0) return null;
    return fields.map((field) => FIELD_LABELS[field] ?? field).join(", ");
  }
  return null;
}

/** Same rule as `todo-sheet.tsx`'s `historyAccent`: the list FROM THE
 * PAYLOAD, not the todo's current list, so a `moved` row's dot says what
 * actually happened rather than repeating wherever the todo sits now. */
function activityAccent(
  event: GlobalTimelineEvent,
  listsById: ReadonlyMap<string, List>,
  tabsById: ReadonlyMap<string, Tab>,
): string | undefined {
  if (event.kind !== "moved") return undefined;
  const payload = event.payload as { toListId?: string | null } | null;
  const list = payload?.toListId ? listsById.get(payload.toListId) : undefined;
  return edge(effectiveListColor(list, tabsById));
}

interface ActivitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `data.nonTemplateTodos` — same reasoning as the day sheet's Timeline:
   * a feed of what actually happened has nothing to say about a virtual
   * recurrence occurrence or a template. */
  todos: Todo[];
  ctx: PlacementContext;
  timezone: string;
  settings: Settings | undefined;
  listsById: ReadonlyMap<string, List>;
  tabsById: ReadonlyMap<string, Tab>;
  onOpenTodo: (todoId: string) => void;
}

/**
 * The whole-app activity feed (todos-only v1) — everything logged in
 * `todoEvent` across every todo, newest first, plus the Faite Loop's rolls
 * aggregated per day. See `lib/global-timeline.ts` for the assembly and its
 * documented limits (no list/tab events yet; rollup rows answer "what is
 * rolling," not "what rolled").
 *
 * Plain-text rows, never `TodoCard` — unlike `DaySheet`, so this sheet is
 * safe to mount INSIDE the board's `DndContext` (see `board.tsx`'s doc
 * comment on why `DaySheet` cannot be).
 */
export function ActivitySheet({
  open,
  onOpenChange,
  todos,
  ctx,
  timezone,
  settings,
  listsById,
  tabsById,
  onOpenTodo,
}: ActivitySheetProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const atCap = shown >= MAX_SHOWN;
  const events = useGlobalEvents(Math.min(shown, MAX_SHOWN));
  const titles = useTodoTitles();

  const rollups = useMemo(
    () => dailyRollSummaries(todos, ctx, timezone),
    [todos, ctx, timezone],
  );

  const items = useMemo(
    () => buildGlobalTimeline(events, rollups, titles, timezone, ctx.today, { atCap }),
    [events, rollups, titles, timezone, ctx.today, atCap],
  );

  const visibleKinds = settings?.visibleActivityKinds ?? ALL_ACTIVITY_KINDS;
  const visibleItems = useMemo(() => {
    const kept = items.filter((item) => {
      if (item.type === "event") {
        // A kind outside the known vocabulary (a newer build's event, read
        // on an older cached bundle) is never filterable — it fails OPEN,
        // always rendering as the "Updated" fallback row, rather than being
        // silently hidden because it can't match any checkbox in the menu.
        if (!ALL_ACTIVITY_KINDS.includes(item.event.kind as ActivityEventKind)) return true;
        return visibleKinds.includes(item.event.kind as ActivityEventKind);
      }
      if (item.type === "rollup") return visibleKinds.includes(item.kind);
      return true;
    });
    // A day-header survives the filter above unconditionally (it isn't a
    // kind itself), which can orphan one when every event/rollup under it
    // got filtered out — drop any header not followed by real content
    // before the next header (or the end of the feed).
    return kept.filter((item, index) => {
      if (item.type !== "day-header") return true;
      return kept.slice(index + 1).some((next) => {
        if (next.type === "day-header") return false;
        return next.type === "event" || next.type === "rollup";
      });
    });
  }, [items, visibleKinds]);
  const contentCount = (list: GlobalTimelineItem[]) =>
    list.filter((i) => i.type === "event" || i.type === "rollup").length;
  const hiddenCount = contentCount(items) - contentCount(visibleItems);

  const toggleKind = (value: ActivityEventKind, next: boolean) => {
    // Unchecking the last kind is allowed, same reasoning as the day
    // sheet's filter — `HiddenByFilterNotice` is the empty state that
    // guarding against it would exist only to avoid building.
    const nextKinds = next
      ? ACTIVITY_KIND_FILTER_OPTIONS.filter((o) => o.value === value || visibleKinds.includes(o.value)).map(
          (o) => o.value,
        )
      : visibleKinds.filter((k) => k !== value);
    void mutateSettings(LOCAL_OWNER_ID, { visibleActivityKinds: nextKinds });
  };

  const showAllKinds = () => void mutateSettings(LOCAL_OWNER_ID, { visibleActivityKinds: ALL_ACTIVITY_KINDS });

  const renderableItems = visibleItems.filter((i) => i.type !== "marker" || i.key !== "truncated");
  const lastRenderableKey = keyOf(renderableItems.at(-1));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        `data-[side=right]:` on the width utilities, not plain `sm:` ones: the
        base `SheetContent` already sets `data-[side=right]:w-3/4` and
        `data-[side=right]:sm:max-w-sm`, both gated on the same attribute
        selector. A plain class loses that specificity fight and silently
        does nothing — matching the modifier is what makes the override win.
      */}
      <SheetContent className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]">
        <SheetHeader className="pr-10">
          <SheetTitle className="font-heading uppercase tracking-tight">Activity</SheetTitle>
          <SheetDescription className="text-xs">Everything that&apos;s happened, newest first.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <div className="flex items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Which activity to show"
                className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "text-muted-foreground")}
              >
                Filter
                <ChevronDown aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  {ACTIVITY_KIND_FILTER_OPTIONS.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.value}
                      checked={visibleKinds.includes(option.value)}
                      closeOnClick={false}
                      onCheckedChange={(checked) => toggleKind(option.value, checked)}
                    >
                      {option.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {items.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing&apos;s happened yet.</p>
          ) : visibleItems.every((i) => i.type === "marker") ? (
            <HiddenByFilterNotice count={hiddenCount} onShowAll={showAllKinds} />
          ) : (
            <>
              <TimelineList ariaLabel="Activity">
                {visibleItems.map((item) => {
                  if (item.type === "day-header") {
                    return (
                      <li
                        key={item.key}
                        // `-mx-4` cancels the sheet body's own `px-4`
                        // (activity-sheet.tsx's scroll container below), so
                        // the background paints edge-to-edge instead of
                        // stopping at the timeline column like every other
                        // row's content does. `pl-11` puts the TEXT back
                        // where it would have sat without the cancellation —
                        // 16px (the padding just removed) + 28px (`pl-7`,
                        // every `TimelineRow`'s own left inset) — so the
                        // label still lines up with the rows above and below
                        // it; only the background bleeds wider.
                        className="relative -mx-4 bg-muted/60 py-1.5 pr-4 pl-11 text-2xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {/*
                          Keeps the rail unbroken through the header — without
                          this, the line stops at the row above and resumes at
                          the row below, reading as two separate timelines
                          rather than one continuous one. `left-[25.5px]` is
                          `TimelineRow`'s own rail position (`left-[9.5px]`,
                          centered under its size-5 dot) PLUS the 16px `-mx-4`
                          just added back above — the rail has to account for
                          the same shift the text's `pl-11` does, or it drifts
                          out of alignment with the rows on either side of this
                          header for exactly the width of the header. Same
                          `-0.75rem` bottom overshoot as `TimelineRow`'s own
                          rail, to bridge the `space-y-3` gap to what follows.
                        */}
                        <span aria-hidden className="absolute left-[25.5px] top-0 bottom-[-0.75rem] w-px bg-border" />
                        {item.label}
                      </li>
                    );
                  }
                  if (item.type === "marker") {
                    return (
                      <li key={item.key} className="pl-7 text-2xs text-muted-foreground">
                        Older activity isn&apos;t shown
                      </li>
                    );
                  }
                  const isLast = keyOf(item) === lastRenderableKey;
                  if (item.type === "rollup") {
                    return (
                      <RollupRow
                        key={item.key}
                        rollup={item}
                        timezone={timezone}
                        isLast={isLast}
                        listsById={listsById}
                        onOpenTodo={onOpenTodo}
                      />
                    );
                  }
                  const { event } = item;
                  const Icon =
                    ACTIVITY_EVENT_ICON[event.kind as ActivityEventKind] ?? FALLBACK_ICON;
                  const label = ACTIVITY_EVENT_LABEL[event.kind as ActivityEventKind] ?? FALLBACK_LABEL;
                  const detail = activityDetail(event);
                  return (
                    <TimelineRow
                      key={event.key}
                      icon={Icon}
                      label={label}
                      at={event.at}
                      when={formatEventTime(event.at, timezone)}
                      accent={activityAccent(event, listsById, tabsById)}
                      isLast={isLast}
                    >
                      <p className="mt-0.5 text-sm">
                        {event.deleted ? (
                          <span className="text-muted-foreground line-through">{event.title}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-left hover:underline"
                            onClick={() => onOpenTodo(event.todoId)}
                          >
                            {event.title}
                          </button>
                        )}
                      </p>
                      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                    </TimelineRow>
                  );
                })}
              </TimelineList>
              {hiddenCount > 0 && <HiddenByFilterNotice count={hiddenCount} onShowAll={showAllKinds} />}
            </>
          )}

          {!atCap && events.length === shown && events.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setShown((s) => Math.min(MAX_SHOWN, s + PAGE_SIZE))}
            >
              Load {PAGE_SIZE} more
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function keyOf(item: GlobalTimelineItem | undefined): string | undefined {
  if (!item) return undefined;
  if (item.type === "event") return item.event.key;
  if (item.type === "rollup") return item.key;
  if (item.type === "day-header") return item.key;
  return item.key;
}

type RollupItem = Extract<GlobalTimelineItem, { type: "rollup" }>;

function RollupRow({
  rollup,
  timezone,
  isLast,
  listsById,
  onOpenTodo,
}: {
  rollup: RollupItem;
  timezone: string;
  isLast: boolean;
  listsById: ReadonlyMap<string, List>;
  onOpenTodo: (todoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = rollup.todos.length;
  const Icon = rollup.kind === "rolledOver" ? CornerDownRight : Archive;
  const label = rollup.kind === "rolledOver" ? "Rolled over" : "Fell into Overflow";
  // Stable, predictable order — `DailyRollSummary.todos` is documented
  // unordered at the data layer, so sort here rather than push that
  // decision down into `dailyRollSummaries`, which has other consumers.
  const sorted = [...rollup.todos].sort((a, b) => a.todo.title.localeCompare(b.todo.title));

  return (
    <TimelineRow
      icon={Icon}
      label={label}
      at={rollup.at}
      when={formatEventTime(rollup.at, timezone)}
      accent={undefined}
      isLast={isLast}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown aria-hidden className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        {count} {count === 1 ? "to-do" : "to-dos"}
      </button>
      {open && (
        // A grid, not a `<table>` — this codebase has none anywhere in
        // `src/` (every tabular layout, incl. `todo-sheet.tsx`'s field
        // rows, is `grid grid-cols-N`), so this matches house style rather
        // than introducing table semantics for one row type. ARIA table
        // roles still need `row`/`cell` under `table`, not `columnheader`
        // cells floating loose — `className="contents"` on each row wrapper
        // keeps it out of the CSS grid's own layout (its children become the
        // direct grid items, so column tracks still line up) while giving it
        // a real DOM node for the `row` role to attach to.
        <div
          className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-1 pl-4 text-xs"
          role="table"
          aria-label={`${label} to-dos`}
        >
          <div role="row" className="contents">
            <span className="font-medium text-muted-foreground" role="columnheader">
              Task
            </span>
            <span className="font-medium text-muted-foreground" role="columnheader">
              List
            </span>
            <span className="text-right font-medium text-muted-foreground" role="columnheader">
              Days
            </span>
          </div>
          {sorted.map(({ todo, rolls }) => {
            const list = todo.listId ? listsById.get(todo.listId) : undefined;
            return (
              <div key={todo.id} role="row" className="contents">
                {/* `role="cell"` goes on this wrapper, not the button —
                    overriding a `<button>`'s own implicit role to "cell"
                    would drop its "button" exposure to assistive tech.
                    `contents` keeps the wrapper out of the grid's own
                    layout, so the button itself is still the actual grid
                    item lining up under the "Task" column. */}
                <div role="cell" className="contents">
                  <button
                    type="button"
                    className="truncate text-left text-foreground hover:underline"
                    onClick={() => onOpenTodo(todo.id)}
                  >
                    {todo.title}
                  </button>
                </div>
                <span role="cell" className="truncate text-muted-foreground">
                  {list?.name ?? "Backlog"}
                </span>
                <span role="cell" className="num text-right text-muted-foreground">
                  {rolls}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </TimelineRow>
  );
}
