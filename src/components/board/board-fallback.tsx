import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The board's loading state, in one place instead of two (`board/page.tsx`'s
 * `dynamic()` fallback and `Board`'s own pre-`ready` guard) — a copy or
 * spinner change used to need both files touched, and it's easy to miss one.
 * `motion-reduce:animate-none` freezes the spinner rather than hiding it;
 * the "Loading…" text still carries the state on its own.
 */
export function BoardFallback() {
  return (
    <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      Loading your board…
    </div>
  );
}

/**
 * Shown when `useBootstrap` reports `error` — either the local store failed
 * to open, or IndexedDB isn't available at all. Both used to look identical
 * to a brand-new empty board or an infinite loading screen; this is the
 * first thing on the board that tells the user something actually broke.
 */
export function BoardErrorFallback() {
  return (
    <div
      role="alert"
      className="flex h-dvh flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"
    >
      <p>Unable to load your board. Reload to try again.</p>
      <Button size="sm" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
