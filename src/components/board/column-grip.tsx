"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { listDragId } from "@/lib/board";
import { DragGrip } from "./drag-grip";

interface ColumnGripProps {
  listId: string;
  listName: string;
}

/**
 * Reorder handle for a list column, living in the column header.
 *
 * A separate component because the hook must not be called for columns that
 * cannot be reordered — day columns and Backlog — and hooks cannot be
 * conditional. Rendering it conditionally is the clean way to say "this column
 * is draggable and that one is not".
 *
 * Unlike a todo card, the column is *not* draggable from anywhere. Its body is
 * full of cards that are themselves drag sources, so a pointerdown on a card
 * would bubble straight into a column drag. The header is the only surface
 * with no competing gesture.
 */
export function ColumnGrip({ listId, listName }: ColumnGripProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: listDragId(listId),
  });

  return (
    <DragGrip
      ref={setNodeRef}
      aria-label={`Drag to reorder the ${listName} list`}
      className={cn(
        // Visible at rest, not hover-only, so the affordance is discoverable
        // without sweeping the header.
        "group-hover/column:text-muted-foreground",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    />
  );
}
