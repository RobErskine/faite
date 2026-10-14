"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useShouldShowAuthNudges } from "@/lib/auth-nudge";
import { isDesktopShell, startDesktopLogin } from "@/lib/desktop/bridge";
import { dismissWelcomeDialog, isWelcomeDialogDismissed } from "@/lib/onboarding";

/**
 * First-visit explanation for a logged-out board: what Faite is, and that
 * signing up is what makes this device's data durable. Shown once ever per
 * device — dismissing it is permanent, because it explains rather than warns
 * (lib/onboarding.ts; the banner is permanent too since EI-376).
 */
export function WelcomeDialog() {
  const shouldShowNudges = useShouldShowAuthNudges();
  const [open, setOpen] = useState(() => !isWelcomeDialogDismissed());
  /** Initial focus. Sign up comes first in the DOM (see the footer), and the
   * dialog would otherwise focus it — so Enter on arrival would leave for
   * /signup instead of opening the board. */
  const startRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    dismissWelcomeDialog();
    setOpen(false);
  };

  // The embedded webview cannot complete a sign-up itself (D0 §3.7:
  // `tauri://localhost` cannot hold a session cookie) — a click opens the
  // system browser instead of navigating here. See docs/DESKTOP.md §9.
  const handleDesktopSignUp = () => {
    close();
    void startDesktopLogin("signup");
  };

  if (!shouldShowNudges) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent initialFocus={startRef}>
        <DialogHeader>
          <DialogTitle>Welcome to Faite</DialogTitle>
          <DialogDescription>
            Capture to-dos into lists, then drag them onto a day to commit to
            doing them. Missed items roll to the next day and eventually land in
            Overflow.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You&apos;re using it right now with no account. Everything you add
          lives offline, only in this browser. Create a free account and it&apos;s
          saved to you, not just this device.
        </p>
        {/*
          Starting is the primary action, signing up the secondary one
          (EI-376). The board needs no account (PRODUCT.md), so the filled
          button is the one that opens it; Sign up stays one click away here,
          in the header, and in the account menu. Primary last: the footer is
          `flex-col-reverse` on a phone, so it lands on top there and on the
          right everywhere else.
        */}
        <DialogFooter>
          {isDesktopShell() ? (
            <Button variant="outline" onClick={handleDesktopSignUp}>
              Sign up
            </Button>
          ) : (
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/signup" />}
              onClick={close}
            >
              Sign up
            </Button>
          )}
          <Button ref={startRef} onClick={close}>
            Start planning
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
