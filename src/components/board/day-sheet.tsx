"use client";

import { useMemo } from "react";
import { Archive, ArrowRight, Check, ChevronDown, CornerDownRight, Plus, X } from "lucide-react";
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
import { MarkdownField } from "@/components/ui/markdown-field";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { edge, wash } from "@/lib/colors";
import {
  buildDayTimeline,
  formatEventWhen,
  type DayEvent,
  type DayEventKind,
} from "@/lib/day-timeline";
import { formatDay, type PlacementContext } from "@/lib/scheduling";
import { mutateSettings } from "@/lib/store/mutate";
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import type {
  CivilDate,
  DayNote,
  Label as LabelRecord,
  List,
  ReminderPreset,
  Settings,
  Todo,
} from "@/lib/schema";
import { cn } from "@/lib/utils";
import { TimelineList, TimelineRow } from "./timeline";
import { TodoCard } from "./todo-card";

/**
 * One day's details: its notes, and what happened on it.
 *
 * A Sheet rather than a Dialog, matching `TodoSheet` — a day's detail is a side
 * task next to the board, and keeping the board visible is the point.
 *
 * MOUNT THIS OUTSIDE THE BOARD'S DndContext. The timeline renders real
 * `TodoCard`s, and `TodoCard` calls `useSortable` unconditionally; inside the
 * context those calls would re-register draggable and droppable entries under
 * ids the board already owns, replacing the real cards' entries in dnd-kit's
 * maps for as long as this sheet is open. Outside it the hooks fall through to
 * dnd-kit's default contexts (no-op dispatch, empty items) and render an inert
 * row. Base UI portals the popup to <body> either way, so nothing about the
 * visual result depends on tree position.
 */

interface DaySheetProps {
  /** The day whose details are open. Null closes the sheet. */
  day: CivilDate | null;
  /** Raw Dexie row; undefined until the store has read it. */
  settings: Settings | undefined;
  note: DayNote | undefined;
  /** Every live to-do — the timeline is derived here, not upstream. */
  todos: Todo[];
  timezone: string;
  labels: LabelRecord[];
  /** Named reminder times (EI-106 P5) — see `TodoMetaBadges`. */
  reminderPresets?: ReminderPreset[];
  /** Live AND archived lists, so a filed list still colours its cards. */
  listsById: ReadonlyMap<string, List>;
  /** Fallback for a todo with no list, mirroring `groupTodosByList`. */
  backlog: List | undefined;
  ctx: PlacementContext;
  onClose: () => void;
  onSaveNote: (day: CivilDate, body: string) => void;
  onToggleTodo: (todo: Todo) => void;
  onOpenTodo: (todo: Todo) => void;
}

const EVENT_LABEL: Record<DayEventKind, string> = {
  created: "Created",
  scheduled: "Assigned here",
  done: "Completed",
  dropped: "Won't do",
  rolledOver: "Rolled over",
  overflowed: "Fell into Overflow",
};

const EVENT_ICON: Record<DayEventKind, typeof Plus> = {
  created: Plus,
  scheduled: ArrowRight,
  done: Check,
  dropped: X,
  rolledOver: CornerDownRight,
  overflowed: Archive,
};

/**
 * Filter-menu labels, kept separate from `EVENT_LABEL` above rather than
 * reused: `scheduled` reads "Assigned here" on a timeline row, where "here"
 * refers to the day the sheet is open on. A dropdown item has no such
 * referent, so it reads "Assigned" instead.
 */
const KIND_FILTER_OPTIONS: ReadonlyArray<{ value: DayEventKind; label: string }> = [
  { value: "created", label: "Created" },
  { value: "scheduled", label: "Assigned" },
  { value: "done", label: "Completed" },
  { value: "dropped", label: "Won't do" },
  { value: "rolledOver", label: "Rolled over" },
  { value: "overflowed", label: "Fell into Overflow" },
];

const ALL_EVENT_KINDS: DayEventKind[] = KIND_FILTER_OPTIONS.map((o) => o.value);

export function DaySheet({ day, ...rest }: DaySheetProps) {
  if (!day) return null;
  // Keyed remount re-seeds the note draft for each day. `MarkdownField` reads
  // its value once at mount by design (see markdown-editor.tsx), so without the
  // key, opening a second day would show the first day's notes.
  return <DaySheetContent key={day} day={day} {...rest} />;
}

function DaySheetContent({
  day,
  settings,
  note,
  todos,
  timezone,
  labels,
  reminderPresets,
  listsById,
  backlog,
  ctx,
  onClose,
  onSaveNote,
  onToggleTodo,
  onOpenTodo,
}: DaySheetProps & { day: CivilDate }) {
  const { weekday, label } = formatDay(day);
  const events = useMemo(
    () => buildDayTimeline(todos, day, timezone, ctx),
    [todos, day, timezone, ctx],
  );

  const visibleKinds = settings?.visibleEventKinds ?? ALL_EVENT_KINDS;
  const visibleEvents = useMemo(
    () => events.filter((event) => visibleKinds.includes(event.kind)),
    [events, visibleKinds],
  );
  const hiddenCount = events.length - visibleEvents.length;

  const toggleEventKind = (value: DayEventKind, next: boolean) => {
    // Unlike `ViewSettings`' status filter, unchecking the last kind is
    // allowed — see `HiddenByFilterNotice` below, which is the empty state
    // that guard exists to avoid building.
    const nextKinds = next
      ? KIND_FILTER_OPTIONS.filter(
          (o) => o.value === value || visibleKinds.includes(o.value),
        ).map((o) => o.value)
      : visibleKinds.filter((k) => k !== value);
    void mutateSettings(LOCAL_OWNER_ID, { visibleEventKinds: nextKinds });
  };

  const showAllKinds = () =>
    void mutateSettings(LOCAL_OWNER_ID, { visibleEventKinds: ALL_EVENT_KINDS });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      {/*
        `data-[side=right]:` on the width utilities, not plain `sm:` ones: the
        base `SheetContent` already sets `data-[side=right]:w-3/4` and
        `data-[side=right]:sm:max-w-sm`, both gated on the same attribute
        selector. A plain class loses that specificity fight and silently
        does nothing — matching the modifier is what makes the override win.
      */}
      <SheetContent className="flex w-full flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]">
        {/* Leaves room for the close button pinned at the top right. */}
        <SheetHeader className="pr-10">
          <SheetTitle className="font-heading uppercase tracking-tight">
            {weekday}
          </SheetTitle>
          <SheetDescription className="num text-xs">{label}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <MarkdownField
              value={note?.body ?? ""}
              placeholder="Journal, or anything worth remembering about this day"
              ariaLabel={`Notes for ${weekday}, ${label}`}
              className="min-h-[50vh]"
              onCommit={(next) => onSaveNote(day, next)}
            />
          </div>

          <Separator />

          <section className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Timeline
              </h3>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Which timeline entries to show"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "xs" }),
                    "text-muted-foreground",
                  )}
                >
                  Filter
                  <ChevronDown aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuGroup>
                    {KIND_FILTER_OPTIONS.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={visibleKinds.includes(option.value)}
                        // Stays open across clicks, same reasoning as the
                        // board's status filter: these read as one
                        // multi-select.
                        closeOnClick={false}
                        onCheckedChange={(checked) =>
                          toggleEventKind(option.value, checked)
                        }
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {events.length === 0 ? (
              // Every future day hits this, so it has to read as normal rather
              // than as an error or an empty search result.
              <p className="py-2 text-sm text-muted-foreground">
                Nothing happened on this day yet.
              </p>
            ) : visibleEvents.length === 0 ? (
              <HiddenByFilterNotice count={hiddenCount} onShowAll={showAllKinds} />
            ) : (
              <>
                <TimelineList ariaLabel={`Timeline for ${weekday}, ${label}`}>
                  {visibleEvents.map((event, index) => (
                    <TimelineEntry
                      key={event.key}
                      event={event}
                      day={day}
                      isLast={index === visibleEvents.length - 1}
                      list={
                        (event.todo.listId ? listsById.get(event.todo.listId) : undefined) ??
                        backlog
                      }
                      labels={labels}
                      reminderPresets={reminderPresets}
                      ctx={ctx}
                      timezone={timezone}
                      onToggleTodo={onToggleTodo}
                      onOpenTodo={onOpenTodo}
                    />
                  ))}
                </TimelineList>
                {hiddenCount > 0 && (
                  <HiddenByFilterNotice count={hiddenCount} onShowAll={showAllKinds} />
                )}
              </>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "N hidden by the view filter · Show all" — one component for two spots:
 * replacing the list entirely when the filter hides every event, and as a
 * footer line when it hides some. Reused rather than two separately worded
 * messages, so the count and the reset action can't drift apart.
 */
function HiddenByFilterNotice({
  count,
  onShowAll,
}: {
  count: number;
  onShowAll: () => void;
}) {
  return (
    <p className="flex items-center gap-1 py-2 text-sm text-muted-foreground">
      {/* Own span, not inlined with the button: keeps the count text
          queryable by its exact words rather than the row's full text,
          which includes "Show all". */}
      <span>
        {count} {count === 1 ? "entry" : "entries"} hidden by the view filter
      </span>
      <span aria-hidden>·</span>
      <Button variant="link" size="xs" className="h-auto p-0" onClick={onShowAll}>
        Show all
      </Button>
    </p>
  );
}

interface TimelineEntryProps {
  event: DayEvent;
  /** The day this timeline belongs to — NOT necessarily the day `event.at`
   * falls on. See `formatEventWhen`. */
  day: CivilDate;
  isLast: boolean;
  list: List | undefined;
  labels: LabelRecord[];
  reminderPresets?: ReminderPreset[];
  ctx: PlacementContext;
  timezone: string;
  onToggleTodo: (todo: Todo) => void;
  onOpenTodo: (todo: Todo) => void;
}

function TimelineEntry({
  event,
  day,
  isLast,
  list,
  labels,
  reminderPresets,
  ctx,
  timezone,
  onToggleTodo,
  onOpenTodo,
}: TimelineEntryProps) {
  const accent = edge(list?.color);

  return (
    <TimelineRow
      icon={EVENT_ICON[event.kind]}
      label={EVENT_LABEL[event.kind]}
      at={event.at}
      when={formatEventWhen(event.at, day, timezone)}
      accent={accent}
      isLast={isLast}
    >
      {/*
        The list's wash goes BEHIND the card, never on it — an inline
        `backgroundColor` on the row itself would beat `hover:bg-accent/50`,
        since inline styles win over classes. Same mechanism, and the same
        reason, as `TodoGroupSection` in board-column.tsx.
      */}
      <div
        className="mt-1 overflow-hidden rounded-md border border-border/60"
        style={{ backgroundColor: wash(list?.color) }}
      >
        <TodoCard
          todo={event.todo}
          labels={labels}
          reminderPresets={reminderPresets}
          ctx={ctx}
          draggable={false}
          onToggle={onToggleTodo}
          onOpen={onOpenTodo}
        />
      </div>
    </TimelineRow>
  );
}
