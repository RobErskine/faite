"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ColumnInfoButtonProps {
  listName: string;
  isOpen: boolean;
  onOpen: () => void;
}

/**
 * The entry point to a list's settings, living at the right edge of its column
 * header.
 *
 * Quiet by default and revealed on hover, the same bargain the column grip
 * makes: five columns each showing a permanent button would turn a row of list
 * names into a row of controls. It stays reachable without a pointer because
 * `focus-visible` reveals it too, so tabbing through the board surfaces it in
 * order — and it is pinned visible while its dialog is open, otherwise the
 * control you just clicked vanishes underneath the thing it opened.
 */
export function ColumnInfoButton({ listName, isOpen, onOpen }: ColumnInfoButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onOpen}
      aria-label={`List options for ${listName}`}
      className={cn(
        // The header is baseline-aligned for its text; an icon has no
        // meaningful baseline, so opt it out rather than let it hang low.
        "self-center text-muted-foreground/50 transition-opacity",
        "opacity-0 group-hover/column:opacity-100 focus-visible:opacity-100",
        "hover:text-foreground",
        isOpen && "opacity-100",
      )}
    >
      <Info aria-hidden />
    </Button>
  );
}
