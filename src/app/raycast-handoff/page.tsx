"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { isAllowedRaycastRedirect } from "@/lib/raycast-redirect";

type Status = "checking-session" | "ready" | "error";

/**
 * The Raycast extension's sign-in (A18/EI-298, reshaped by EI-310).
 *
 * This is the AUTHORIZATION ENDPOINT of an OAuth-shaped flow. Raycast's
 * `OAuth.PKCEClient` opens it in the system browser with `redirect_uri` and
 * `state`; once the user is signed in, it mints a key, wraps it in a
 * short-lived encrypted code, and redirects back with that code.
 *
 * It is shaped this way rather than as a `raycast://` deep link because
 * Raycast renders its own "Logged into Faite / Logout" row in the extension's
 * settings — but only for an extension that authenticates through a
 * `PKCEClient`. Going through the real OAuth surface is what buys that,
 * along with the sign-in overlay and token storage. An extension-owned
 * "Connect Account" command, which is what this replaced, is not a shape any
 * other Raycast extension uses.
 *
 * ## What this is NOT
 *
 * **A real authorization server.** `code_challenge` is accepted and ignored;
 * nothing here verifies PKCE. Do not read this as OAuth and assume the
 * guarantees that come with it.
 *
 * What actually protects the code: it is AES-GCM encrypted under a key
 * derived from `BETTER_AUTH_SECRET`, TTL-bounded to 60 seconds, minted only
 * for a live cookie session, domain-separated from the desktop flow's codes
 * (`handoff-code.ts`), and — see below — only ever handed to a redirect URI
 * on a fixed allow-list.
 */

function RaycastHandoffForm() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>("checking-session");
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  const redirectUri = params.get("redirect_uri");
  // Echoed back untouched. `PKCEClient` generated it and verifies it on the
  // way back, which is what makes the round trip tamper-evident — this page
  // neither reads nor trusts it.
  const state = params.get("state");

  // Derived during render, not in an effect: it depends only on the URL, and
  // routing it through state would both trip `set-state-in-effect` and let a
  // frame render as though the request were legitimate.
  const redirectAllowed = isAllowedRaycastRedirect(redirectUri);

  useEffect(() => {
    if (isPending || !redirectAllowed) return;

    if (!session) {
      const callbackURL = `/raycast-handoff?${params.toString()}`;
      router.replace(`/login?callbackURL=${encodeURIComponent(callbackURL)}`);
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

        // `raycast.com/redirect` already carries `?packageName=…`, so build
        // this with the URL API rather than string-concatenating a `?`.
        const target = new URL(redirectUri as string);
        target.searchParams.set("code", body.code);
        if (state) target.searchParams.set("state", state);

        setRedirectTo(target.toString());
        setStatus("ready");
      })
      .catch(() => {
        if (!canceled) setStatus("error");
      });

    return () => {
      canceled = true;
    };
  }, [isPending, session, router, redirectUri, redirectAllowed, state, params]);

  // Terminal, and checked before anything else. Falling back to a default
  // target would mean a request carrying a hostile `redirect_uri` still mints
  // a key — which is the entire thing this guards against.
  if (!redirectAllowed) {
    return (
      <AuthShell
        title="That sign-in link isn't valid"
        description="Start the connection from Raycast rather than opening this page directly."
      >
        {null}
      </AuthShell>
    );
  }

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

  if (status === "ready" && redirectTo) {
    return (
      <AuthShell title="You're signed in" description="Click below to finish connecting Raycast.">
        {/* A deliberate click, not an automatic navigation: browsers can
            decline to honor a redirect that did not come from a user gesture,
            and Raycast's own overlay expects the user to be driving. */}
        <Button className="w-full" nativeButton={false} render={<a href={redirectTo} />}>
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
