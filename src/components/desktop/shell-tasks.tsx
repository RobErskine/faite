"use client";

import { useEffect } from "react";
import { apiUrl } from "@/lib/api-origin";
import {
  isDesktopShell,
  prepareHotAssetBundle,
  reportFrontendReady,
  stageHotAssetBundle,
} from "@/lib/desktop/bridge";
import { parseVersionPolicy, type DesktopVersionPolicy } from "@/lib/desktop/version";

/**
 * The desktop shell's background housekeeping: report that this frontend came
 * up (EI-257), and fetch a newer one if the server has published it (EI-256).
 *
 * ## Why this is in the root layout and not on the board
 *
 * Both jobs must happen on **every** successful boot, and the board is not
 * every boot. The desktop app can sit on its signed-out screen indefinitely,
 * and it opens `/capture` and `/background-sync` windows that never render a
 * board at all. Mounted on the board, this would mean:
 *
 * - a signed-out app that **never updates**, because nothing ever checks; and
 * - a good bundle rolled back after two launches, because nothing ever
 *   reported it had rendered.
 *
 * Both were live defects. The root layout renders on every route the shell can
 * open, which is exactly the scope these two jobs need.
 *
 * ## Why downloading lives here rather than in `useDesktopUpdate`
 *
 * That hook is display state for the update bar and the Settings row, and it
 * is deliberately mounted more than once. A duplicated version check is one
 * small cached GET — but a duplicated *download* is 3.8 MB twice. So the
 * fetching happens here, in a component mounted exactly once, and the bar
 * simply reads back what the shell has staged.
 *
 * ## Silence is the design
 *
 * Every failure — no bundle published, the shell declining it, an offline
 * download, a bundle that fails verification — leaves the app running the
 * frontend it already has. That is a perfectly good outcome and not worth
 * interrupting anyone over. The one thing that must not happen is a
 * half-applied update, and that is structurally impossible: the shell only
 * ever activates at startup.
 */

/** Matches `UPDATE_CHECK_INTERVAL_MS` in `use-desktop-update.ts`. */
const BUNDLE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function fetchPolicy(): Promise<DesktopVersionPolicy | null> {
  try {
    const response = await fetch(apiUrl("/api/desktop/version"));
    if (!response.ok) return null;
    return parseVersionPolicy(await response.json());
  } catch {
    return null;
  }
}

async function stageNewestBundle(): Promise<void> {
  const policy = await fetchPolicy();
  if (!policy?.assets) return;

  const manifestResponse = await fetch(policy.assets.manifestUrl);
  if (!manifestResponse.ok) return;
  // Passed as text, not re-serialised: the shell hashes what the server
  // actually sent, and a round trip through JSON.parse could change it.
  const manifestJson = await manifestResponse.text();

  // The shell decides. It owns activation, so it owns the questions of
  // whether the version is new, whether it is already staged, whether it was
  // refused before, and whether `minShellVersion` outranks it.
  if (!(await prepareHotAssetBundle(manifestJson))) return;

  const archiveResponse = await fetch(policy.assets.archiveUrl);
  if (!archiveResponse.ok) return;

  const staged = await stageHotAssetBundle(await archiveResponse.arrayBuffer());
  if (staged) {
    console.info(`[faite] hot-asset bundle ${staged} staged; it applies on the next launch`);
  }
}

export function DesktopShellTasks() {
  useEffect(() => {
    if (!isDesktopShell()) return;

    // First, and unconditionally: this frontend rendered. Anything below can
    // fail without costing the running bundle its probation.
    void reportFrontendReady();

    const check = () => {
      void stageNewestBundle().catch((error: unknown) => {
        console.error("[faite] could not stage a hot-asset bundle", error);
      });
    };

    check();
    // The window is effectively immortal (D1.5: closing it only hides it), so
    // "check on launch" alone would mean a copy running since March has never
    // asked.
    const timer = setInterval(check, BUNDLE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return null;
}
