"use client";

import type { ComponentProps } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The drag affordance shared by everything draggable on the board — todo rows
 * and list columns.
 *
 * One component so the two can never drift: a grip that sits somewhere else, or
 * is a different size, on a card versus a column reads as two unrelated
 * controls rather than one idea.
 *
 * **Small mark, large target.** The icon is 12px so it stays quiet next to the
 * text it precedes, but the hit area is expanded to 24×24 — the WCAG 2.2
 * "Target Size (Minimum)" floor — by a pseudo-element rather than by padding.
 * Padding would have grown the button's box and pushed the title along with it;
 * an absolutely positioned `::before` costs nothing in layout, and pointer
 * events on it still resolve to the button.
 *
 * The expansion stops 2px short of the neighbouring control on a card, so
 * widening it further would start stealing clicks from the checkbox.
 *
 * Hover is a colour change, not a background: a filled box around a 12px icon
 * would undo the point of making the mark small.
 */
export function DragGrip({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "relative shrink-0 rounded text-muted-foreground/30",
        "cursor-grab transition-colors active:cursor-grabbing",
        // The only touch drag surface — `touch-action: none` keeps the browser
        // from claiming the gesture for scrolling before dnd-kit's 4px
        // threshold is met. See DRAG-AND-DROP.md §4.9.
        "touch-none",
        "before:absolute before:-inset-1.5 before:content-['']",
        "hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <GripVertical className="size-3" aria-hidden />
    </button>
  );
}
