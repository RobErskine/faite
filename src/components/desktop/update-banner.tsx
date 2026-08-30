"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDesktopUpdate } from "./use-desktop-update";

/**
 * The visible half of EI-147. Renders nothing at all in a browser tab, and
 * nothing in the desktop shell until the server says this build is behind.
 *
 * Two states, and the difference between them is the whole feature:
 *
 * - **outdated** — a newer build exists. A dismissible amber bar, same weight
 *   as `SignedOutBanner`. Dismissal is component-local rather than persisted
 *   (`lib/onboarding.ts`) because this window is effectively immortal (D1.5:
 *   closing it only hides it), so "until you relaunch" would mean "forever".
 *   It comes back on the next six-hourly check.
 * - **blocked** — the server has withdrawn support for this build. Not
 *   dismissible, because there is nothing else the user can do: sync is over
 *   for this copy until it is replaced by hand. `role="alert"` for the same
 *   reason.
 *
 * The button opens the download page in the system browser; it does NOT
 * install anything. That is EI-134/EI-136's job, and this bar is exactly the
 * cheap stand-in for it — see `src/lib/desktop/version.ts`.
 */
export function DesktopUpdateBanner() {
  const { state, openDownload } = useDesktopUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (state.status === "current") return null;
  const blocked = state.status === "blocked";
  if (!blocked && dismissed) return null;

  return (
    <div
      role={blocked ? "alert" : undefined}
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2 text-sm",
        blocked
          ? "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"
          : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
      )}
    >
      <span className="flex-1">
        {blocked ? (
          <>
            This copy of Faite (version {state.installed}) is too old to sync.
            Install version {state.latest} to pick your board back up.
          </>
        ) : (
          <>
            Faite {state.latest} is out — you&apos;re on {state.installed}.
          </>
        )}
      </span>

      <Button variant={blocked ? "default" : "outline"} size="xs" onClick={openDownload}>
        {blocked ? "Get the update" : "Update"}
      </Button>

      {blocked ? null : (
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
