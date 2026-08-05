import { createAuthClient } from "better-auth/react";

/**
 * `NEXT_PUBLIC_AUTH_URL` is only needed when the UI and the auth backend run on
 * different origins — `next dev` (:3000) talking to `npm run preview`'s worker
 * (its own port), or Capacitor's `capacitor://localhost` WebView at P7.
 * Unset in production and in `npm run preview` itself: same origin, so
 * `baseURL: undefined` resolves relative to wherever the page is served.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL || undefined,
});

export const { useSession, signIn, signUp, signOut } = authClient;
