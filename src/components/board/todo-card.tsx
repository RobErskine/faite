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
  onToggle: (todo: Todo) => void;
  onOpen: (todo: Todo) => void;
}

export function TodoCard({
  todo,
  labels,
  ctx,
  isAway,
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
        "group flex items-start gap-2 border-b border-border/60 px-2 py-1.5",
        "hover:bg-accent/50 focus-within:bg-accent/50",
        isDragging && "opacity-40",
        isAway && "opacity-60",
      )}
    >
      {/*
        Drag handle is a separate control from the card body. Making the whole
        card draggable would swallow text selection and make the checkbox
        fiddly to hit.
      */}
      <button
        type="button"
        className={cn(
          "mt-0.5 cursor-grab touch-none text-muted-foreground/40 opacity-0",
          "group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
        aria-label={`Reorder ${todo.title}`}
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
