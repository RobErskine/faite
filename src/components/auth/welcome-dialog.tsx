"use client";

import { useState } from "react";
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
import { dismissWelcomeDialog, isWelcomeDialogDismissed } from "@/lib/onboarding";

/**
 * First-visit explanation for a logged-out board: what Faite is, and that
 * signing up is what makes this device's data durable. Shown once ever per
 * device — dismissing it is permanent, not per-session, because it explains
 * rather than warns (see lib/onboarding.ts for why that's a different storage
 * tier than the banner).
 */
export function WelcomeDialog() {
  const shouldShowNudges = useShouldShowAuthNudges();
  const [open, setOpen] = useState(() => !isWelcomeDialogDismissed());

  const close = () => {
    dismissWelcomeDialog();
    setOpen(false);
  };

  if (!shouldShowNudges) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
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
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Continue without an account
          </Button>
          <Button nativeButton={false} render={<Link href="/signup" />} onClick={close}>
            Sign up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
