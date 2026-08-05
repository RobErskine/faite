"use client";

import { useSession } from "@/lib/auth-client";
import { getBoundOwnerId } from "@/lib/store/owner";

/**
 * Whether to show sign-up nudges: the welcome dialog, the "this device only"
 * banner, and the header's Sign up CTA.
 *
 * `useSession()` alone is not enough. Offline, its fetch fails and resolves to
 * `data: null` — indistinguishable from a genuine "you are not signed in".
 * Showing "create an account, your data isn't saved" to someone who IS signed
 * in but offline would be actively wrong, not merely an inconvenience (the
 * whole point of ARCHITECTURE §2.4 is that this app works offline). `error`
 * is what tells the two apart: a clean `null` with no error is a confirmed
 * answer; a `null` WITH an error is a failed check, not a real session state.
 *
 * `getBoundOwnerId()` (owner.ts) is read plainly, not subscribed to — it only
 * matters for this one offline-cold-start disambiguation. Any in-page
 * sign-in/out transition is already covered live, because `useSession()`'s
 * underlying store updates immediately and reliably on an explicit action
 * (unlike the cold-start fetch, signing in or out is not a network race).
 */
export function useShouldShowAuthNudges(): boolean {
  const { data: session, isPending, error } = useSession();

  if (isPending) return false;
  if (session) return false;
  if (error && getBoundOwnerId()) return false;
  return true;
}
