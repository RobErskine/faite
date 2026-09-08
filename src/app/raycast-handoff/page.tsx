"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

type Status = "checking-session" | "ready" | "error";

/**
 * The Raycast extension's one-click connect (A18, EI-298). Reached in the
 * SYSTEM BROWSER after `login`/`signup` redirect here via
 * `?callbackURL=/raycast-handoff`. Mints a one-time code
 * (`/api/raycast/handoff`, cookie-authenticated) and hands the user a button
 * back into Raycast.
 *
 * A deliberate CLICK, not an automatic navigation: browsers can decline to
 * honor a custom-scheme redirect that did not originate from a user gesture.
 * Same reasoning as `desktop-handoff/page.tsx`.
 *
 * `useSearchParams` would need a Suspense boundary under `output: export`;
 * this page reads no query params (see `RAYCAST_DEEP_LINK`), but the boundary
 * stays because `useSession` and the redirect below still benefit from it and
 * removing it is a trap for whoever adds the first param.
 */

/**
 * **Hardcoded, and it must stay that way.**
 *
 * This URL carries a credential-bearing code. Accepting the target from a
 * query param would be an open redirect that hands that code to whatever
 * application has registered an arbitrary custom scheme — the classic
 * authorization-code interception, with the OS's URL dispatch as the
 * confused deputy.
 *
 * `Rob` is the Raycast account handle (raycast.com/Rob) and `faite` the
 * extension's `name` in its `package.json`. Both halves must match the
 * extension exactly or the deep link silently resolves to nothing — no
 * error, the OS just does not dispatch it. Change them together.
 */
const RAYCAST_DEEP_LINK = "raycast://extensions/Rob/faite/connect-account";

/**
 * Raycast deep links do NOT accept arbitrary query params. The documented set
 * is `launchType`, `arguments`, `context` and `fallbackText` — anything else
 * is dropped silently, so an obvious-looking `?code=…` would produce a link
 * that opens the command with no code and no error to explain why.
 *
 * `context` is the right channel: it arrives as `props.launchContext` in the
 * command, it is URL-encoded JSON, and unlike `arguments` it does not require
 * declaring a matching argument in the manifest.
 */
function deepLinkFor(code: string): string {
  const context = encodeURIComponent(JSON.stringify({ code }));
  return `${RAYCAST_DEEP_LINK}?context=${context}`;
}

function RaycastHandoffForm() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<Status>("checking-session");
  const [deepLink, setDeepLink] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      router.replace(`/login?callbackURL=${encodeURIComponent("/raycast-handoff")}`);
      return;
    }

    let canceled = false;

    void fetch("/api/raycast/handoff", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((body: { code: string }) => {
        if (canceled) return;
        setDeepLink(deepLinkFor(body.code));
        setStatus("ready");
      })
      .catch(() => {
        if (!canceled) setStatus("error");
      });

    return () => {
      canceled = true;
    };
  }, [isPending, session, router]);

  if (status === "error") {
    return (
      <AuthShell
        title="Couldn't connect Raycast"
        description="Something went wrong minting a sign-in code."
      >
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
        description="Click below to finish connecting Raycast to Faite."
      >
        <Button className="w-full" nativeButton={false} render={<a href={deepLink} />}>
          Continue to Raycast
        </Button>
      </AuthShell>
    );
  }

  return <AuthShell title="Connecting Raycast…" description="One moment.">{null}</AuthShell>;
}

export default function RaycastHandoffPage() {
  return (
    <Suspense fallback={null}>
      <RaycastHandoffForm />
    </Suspense>
  );
}
