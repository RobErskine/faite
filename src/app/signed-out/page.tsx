"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { isDesktopShell, startDesktopLogin } from "@/lib/desktop/bridge";

/**
 * Where sign-out lands in an app-shell build (`NEXT_PUBLIC_APP_SHELL=1` —
 * Tauri and Capacitor).
 *
 * The web build has no need for this: it sends people to `/`, the marketing
 * page, which already carries "Log in" and "Sign up". An app shell has no
 * marketing page — `/` is an unconditional redirect stub to `/board`
 * (`app/page.tsx`) — so without this route, sign-out could only reload
 * `board.html` and put the user straight back on a board, which is the thing
 * signing out is supposed to stop.
 *
 * **Not `login.html`, even though the static export contains one.** The
 * embedded webview cannot complete a sign-in: `tauri://localhost` cannot hold
 * a session cookie (docs/DESKTOP.md §3.7), which is why every sign-in
 * affordance in the app opens the SYSTEM BROWSER once `isDesktopShell()` is
 * true (§9.1). Navigating here to a real login form would be a form that can
 * never succeed.
 *
 * **Not a gate, either.** ARCHITECTURE §2.13 is deliberate: the board works
 * fully without an account, offline, and that is as true in the desktop app
 * as in a tab. So this is where sign-out *lands*, not a wall around `/board`
 * — hence "Continue without an account", which is the honest description of
 * what the board still is.
 */
export default function SignedOut() {
  const [opening, setOpening] = useState(false);

  const handleDesktopSignIn = async () => {
    setOpening(true);
    try {
      await startDesktopLogin();
    } catch (error) {
      console.error("[faite] couldn't open the system browser for sign-in", error);
      toast.error("Couldn't open your browser to sign in.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <AuthShell
      title="You're signed out"
      description="This device's board has been erased. Signing back in restores it from your account."
      footer={
        <Link href="/board" className="underline underline-offset-4">
          Continue without an account
        </Link>
      }
    >
      <div className="space-y-3">
        {isDesktopShell() ? (
          <>
            <Button
              className="w-full"
              disabled={opening}
              onClick={() => void handleDesktopSignIn()}
            >
              {opening ? "Opening your browser…" : "Sign in"}
            </Button>
            {/* Set expectations before the window appears, rather than
                leaving the jump to the system browser looking like a bug. */}
            <p className="text-center text-xs text-muted-foreground">
              Sign-in opens in your browser, then returns you to Faite.
            </p>
          </>
        ) : (
          <Button className="w-full" nativeButton={false} render={<Link href="/login" />}>
            Sign in
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
