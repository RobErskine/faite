"use client";

import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";

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
