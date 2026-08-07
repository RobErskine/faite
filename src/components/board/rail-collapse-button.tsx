"use client";

import { PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";

interface RailCollapseButtonProps {
  label: string;
  onCollapse: () => void;
}

/**
 * Collapses a pinned rail (Overflow, Backlog) without dragging its handle to
 * the edge — the fast path `RailHandle` doesn't offer on its own. Passed as
 * `BoardColumn`'s `actions` slot, but unlike `ColumnInfoButton` (an ordinary
 * inline icon at text baseline) this one is pulled out of flow entirely:
 * `absolute inset-y-0 right-0` against the header's own box (the header is
 * `relative` for exactly this) spans the full height of the heading and sits
 * flush against the column's right edge, so the target is the whole top-right
 * corner rather than a small icon. A plain `<button>` rather than the shared
 * `Button` UI component — `Button`'s size variants bake in a fixed `size-*`
 * (both width AND height), which would fight `inset-y-0`'s stretch the same
 * way `DragGrip` (also plain) avoids fighting its own layout.
 *
 * Disappears for free once the column is collapsed: that branch never renders
 * `actions` at all, since clicking the collapsed strip itself expands it.
 */
export function RailCollapseButton({ label, onCollapse }: RailCollapseButtonProps) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      aria-label={`Collapse the ${label} column`}
      className={cn(
        "absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center rounded-tr-md",
        "text-muted-foreground/50 transition-colors",
        "opacity-0 group-hover/column:opacity-100 focus-visible:opacity-100",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <PanelLeftClose className="size-3" aria-hidden />
    </button>
  );
}
