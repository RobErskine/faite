"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShouldShowAuthNudges } from "@/lib/auth-nudge";
import { isDesktopShell, startDesktopLogin } from "@/lib/desktop/bridge";
import { dismissBanner, isBannerDismissed } from "@/lib/onboarding";

interface SignedOutBannerProps {
  /** Whether the board holds anything the visitor would actually lose. */
  hasUserData: boolean;
}

/**
 * "This device only" warning. Gated on `hasUserData` rather than always shown
 * logged-out: on an empty board there is nothing to lose yet, so the warning
 * is noise; once there is real data, it's the moment the message actually
 * lands. Dismissal is per-session (lib/onboarding.ts) — it is a standing
 * warning, not a one-time explanation, so it returns on the next visit.
 */
export function SignedOutBanner({ hasUserData }: SignedOutBannerProps) {
  const shouldShowNudges = useShouldShowAuthNudges();
  const [dismissed, setDismissed] = useState(isBannerDismissed);

  if (!shouldShowNudges || !hasUserData || dismissed) return null;

  const close = () => {
    dismissBanner();
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="flex-1">
        You&apos;re not signed in — this board only exists on this device.{" "}
        {isDesktopShell() ? (
          // The embedded webview cannot complete a sign-up itself (D0 §3.7:
          // `tauri://localhost` cannot hold a session cookie) — a click
          // opens the system browser instead. See docs/DESKTOP.md §9.
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => void startDesktopLogin("signup")}
          >
            Sign up
          </button>
        ) : (
          <Link href="/signup" className="font-medium underline underline-offset-2">
            Sign up
          </Link>
        )}{" "}
        to save it.
      </span>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={close}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
