"use client";

import { useEffect } from "react";
import { reportFrontendReady } from "@/lib/desktop/bridge";

/**
 * Reports to the shell that this frontend rendered, clearing a newly activated
 * hot-asset bundle's probation (EI-257).
 *
 * ## Why this sits in the root layout
 *
 * A bundle that never signals is rolled back and then refused *forever* —
 * versions are content hashes, so a wrongly-condemned frontend can never be
 * retried. That makes a false negative expensive, and it rules out every
 * narrower mount point:
 *
 * - the **board** is not rendered when the desktop app lands on its
 *   signed-out screen, and a user who stays signed out across two launches
 *   would lose a perfectly good bundle;
 * - `DesktopAuthProvider` has the same problem for the same reason.
 *
 * The root layout renders on every route the shell can possibly open, so
 * "this component mounted" means exactly what the shell needs to know: React
 * is running and the app came up.
 *
 * ## Why an effect, and not the module body
 *
 * `useEffect` runs after the commit, so it fires only once React has actually
 * rendered something. Module-level code would run during parsing — which is
 * precisely the state that must be treated as a failure, because it is what
 * a bundle that white-screens also reaches.
 *
 * Renders nothing, and does nothing at all outside the desktop shell.
 */
export function DesktopFrontendReady() {
  useEffect(() => {
    void reportFrontendReady();
  }, []);

  return null;
}
