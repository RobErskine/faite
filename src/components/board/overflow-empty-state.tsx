"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Overflow's per-column empty state (`BoardColumn`'s `emptyState` prop).
 * Overflow has no quick-add row — nothing schedules INTO it, only out of it —
 * so an empty Overflow used to render nothing at all, with no cue that this
 * was the empty state and not a loading gap.
 *
 * `onCollapse` is omitted on phone: there is no rail to collapse there,
 * Overflow is simply the first page in the pager.
 */
export function OverflowEmptyState({ onCollapse }: { onCollapse?: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 text-2xs text-muted-foreground">
      <span>No items.</span>
      {onCollapse && (
        <Button
          variant="link"
          size="sm"
          onClick={onCollapse}
          // `-my-1 py-1`: the 16px line becomes a 24px target (WCAG 2.2's
          // floor) and hands the 4px straight back, so the row keeps its
          // height (EI-378).
          className="-my-1 h-auto p-0 py-1 text-2xs text-muted-foreground underline"
        >
          Collapse Overflow
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="What is Overflow?"
              className={cn(
                "focus-ring relative ml-auto shrink-0 rounded-full text-muted-foreground hover:text-foreground",
                // A 14px icon, a 24×24 target: DragGrip's extender, so the
                // mark stays small (EI-378). Full muted ink — /70 was 2.71:1,
                // under the 3:1 a control's glyph needs.
                "after:absolute after:-inset-[5px] after:content-['']",
              )}
            >
              <Info className="size-3.5" aria-hidden />
            </button>
          }
        />
        <TooltipContent>
          Missed to-dos roll forward a few times, then land here.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
