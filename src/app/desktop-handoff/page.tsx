"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

type Status = "checking-session" | "ready" | "error";

/**
 * D2a's handoff page. Reached in the SYSTEM BROWSER (never inside the Tauri
 * webview — see `docs/DESKTOP.md` §9) after `login`/`signup` redirect here
 * via `?callbackURL=/desktop-handoff` (EI-261: sometimes with an additional
 * `?device=` — see below). Mints a one-time code (`/api/desktop/handoff`,
 * cookie-authenticated) and hands the user a button to continue into the
 * app — a deliberate click, not an automatic navigation, since browsers can
 * decline to honor a custom-scheme redirect that didn't originate from a
 * user gesture. See `handoff-code.ts` for why the code is an encrypted
 * indirection rather than the real API key.
 *
 * `useSearchParams` needs a Suspense boundary under `output: export` — same
 * as `login/page.tsx`.
 */
function DesktopHandoffForm() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<Status>("checking-session");
  const [deepLink, setDeepLink] = useState<string | null>(null);

  // Set by `bridge.ts`'s `startDesktopLogin()` before it ever opens the
  // browser — the Tauri shell's OS hostname, riding in `callbackURL`'s own
  // query string the whole way through Better Auth's post-sign-in redirect.
  // `null` for an old desktop build that predates this, a signup landing
  // here some other way, or anyone hitting this page directly — the handoff
  // still works, the key is just unlabeled (`desktopKeyName` server-side).
  const deviceName = useSearchParams().get("device");

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      const callbackURL = deviceName
        ? `/desktop-handoff?device=${encodeURIComponent(deviceName)}`
        : "/desktop-handoff";
      router.replace(`/login?callbackURL=${encodeURIComponent(callbackURL)}`);
      return;
    }

    let cancelled = false;

    void fetch("/api/desktop/handoff", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName }),
    })
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
  }, [isPending, session, router, deviceName]);

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

export default function DesktopHandoffPage() {
  return (
    <Suspense fallback={null}>
      <DesktopHandoffForm />
    </Suspense>
  );
}
