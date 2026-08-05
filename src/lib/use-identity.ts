"use client";

import { useSession } from "@/lib/auth-client";
import type { IdentityFallback } from "@/lib/profile";

/**
 * The signed-in account's name/email, for `resolveAvatar`'s fallback.
 *
 * Split from `lib/profile.ts` so that module stays React- and DOM-free (it is
 * reachable from `lib/schema.ts`, which the Workers tsconfig compiles with
 * `lib: ["esnext"]`).
 *
 * Unlike `useShouldShowAuthNudges` (lib/auth-nudge.ts) this does NOT need to
 * disambiguate "offline" from "signed out": the consequence of guessing wrong
 * is a header briefly reading "Local User" instead of a name, not a false
 * claim that someone's data is unsaved. Returning undefined on a failed
 * session check is the right amount of caution here.
 */
export function useIdentity(): IdentityFallback | undefined {
  const { data: session } = useSession();
  return session?.user;
}
