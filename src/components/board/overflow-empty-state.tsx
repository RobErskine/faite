"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
          className="h-auto p-0 text-2xs text-muted-foreground underline"
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
              className="focus-ring ml-auto shrink-0 rounded-full text-muted-foreground/70 hover:text-foreground"
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
