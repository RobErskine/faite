/**
 * Calm "nothing here yet" message for the moment every column on the board
 * — the whole calendar half AND the whole planning half — holds no to-dos.
 * A brand-new account lands here (`seedIfEmpty` seeds lists, never sample
 * to-dos), and so does an existing one that has cleared everything out.
 *
 * Deliberately NOT a per-column treatment. A single empty list or day
 * already has one: `BoardColumn`'s ruled `fillerRows` plus its quick-add
 * row, matching the reference UI's paper feel — that is working as designed
 * and stays untouched. This banner exists only for the board reading blank
 * ALL AT ONCE, the one moment a first-time visitor has no card, no ruled
 * column with anything in it, and no cue that typing into any column's
 * quick-add row (its placeholder is intentionally invisible until focused,
 * same paper feel) is the way to start.
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
      Nothing on the board yet — type into any column below to add your first to-do.
    </div>
  );
}
