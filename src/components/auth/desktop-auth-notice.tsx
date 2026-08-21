"use client";

import { useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { startDesktopLogin } from "@/lib/desktop/bridge";

/**
 * What `/login` and `/signup` render INSTEAD of their form when they're
 * reached inside the Tauri webview (D2a, docs/DESKTOP.md §9).
 *
 * Those pages ship in the static export, so they're reachable from inside
 * the desktop shell — via the signup↔login footer links, "Forgot password?",
 * or `reset-password`'s redirect — even though every entry point that leads
 * to them has been made desktop-aware. And a sign-in attempted there cannot
 * ever succeed: the form posts fine and reports a wrong password correctly,
 * but `tauri://localhost` cannot hold the session cookie that comes back
 * (D0 §3.7), so a CORRECT password silently returns to a signed-out board.
 * That failure is worse than an error, because it looks like it worked.
 *
 * So the form is not rendered at all here — the only thing offered is the
 * system-browser flow that actually works.
 */
export function DesktopAuthNotice({ page }: { page: "login" | "signup" }) {
  const [error, setError] = useState(false);

  const open = async () => {
    setError(false);
    try {
      await startDesktopLogin(page);
    } catch (openError) {
      console.error("[faite] couldn't open the system browser", openError);
      setError(true);
    }
  };

  return (
    <AuthShell
      title={page === "signup" ? "Create an account" : "Sign in"}
      description="Faite signs you in through your browser, then brings you back to the app."
    >
      <Button className="w-full" onClick={() => void open()}>
        {page === "signup" ? "Sign up in your browser" : "Sign in in your browser"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t open your browser. Visit{" "}
          <span className="font-medium">myfaite.app</span> to sign in, then
          reopen Faite.
        </p>
      ) : null}
    </AuthShell>
  );
}
