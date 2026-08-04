"use client";

import type { KeyboardEventHandler, PointerEventHandler } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DragGrip } from "./drag-grip";
import type { Label as LabelRecord, Todo } from "@/lib/schema";
import {
  formatShortDate,
  isDeadlineMissed,
  type PlacementContext,
} from "@/lib/scheduling";

interface TodoCardProps {
  todo: Todo;
  labels: LabelRecord[];
  ctx: PlacementContext;
  /** Scheduled outside the visible window — shown dimmed in its list column. */
  isAway?: boolean;
  /** Draw the drop indicator immediately above this card. */
  showInsertionLine?: boolean;
  /**
   * This row is mid-flight: the drag overlay is still travelling to it. Held
   * invisible so the ghost and the real row are never both on screen, but kept
   * in layout so the column does not resize under the animation.
   */
  isLanding?: boolean;
  onToggle: (todo: Todo) => void;
  onOpen: (todo: Todo) => void;
}

export function TodoCard({
  todo,
  labels,
  ctx,
  isAway,
  showInsertionLine,
  isLanding,
  onToggle,
  onOpen,
}: TodoCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id });

  // dnd-kit types its listeners as bare `Function`, which spreads onto an
  // element fine but cannot be assigned to a specific handler prop. The two
  // activators go to different elements here, so name them once.
  const { onPointerDown: startPointerDrag, onKeyDown: startKeyboardDrag } =
    (listeners ?? {}) as {
      onPointerDown?: PointerEventHandler;
      onKeyDown?: KeyboardEventHandler;
    };

  const deadlineMissed = isDeadlineMissed(todo, ctx);
  const todoLabels = labels.filter((l) => todo.labelIds.includes(l.id));

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      /*
        Pointer drags start anywhere on the row. Only `onPointerDown` moves here
        — `attributes` (role, tabIndex, aria-roledescription) and the keyboard
        activator stay on the grip, because making the row itself a focusable
        `role="button"` would nest interactive controls inside it.

        The two concerns that originally kept dragging on the grip alone turn
        out to be dnd-kit's job, not ours: on activation it clears the document
        selection and keeps clearing it, and it registers a capture-phase click
        listener that swallows the trailing click — so a drag never also opens
        the detail sheet. Below the 4px threshold nothing activates, so taps on
        the checkbox and title behave exactly as before.
      */
      onPointerDown={startPointerDrag}
      className={cn(
        "group relative flex items-start gap-2 border-b border-border/60 px-2 py-1.5",
        "cursor-grab active:cursor-grabbing",
        // Opacity transitions alongside the background so the row fades in when
        // a landing completes rather than popping. Hover only changes the
        // background, so naming both properties loses nothing over
        // `transition-colors`.
        "transition-[background-color,opacity] duration-100",
        "hover:bg-accent/50 focus-within:bg-accent/50",
        // The dragged row stays in place as a faint ghost so the list does not
        // visibly collapse out from under the cursor.
        isDragging && "opacity-30",
        // Held invisible while the overlay is still flying towards this slot.
        // Last, so it wins over the dragging and away states.
        isLanding && "opacity-0",
        isAway && !isLanding && "opacity-60",
      )}
    >
      {/*
        Insertion indicator: a solid line showing exactly where the dragged item
        will land. Without it the column highlight tells you *which* column but
        not *where* in it.
      */}
      {showInsertionLine && (
        <span
          aria-hidden
          data-drop-indicator
          className="absolute -top-px left-0 right-0 z-10 h-0.5 rounded-full bg-primary"
        >
          <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-primary" />
        </span>
      )}

      {/*
        The whole row drags, but the grip stays. It is the keyboard drag
        activator — a real focusable control carrying the aria-roledescription,
        which a bare div row cannot be without nesting interactive elements —
        and it is the only touch drag surface, since `touch-none` on the row
        itself would cost the columns their touch scrolling.

        It stays faintly visible at rest rather than fully hidden — a control
        that only exists on hover is undiscoverable until you happen to sweep
        over it.
      */}
      <DragGrip
        className="mt-1 group-hover:text-muted-foreground"
        aria-label={`Drag to reschedule or reorder ${todo.title}`}
        {...attributes}
        onKeyDown={startKeyboardDrag}
      />

      <Checkbox
        checked={todo.status === "done"}
        onCheckedChange={() => onToggle(todo)}
        aria-label={`Mark ${todo.title} ${todo.status === "done" ? "not done" : "done"}`}
        // Cursor is inherited, so without this the checkbox would read as a
        // drag surface. It still drags if you pull from it; it just should not
        // advertise that over being a checkbox.
        className="mt-0.5 cursor-pointer"
      />

      <button
        type="button"
        onClick={() => onOpen(todo)}
        className={cn(
          "flex-1 text-left text-sm leading-snug",
          // Stated rather than inherited: dragging is the primary gesture over
          // the title now, and a click still opens the sheet.
          "cursor-grab active:cursor-grabbing",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
          todo.status !== "open" && "text-muted-foreground line-through",
        )}
      >
        <span className="block truncate">{todo.title}</span>

        {(todoLabels.length > 0 || deadlineMissed || isAway) && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {isAway && todo.scheduledDate && (
              <Badge variant="outline" className="num gap-1 text-2xs font-normal">
                <CalendarClock className="size-2.5" aria-hidden />
                {formatShortDate(todo.scheduledDate)}
              </Badge>
            )}
            {deadlineMissed && todo.deadline && (
              <Badge variant="destructive" className="text-2xs font-normal">
                Deadline <span className="num">{formatShortDate(todo.deadline)}</span>
              </Badge>
            )}
            {todoLabels.map((label) => (
              <Badge
                key={label.id}
                variant="secondary"
                className="text-2xs font-normal"
                style={
                  label.color
                    ? { backgroundColor: `${label.color}20`, color: label.color }
                    : undefined
                }
              >
                {label.emoji ? `${label.emoji} ` : ""}
                {label.name}
              </Badge>
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
