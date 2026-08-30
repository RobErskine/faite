"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api-origin";
import { getShellVersion, isDesktopShell, openDownloadPage } from "@/lib/desktop/bridge";
import {
  evaluateUpdate,
  parseVersionPolicy,
  type DesktopUpdateState,
  type DesktopVersionPolicy,
} from "@/lib/desktop/version";
import { CLIENT_OUTDATED_EVENT } from "@/lib/sync/transport";

/**
 * `null` on any failure — offline, a 500, a body that isn't a policy. The
 * caller maps that to "current": an unreachable server must never be what
 * puts the app out of service, and this runs on a timer that will simply ask
 * again.
 *
 * Lives here rather than beside the types in `@/lib/desktop/version`, which
 * the Worker also compiles — that program has no `window`, and `apiUrl()`
 * reads one.
 */
async function fetchDesktopVersionPolicy(): Promise<DesktopVersionPolicy | null> {
  try {
    const response = await fetch(apiUrl("/api/desktop/version"));
    if (!response.ok) return null;
    return parseVersionPolicy(await response.json());
  } catch {
    return null;
  }
}

/**
 * Six hours. The desktop app is dock-resident and effectively never restarts
 * (D1.5 — closing the window hides it), so "check on launch" alone would
 * mean a copy that has been running since March has never asked. Six hours
 * is four requests a day against a 300s-cached, unauthenticated endpoint —
 * cheap enough not to think about, frequent enough that a newly-raised
 * `minimum` reaches everyone the same day.
 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface DesktopUpdate {
  /** `current` until a check proves otherwise — see `useDesktopUpdate`. */
  state: DesktopUpdateState;
  /** The running build, or `null` outside the desktop shell. */
  installed: string | null;
  checking: boolean;
  /**
   * Whether a check has actually completed. `state.status === "current"` is
   * the answer before any check has run as well as after a successful one,
   * and the Settings row needs to tell those apart — "you're up to date" is a
   * claim, not a default.
   */
  checked: boolean;
  /** Re-runs the check now. The "Check for updates" button in Settings. */
  check: () => void;
  /** Opens the server-supplied download page in the system browser. */
  openDownload: () => void;
}

/**
 * EI-147's client half: ask the server how old this build is, and expose the
 * answer to the update bar (`update-banner.tsx`) and the Settings → About
 * row.
 *
 * **Fails towards `current`, always.** No desktop shell, no readable version,
 * an offline check, a 500, a malformed body — every one of those leaves the
 * state at `current` and the UI silent. The alternative failure mode is an
 * app that tells a user it is obsolete because their wifi dropped, and the
 * only cure it can offer is a download they also can't do. See
 * `evaluateUpdate`'s doc comment for the same principle applied one layer
 * down.
 *
 * Deliberately not a context provider. Two independent callers exist (the
 * bar and the Settings row), a check is one small GET against a cached
 * endpoint, and the two are never on screen at once — sharing state between
 * them would cost more wiring than the duplicate request it saves.
 */
export function useDesktopUpdate(): DesktopUpdate {
  const [state, setState] = useState<DesktopUpdateState>({ status: "current" });
  const [installed, setInstalled] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  // Read once and reused: the bundle's version cannot change while it runs,
  // and every later check is one fetch rather than a fetch plus an invoke.
  const versionRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const check = useCallback(() => {
    if (!isDesktopShell() || inFlightRef.current) return;
    inFlightRef.current = true;
    setChecking(true);

    void (async () => {
      try {
        versionRef.current ??= await getShellVersion();
        const version = versionRef.current;
        if (!version) return;
        setInstalled(version);

        const policy = await fetchDesktopVersionPolicy();
        if (!policy) return;
        setState(evaluateUpdate(version, policy));
        setChecked(true);
      } finally {
        inFlightRef.current = false;
        setChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isDesktopShell()) return;

    check();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    // A 426 from `/api/sync/*` is the server saying so directly, rather than
    // this poll noticing hours later. See `CLIENT_OUTDATED_EVENT`.
    window.addEventListener(CLIENT_OUTDATED_EVENT, check);

    return () => {
      clearInterval(timer);
      window.removeEventListener(CLIENT_OUTDATED_EVENT, check);
    };
  }, [check]);

  const openDownload = useCallback(() => {
    if (state.status === "current") return;
    void openDownloadPage(state.downloadUrl).catch((error: unknown) => {
      console.error("[faite] could not open the download page", error);
    });
  }, [state]);

  return { state, installed, checking, checked, check, openDownload };
}
