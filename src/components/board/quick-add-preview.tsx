import { cn } from "@/lib/utils";
import { edge, tint } from "@/lib/colors";

export interface QuickAddChip {
  key: string;
  label: string;
  /**
   * The list's own accent — set only on the "→ list" chip, so it reads at a
   * glance as the same list the column headers and cards already color, per
   * the label-chip convention in `todo-card.tsx`. Every other chip (P2, a
   * date, a time) stays neutral; they don't have a color to borrow.
   */
  color?: string | null;
}

/**
 * The live feedback that teaches the quick-add syntax: a token is applied the
 * moment it's recognized, and nothing shows when it isn't. Shared by the
 * column quick-add row and the command palette so both teach one grammar.
 *
 * Takes plain chips rather than `QuickAddMatch[]` directly — the "@list"
 * mention (`mention-menu.tsx`) is not a `parseQuickAdd` token (it's a UI pick,
 * not text grammar), so callers build one combined chip list from both
 * sources rather than this component knowing about either.
 */
export function QuickAddPreview({
  chips,
  className,
}: {
  chips: QuickAddChip[];
  /** Overrides the default padding, tuned for the column quick-add row's own
   * inset — the todo sheet's title field has none, so it needs a flush one. */
  className?: string;
}) {
  if (chips.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1 px-2 pb-1.5", className)}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none",
            !chip.color && "border-border/60 bg-muted/60 text-muted-foreground",
          )}
          style={
            chip.color
              ? { backgroundColor: tint(chip.color), borderColor: edge(chip.color), color: chip.color }
              : undefined
          }
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
