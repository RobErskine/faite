"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { apiUrl } from "@/lib/api-origin";
import { useSession } from "@/lib/auth-client";
import {
  isDesktopShell,
  onDesktopAuthCallback,
  parseAuthCallbackUrl,
  setStoredAuthToken,
} from "@/lib/desktop/bridge";

/**
 * D2a: completes the desktop login handoff. Listens for
 * `faite://auth-callback` (`bridge.ts`'s `onDesktopAuthCallback`), exchanges
 * the one-time code for the real bearer token (`/api/desktop/exchange`),
 * and stores it in the OS keychain. `refetch()` is what makes the effect
 * visible — `auth-client.ts` already attaches the (now-present) token to
 * every request, so the very next `getSession()` call, this one, comes back
 * signed in, and every consumer of `useSession()` (this component's own
 * caller `Board`, `app-header.tsx`, `SessionProvider`) re-renders from that
 * one state change.
 *
 * Mounted once from `Board`, same pattern as `SessionProvider`/`SyncProvider`
 * — gated on `isDesktopShell()` here rather than at the call site, so
 * `Board` doesn't need its own desktop-awareness.
 */
export function DesktopAuthProvider() {
  const { refetch } = useSession();

  useEffect(() => {
    if (!isDesktopShell()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function exchange(code: string): Promise<void> {
      const response = await fetch(apiUrl("/api/desktop/exchange"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error(`exchange responded ${response.status}`);
      const body: { token: string } = await response.json();
      await setStoredAuthToken(body.token);
      refetch();
      toast.success("Signed in to Faite");
    }

    void onDesktopAuthCallback((url) => {
      const code = parseAuthCallbackUrl(url);
      if (!code) return;
      exchange(code).catch((error: unknown) => {
        console.error("[faite] desktop auth exchange failed", error);
        toast.error("Couldn't finish signing in — try again from the account menu.");
      });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refetch]);

  return null;
}
