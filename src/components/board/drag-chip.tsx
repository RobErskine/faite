"use client";

import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIFTED } from "@/lib/drop-animation";
import { railBorder } from "@/lib/priority";
import type { Label as LabelRecord, ReminderPreset, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import {
  TitleMarkers,
  TodoMetaBadges,
  todoRowFacts,
  type TodoRowSources,
} from "./todo-row-parts";

/**
 * The to-do being carried: the drag overlay's card (EI-395).
 *
 * The same anatomy as the row it lifts from, built from the same parts
 * (`todo-row-parts.tsx`) at the chip's density — the rail, the title with its
 * glyphs (↳, the deadline flag, the repeat, the pin), and the badge line — so
 * what follows the pointer is the to-do, not a summary of it, and the drop
 * crossfades into a row that looks like what landed. It used to be the title
 * alone, truncated to one line, with no ↳ or deadline flag (critique,
 * 2026-10-15).
 *
 * What differs from the row, and why:
 *
 * - **No hover text.** `TitleMarkers` and `TodoMetaBadges` both render with
 *   `interactive={false}`: the chip rides under the pointer, so any tooltip
 *   or `title` would open beneath it mid-drag and ride along.
 * - **The rail is the chip's left border** (`railBorder`), not
 *   `PriorityRail`'s span: a standalone rounded box has no column edge to
 *   keep true and no layout to shift. Width, rhythm and opacity come from
 *   `PRIORITY_RAILS` either way, settled step-back included.
 * - **The title clamps at two lines**, where the row allows three: the chip is
 *   capped at `max-w-xs` and the drop animation needs a box that does not
 *   change size mid-drag (docs/DRAG-AND-DROP.md §4.7). A clamp is as stable as
 *   a truncate, since nothing on a carried to-do can change while it is
 *   carried.
 * - **No checkbox.** A carried to-do cannot be ticked; the grip stands in its
 *   place, on the title's first line as the row's grip is.
 * - **No scheduled-date badge.** The column under the pointer is the date
 *   being proposed; a second one on the chip would argue with it.
 *
 * The lift (`LIFTED`) is an inline style rather than `rotate-2 scale-[1.02]`
 * so the drop animation knows exactly which properties it is unwinding: given
 * classes, whether Tailwind emits `transform` or the individual
 * `rotate`/`scale` properties decides whether the settle composites or
 * doubles the tilt.
 */
export function DragChip({
  todo,
  labels,
  reminderPresets,
  ctx,
  rowSources,
  selectionCount = 1,
}: {
  todo: Todo;
  labels: LabelRecord[];
  reminderPresets?: ReminderPreset[];
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays" | "overflowAfterDays">;
  /** The board's per-to-do maps — see `todoRowFacts`. */
  rowSources?: TodoRowSources;
  /** How many to-dos are being carried, this one included (EI-194). */
  selectionCount?: number;
}) {
  const facts = todoRowFacts(todo, ctx, rowSources);
  const settled = todo.status !== "open";

  return (
    <div
      data-drag-chip=""
      style={{ ...LIFTED, ...railBorder(todo.priority, settled) }}
      className={cn(
        "flex max-w-xs cursor-grabbing items-start gap-1 rounded-md border",
        "bg-background px-2 py-1.5 text-sm leading-snug shadow-xl ring-2 ring-primary/40",
      )}
    >
      {/* On the title's first line, as the card's grip is. */}
      <GripVertical className="mt-[0.1875rem] size-3 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <span
          data-drag-chip-title=""
          // Done and Won't do share the row's settled ink; only done is
          // struck, and the strike sits on the words, not the glyphs.
          className={cn("block min-w-0 wrap-break-word line-clamp-2", settled && "text-foreground/60")}
        >
          <TitleMarkers
            todo={todo}
            today={ctx.today}
            interactive={false}
            rolledFrom={facts.rolledFrom}
            recurrenceSummary={facts.recurrenceSummary}
          />
          <span className={cn(todo.status === "done" && "line-through")}>{todo.title}</span>
        </span>
        <TodoMetaBadges
          todo={todo}
          labels={labels}
          today={ctx.today}
          reminderPresets={reminderPresets}
          missedCount={facts.missedCount}
          overflow={facts.overflow}
          subtaskCount={facts.subtaskCount}
          attachmentCount={facts.attachmentCount}
          interactive={false}
          // The chip's own rhythm is `py-1.5`; the row's `mt-1.5` would set
          // the badges further from the title than from the chip's edge.
          className="mt-1"
        />
      </div>
      {/*
        How many are coming with it (EI-194). A badge INSIDE the chip,
        `shrink-0` so the box stays the size the drop animation measured — a
        fan of stacked ghost cards would grow the wrapper's rect mid-drag and
        break the flight (§4.7).
      */}
      {selectionCount > 1 && (
        <span
          data-drag-chip-count=""
          className="num shrink-0 rounded-full bg-primary px-1.5 text-2xs font-medium text-primary-foreground"
        >
          {selectionCount}
        </span>
      )}
    </div>
  );
}
