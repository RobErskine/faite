"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Label as LabelRecord, Todo } from "@/lib/schema";
import { isDeadlineMissed, type PlacementContext } from "@/lib/scheduling";

interface TodoCardProps {
  todo: Todo;
  labels: LabelRecord[];
  ctx: PlacementContext;
  /** Scheduled outside the visible window — shown dimmed in its list column. */
  isAway?: boolean;
  /** Draw the drop indicator immediately above this card. */
  showInsertionLine?: boolean;
  onToggle: (todo: Todo) => void;
  onOpen: (todo: Todo) => void;
}

export function TodoCard({
  todo,
  labels,
  ctx,
  isAway,
  showInsertionLine,
  onToggle,
  onOpen,
}: TodoCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id });

  const deadlineMissed = isDeadlineMissed(todo, ctx);
  const todoLabels = labels.filter((l) => todo.labelIds.includes(l.id));

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group relative flex items-start gap-2 border-b border-border/60 px-2 py-1.5",
        "transition-colors hover:bg-accent/50 focus-within:bg-accent/50",
        // The dragged row stays in place as a faint ghost so the list does not
        // visibly collapse out from under the cursor.
        isDragging && "opacity-30",
        isAway && "opacity-60",
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
          className="absolute -top-px left-0 right-0 z-10 h-0.5 rounded-full bg-primary"
        >
          <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-primary" />
        </span>
      )}

      {/*
        Drag handle is a separate control from the card body. Making the whole
        card draggable would swallow text selection and make the checkbox
        fiddly to hit.

        It stays faintly visible at rest rather than fully hidden — a control
        that only exists on hover is undiscoverable until you happen to sweep
        over it.
      */}
      <button
        type="button"
        className={cn(
          "mt-0.5 touch-none rounded text-muted-foreground/30",
          "cursor-grab active:cursor-grabbing",
          "transition-all group-hover:text-muted-foreground",
          "hover:bg-accent hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label={`Drag to reschedule or reorder ${todo.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>

      <Checkbox
        checked={todo.status === "done"}
        onCheckedChange={() => onToggle(todo)}
        aria-label={`Mark ${todo.title} ${todo.status === "done" ? "not done" : "done"}`}
        className="mt-0.5"
      />

      <button
        type="button"
        onClick={() => onOpen(todo)}
        className={cn(
          "flex-1 text-left text-sm leading-snug",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
          todo.status !== "open" && "text-muted-foreground line-through",
        )}
      >
        <span className="block truncate">{todo.title}</span>

        {(todoLabels.length > 0 || deadlineMissed || isAway) && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {isAway && todo.scheduledDate && (
              <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                <CalendarClock className="size-2.5" aria-hidden />
                {todo.scheduledDate}
              </Badge>
            )}
            {deadlineMissed && (
              <Badge variant="destructive" className="text-[10px] font-normal">
                Deadline {todo.deadline}
              </Badge>
            )}
            {todoLabels.map((label) => (
              <Badge
                key={label.id}
                variant="secondary"
                className="text-[10px] font-normal"
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
