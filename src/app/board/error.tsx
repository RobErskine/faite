"use client";

import { Button } from "@/components/ui/button";

/**
 * Next's route-level error boundary — catches a render throw anywhere under
 * /board that `BoardErrorFallback` (a `useBootstrap` failure, handled inline
 * in `board.tsx`) doesn't: a bug in a column, sheet, or dialog, not just a
 * bad local store. `reset()` re-renders the segment in place rather than a
 * full reload, so in-memory state elsewhere on the page survives.
 */
export default function BoardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-dvh flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"
    >
      <p>Something went wrong loading your board.</p>
      <Button size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
