/**
 * Calm "nothing here yet" message for the moment every column on the board
 * — the whole calendar half AND the whole planning half — holds no to-dos.
 * A brand-new account lands here (`seedIfEmpty` seeds lists, never sample
 * to-dos), and so does an existing one that has cleared everything out.
 *
 * Deliberately NOT a per-column treatment — a single empty list or day is
 * just its quick-add row, matching the paper feel, and stays untouched. This
 * banner exists only for the board reading blank ALL AT ONCE. It points at
 * Backlog specifically, not "any column": Backlog is the one column whose
 * quick-add placeholder is visible at rest (`quickAddPlaceholderVisible` on
 * `BoardColumn`) — every day column stays quiet until hover/focus/touch, so
 * telling a first-time visitor to type into one of those points at a field
 * they can't see yet.
 *
 * No dismissal state, unlike `SignedOutBanner`. It is driven straight off
 * `calendarCount + planningCount` (`use-board-data.ts`), which both boards
 * already compute for their `SplitStrip` labels — the instant either ticks
 * past 0 the condition goes false and the banner unmounts on its own, so
 * there is nothing to remember dismissing and nothing that can go stale.
 */
export function BoardEmptyBanner() {
  return (
    <div
      role="status"
      className="border-b border-border/60 bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground"
    >
      Nothing on the board yet — type into Backlog to add your first to-do.
    </div>
  );
}
