"use client";

import { useDroppable } from "@dnd-kit/core";
import type { DayColumn } from "@/lib/board";
import { navKeyOf, type NavKey } from "@/lib/column-nav";
import { formatShortDate } from "@/lib/scheduling";
import { cn } from "@/lib/utils";

/**
 * A collapsed run of weekend days, as one narrow strip.
 *
 * Chosen over simply omitting Saturday and Sunday. Hiding the weekend outright
 * hides work that is genuinely scheduled there — an errand you deliberately put
 * on Saturday would vanish with no trace on the board that it exists. The strip
 * keeps the count visible and the days one click away, so hiding the weekend
 * costs horizontal space and nothing else.
 *
 * NOT A DROP DESTINATION. It registers a droppable purely so a hovering card
 * can be detected and the strip opened after a dwell (see `WEEKEND_EXPAND_DWELL_MS` in
 * board.tsx); the drop then lands on a real day column underneath. "Schedule
 * this for the weekend" is not a date, and inventing one — Saturday, say —
 * would silently make the ambiguous choice on the user's behalf. That is why
 * `weekendColumnId` is deliberately absent from `parseColumnId`.
 */
interface WeekendColumnProps {
  /**
   * `weekendColumnId(first day)`, serving as BOTH the droppable id and the
   * nav stop — the same doubling-up `NAV_CREATE_LIST` does. Safe because
   * every other stop is prefixed (`todo:`, `add:`, `group:`, `nav:`), so the
   * two id spaces cannot collide.
   */
  id: string;
  /** The run's day columns, in order. One entry when the window starts on a Sunday. */
  columns: readonly DayColumn[];
  /** A card drag is in flight — dresses the strip as an openable candidate. */
  isDragActive: boolean;
  onExpand: () => void;
  onNavigate: (fromStopId: string, key: NavKey) => boolean;
}

export function WeekendColumn({
  id,
  columns,
  isDragActive,
  onExpand,
  onNavigate,
}: WeekendColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const count = columns.reduce((sum, column) => sum + column.todos.length, 0);
  const first = columns[0];
  const last = columns[columns.length - 1];
  const range =
    columns.length === 1
      ? formatShortDate(first.day)
      : `${formatShortDate(first.day)} – ${formatShortDate(last.day)}`;

  return (
    <section
      ref={setNodeRef}
      data-nav-stop={id}
      role="button"
      tabIndex={0}
      aria-label={`Show the weekend, ${range}${count > 0 ? `, ${count} to-dos` : ", empty"}`}
      onClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExpand();
          return;
        }
        const key = navKeyOf(e);
        if (key && onNavigate(id, key)) e.preventDefault();
      }}
      className={cn(
        // `w-10 shrink-0` and no `flex-1`: the strip takes a fixed 40px and
        // leaves the rest of the row to the real day columns, which keep their
        // --column-min floor. Matching the collapsed rail in board-column.tsx.
        "group/weekend relative flex w-10 min-h-0 shrink-0 cursor-pointer flex-col items-center",
        "gap-1 rounded-md bg-muted/40 py-2 transition-all",
        "hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        // The CANDIDATE outline, not `rejectsDrop`'s destructive one. Hovering
        // here with a card is productive — it opens the days — so dressing it
        // as a refusal would say the opposite of what happens.
        isDragActive && !isOver && "outline-dashed outline-1 outline-offset-[-2px] outline-border",
        isOver && "bg-primary/5 outline outline-2 outline-offset-[-2px] outline-primary",
      )}
    >
      {count > 0 && (
        <span className="num text-2xs font-medium text-muted-foreground">{count}</span>
      )}
      <h2
        className={cn(
          "truncate type-column-title text-lg",
          "text-muted-foreground [writing-mode:vertical-rl] rotate-180",
        )}
      >
        Weekend
      </h2>
    </section>
  );
}
