"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

type Status = "checking-session" | "ready" | "error";

/**
 * D2a's handoff page. Reached in the SYSTEM BROWSER (never inside the Tauri
 * webview — see `docs/DESKTOP.md` §9) after `login`/`signup` redirect here
 * via `?callbackURL=/desktop-handoff`. Mints a one-time code
 * (`/api/desktop/handoff`, cookie-authenticated) and hands the user a button
 * to continue into the app — a deliberate click, not an automatic
 * navigation, since browsers can decline to honor a custom-scheme redirect
 * that didn't originate from a user gesture. See `handoff-code.ts` for why
 * the code is an encrypted indirection rather than the real API key.
 */
export default function DesktopHandoffPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<Status>("checking-session");
  const [deepLink, setDeepLink] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace("/login?callbackURL=%2Fdesktop-handoff");
      return;
    }

    let cancelled = false;

    void fetch("/api/desktop/handoff", { method: "POST", credentials: "include" })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: { code: string }) => {
        if (cancelled) return;
        setDeepLink(`faite://auth-callback?code=${encodeURIComponent(body.code)}`);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isPending, session, router]);

  if (status === "error") {
    return (
      <AuthShell title="Couldn't connect Faite" description="Something went wrong minting a sign-in code.">
        <Button className="w-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  if (status === "ready" && deepLink) {
    return (
      <AuthShell
        title="You're signed in"
        description="Click below to return to the Faite app."
      >
        <Button className="w-full" nativeButton={false} render={<a href={deepLink} />}>
          Continue to Faite
        </Button>
      </AuthShell>
    );
  }

  return <AuthShell title="Signing you in…" description="One moment.">{null}</AuthShell>;
}
