"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import { cn } from "@/lib/utils";

/**
 * Overflow's (EI-97) entry point into Overdrive — passed as the column's
 * `footer` slot (`board-column.tsx`). Rendered only once the pile is worth a
 * dedicated mode; `count` is the UNFILTERED column total, the same
 * convention `totalCount`/`FILTER_MIN_TODOS` already use, so narrowing the
 * in-column filter can never hide this on a pile that's still there.
 *
 * `minTodos` (EI-103) defaults to `OVERDRIVE_MIN_TODOS` — callers pass
 * `settings?.overdriveMinTodos ?? OVERDRIVE_MIN_TODOS` explicitly
 * (`desktop-board.tsx`/`phone-board.tsx`), but the default keeps every
 * existing call site (and test) that doesn't pass it behaving exactly as
 * before.
 */
export function OverdriveButton({
  count,
  onOpen,
  minTodos = OVERDRIVE_MIN_TODOS,
}: {
  count: number;
  onOpen: () => void;
  minTodos?: number;
}) {
  if (count < minTodos) return null;

  return (
    <div className="border-t border-border/60 p-2">
      <Button variant="outline" onClick={onOpen} className="w-full pointer-coarse:min-h-11">
        <Zap aria-hidden /> Overdrive · <span className="num">{count}</span>
      </Button>
    </div>
  );
}

/**
 * A day column's own entry point into Overdrive (EI-253) — passed as
 * `BoardColumn`'s `actions` slot, the header's right-aligned spot that
 * Overflow/Backlog already use for `RailCollapseButton` and day columns
 * leave empty. Same threshold rule as `OverdriveButton` above (`count` is
 * the UNFILTERED day total — see `use-board-data.ts`'s `overdriveDayTodos`),
 * but not folded into that component as a `variant`: the two share exactly
 * this one line and nothing else about their rendering.
 *
 * A plain `<button>`, not the shared `Button` — `Button`'s size variants
 * bake in a fixed `size-*` that would fight the header's own layout, the
 * same reason `RailCollapseButton` gives. `self-center` because the header
 * is `items-baseline` and an icon has no baseline to align to. The negative
 * margin gives the layout back exactly what the padding took, growing the
 * hit area (bigger still on `pointer-coarse:`) without growing the header.
 *
 * Always rendered once past the threshold, never hover-gated — unlike
 * `RailCollapseButton` this only appears once there's real work to triage,
 * so it isn't ambient chrome, and hover-gating would hide it outright on
 * touch.
 */
export function DayOverdriveButton({
  count,
  label,
  onOpen,
  minTodos = OVERDRIVE_MIN_TODOS,
}: {
  count: number;
  /** The day's own label, e.g. "Monday, Aug 11" — folded into the
   * accessible name so it doesn't collide with Overflow's own "Overdrive ·
   * N" button under a `name: /overdrive/i` locator. */
  label: string;
  onOpen: () => void;
  minTodos?: number;
}) {
  if (count < minTodos) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Overdrive ${label} — ${count} to-dos`}
      className={cn(
        "shrink-0 self-center rounded text-muted-foreground transition-colors",
        "-m-1.5 p-1.5 pointer-coarse:-m-2.5 pointer-coarse:p-2.5",
        "hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <Zap className="size-3.5" aria-hidden />
    </button>
  );
}
