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
 * Shared by the web link and the desktop button below: the shared focus ring
 * (not the browser's default outline), and a 24px-tall hit area that the
 * line box alone does not give a `text-xs`/`text-sm` word. The `::after`
 * grows the target without growing the banner (same technique as
 * `ui/checkbox.tsx`).
 */
const SIGN_UP_LINK =
  "focus-ring relative rounded-sm font-medium underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-1.5";

/**
 * "This device only" notice. Gated on `hasUserData` rather than always shown
 * logged-out: on an empty board there is nothing to lose yet, so the notice
 * is noise; once there is real data, it's the moment the message actually
 * lands.
 *
 * EI-376: information, not a warning — the info status tone, not the yellow
 * one (docs/DESIGN.md §1), because nothing is wrong: the board works fully
 * without an account (PRODUCT.md). Dismissal is permanent on this device
 * (lib/onboarding.ts) — Faite says this once, not every visit. The copy is
 * one line at phone width: the phone shell gets the short form, wider
 * screens the full sentence, with the same two facts in both.
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
    <div
      className="flex items-center gap-2 border-b bg-info-soft px-3 py-1.5 text-xs text-info-foreground sm:gap-3 sm:px-4 sm:py-2 sm:text-sm"
    >
      <p className="min-w-0 flex-1">
        <span className="sm:hidden">Only on this device.</span>
        <span className="hidden sm:inline">Your board is saved on this device only.</span>{" "}
        {isDesktopShell() ? (
          // The embedded webview cannot complete a sign-up itself (D0 §3.7:
          // `tauri://localhost` cannot hold a session cookie) — a click
          // opens the system browser instead. See docs/DESKTOP.md §9.
          <button
            type="button"
            className={SIGN_UP_LINK}
            onClick={() => void startDesktopLogin("signup")}
          >
            Sign up
          </button>
        ) : (
          <Link href="/signup" className={SIGN_UP_LINK}>
            Sign up
          </Link>
        )}{" "}
        to sync it<span className="hidden sm:inline"> to your other devices</span>.
      </p>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={close}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
