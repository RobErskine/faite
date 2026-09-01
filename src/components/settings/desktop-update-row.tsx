"use client";

import { Button } from "@/components/ui/button";
import { useDesktopUpdate } from "@/components/desktop/use-desktop-update";
import { isDesktopShell } from "@/lib/desktop/bridge";

/**
 * Settings → About, desktop shell only: which build is running, and the
 * button that goes and gets a newer one (EI-147).
 *
 * The bar in `update-banner.tsx` is what tells a user unprompted. This is the
 * other half — the place someone goes when they WONDER, which is exactly when
 * an app with no auto-updater has nothing to say for itself. Both read the
 * same `useDesktopUpdate`; neither installs anything (EI-134/EI-136).
 *
 * Renders nothing on the web, where the "version" is whatever was deployed
 * and a reload is the whole update story.
 */
export function DesktopUpdateRow() {
  const { state, installed, checking, checked, check, openDownload, stagedBundle, restart } =
    useDesktopUpdate();

  if (!isDesktopShell()) return null;

  const behind = state.status !== "current";
  // Same priority rule as the bar: a shell that cannot sync is the bigger
  // problem, and a restart would not fix it (EI-258).
  const staged = !behind && stagedBundle !== null;

  return (
    <div className="mb-4 rounded-md border p-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Faite for Mac</p>
          {/* `num`: tabular figures, so a version doesn't jitter on re-check. */}
          <p className="num text-xs text-muted-foreground">
            Version {installed ?? "—"}
            {behind ? ` · ${state.latest} available` : ""}
          </p>
        </div>

        {behind ? (
          <Button size="sm" onClick={openDownload}>
            Get the update
          </Button>
        ) : staged ? (
          <Button size="sm" onClick={restart}>
            Restart to update
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={check} disabled={checking}>
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </div>

      {state.status === "blocked" ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          This version can no longer sync. Install the update to pick your board
          back up on this Mac.
        </p>
      ) : null}

      {staged ? (
        <p className="mt-2 text-xs text-muted-foreground">
          A new version of the app&apos;s interface is ready and will load when you
          restart. Your board is unaffected.
        </p>
      ) : null}

      {state.status === "current" && !staged && checked ? (
        <p className="mt-2 text-xs text-muted-foreground">You&apos;re up to date.</p>
      ) : null}
    </div>
  );
}
