"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDesktopUpdate } from "./use-desktop-update";

/**
 * The visible half of EI-147, now carrying EI-258's staged-bundle state.
 *
 * Renders nothing in a browser tab, and nothing in the desktop shell until
 * there is something to say. Three states, in strict priority order:
 *
 * - **blocked** — the server has withdrawn support for this SHELL. Not
 *   dismissible, `role="alert"`, and it wins over everything below: sync is
 *   over for this copy until the app itself is replaced by hand, and a
 *   cheerful "restart to update" underneath that would be a lie.
 * - **outdated** — a newer SHELL exists. Dismissible amber bar, and still the
 *   download-a-build flow, because a shell cannot update itself yet
 *   (EI-134/EI-136).
 * - **staged** — a new FRONTEND is verified and waiting (EI-258). Dismissible,
 *   and the action is a restart rather than a download: the restart *is* the
 *   install, since a bundle is activated during startup before any webview
 *   exists (`docs/DESKTOP.md` §14.3).
 *
 * Shell and bundle are separate axes, which is why "up to date" and "restart
 * to update" are not contradictory: the shell changes a few times a year, the
 * frontend on every deploy.
 *
 * Dismissal is component-local rather than persisted (`lib/onboarding.ts`)
 * because this window is effectively immortal (D1.5: closing it only hides
 * it), so "until you relaunch" would mean "forever". It returns on the next
 * six-hourly check.
 */
export function DesktopUpdateBanner() {
  const { state, openDownload, stagedBundle, restart } = useDesktopUpdate();
  const [dismissed, setDismissed] = useState(false);

  const blocked = state.status === "blocked";
  // A staged frontend is only worth mentioning when the shell itself is not
  // the problem. See the priority order in the doc comment.
  const staged = state.status === "current" && stagedBundle !== null;

  if (!blocked && state.status === "current" && !staged) return null;
  if (!blocked && dismissed) return null;

  return (
    <div
      role={blocked ? "alert" : undefined}
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2 text-sm",
        // Status tokens (docs/DESIGN.md §1): blocked is urgent, a staged
        // update is information, a newer version out there is a warning.
        blocked
          ? "bg-urgent-soft text-urgent-foreground"
          : staged
            ? "bg-info-soft text-info-foreground"
            : "bg-warning-soft text-warning-foreground",
      )}
    >
      <span className="flex-1">
        {blocked ? (
          <>
            This copy of Faite (version {state.installed}) is too old to sync.
            Install version {state.latest} to pick your board back up.
          </>
        ) : staged ? (
          <>An update is ready. Restart Faite to pick it up.</>
        ) : (
          <>
            Faite {state.status === "current" ? "" : state.latest} is out — you&apos;re on{" "}
            {state.status === "current" ? "" : state.installed}.
          </>
        )}
      </span>

      <Button
        variant={blocked ? "default" : "outline"}
        size="xs"
        onClick={staged ? restart : openDownload}
      >
        {blocked ? "Get the update" : staged ? "Restart" : "Update"}
      </Button>

      {blocked ? null : (
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
