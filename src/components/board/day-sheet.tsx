"use client";

import { useMemo } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MarkdownField } from "@/components/ui/markdown-field";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { edge, wash } from "@/lib/colors";
import {
  buildDayTimeline,
  formatEventTime,
  type DayEvent,
  type DayEventKind,
} from "@/lib/day-timeline";
import { formatDay, type PlacementContext } from "@/lib/scheduling";
import type {
  CivilDate,
  DayNote,
  Label as LabelRecord,
  List,
  Todo,
} from "@/lib/schema";
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
  note: DayNote | undefined;
  /** Every live to-do — the timeline is derived here, not upstream. */
  todos: Todo[];
  timezone: string;
  labels: LabelRecord[];
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
  done: "Completed",
  dropped: "Won't do",
};

const EVENT_ICON: Record<DayEventKind, typeof Plus> = {
  created: Plus,
  done: Check,
  dropped: X,
};

export function DaySheet({ day, ...rest }: DaySheetProps) {
  if (!day) return null;
  // Keyed remount re-seeds the note draft for each day. `MarkdownField` reads
  // its value once at mount by design (see markdown-editor.tsx), so without the
  // key, opening a second day would show the first day's notes.
  return <DaySheetContent key={day} day={day} {...rest} />;
}

function DaySheetContent({
  day,
  note,
  todos,
  timezone,
  labels,
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
    () => buildDayTimeline(todos, day, timezone),
    [todos, day, timezone],
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
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
              className="min-h-32"
              onCommit={(next) => onSaveNote(day, next)}
            />
          </div>

          <Separator />

          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Timeline
            </h3>

            {events.length === 0 ? (
              // Every future day hits this, so it has to read as normal rather
              // than as an error or an empty search result.
              <p className="py-2 text-sm text-muted-foreground">
                Nothing happened on this day yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {events.map((event, index) => (
                  <TimelineEntry
                    key={event.key}
                    event={event}
                    isLast={index === events.length - 1}
                    list={
                      (event.todo.listId ? listsById.get(event.todo.listId) : undefined) ??
                      backlog
                    }
                    labels={labels}
                    ctx={ctx}
                    timezone={timezone}
                    onToggleTodo={onToggleTodo}
                    onOpenTodo={onOpenTodo}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface TimelineEntryProps {
  event: DayEvent;
  isLast: boolean;
  list: List | undefined;
  labels: LabelRecord[];
  ctx: PlacementContext;
  timezone: string;
  onToggleTodo: (todo: Todo) => void;
  onOpenTodo: (todo: Todo) => void;
}

function TimelineEntry({
  event,
  isLast,
  list,
  labels,
  ctx,
  timezone,
  onToggleTodo,
  onOpenTodo,
}: TimelineEntryProps) {
  const Icon = EVENT_ICON[event.kind];
  const accent = edge(list?.color);

  return (
    <li className="relative pl-6">
      {/*
        The rail, stopping at the last node rather than running past it — a line
        continuing into empty space reads as "more below", which is exactly what
        there isn't.
      */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[5px] top-3 bottom-[-0.75rem] w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-background bg-muted-foreground"
        style={accent ? { backgroundColor: accent } : undefined}
      />

      <p className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" aria-hidden />
        {EVENT_LABEL[event.kind]}
        <span aria-hidden>·</span>
        <time dateTime={event.at} className="num">
          {formatEventTime(event.at, timezone)}
        </time>
      </p>

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
          ctx={ctx}
          draggable={false}
          onToggle={onToggleTodo}
          onOpen={onOpenTodo}
        />
      </div>
    </li>
  );
}
