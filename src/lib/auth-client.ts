import { createAuthClient } from "better-auth/react";
import { resolveApiBaseURL } from "./api-origin";

/**
 * Kept as a named export because auth was the first consumer and
 * `auth-client.test.ts` pins the behaviour here. The implementation moved to
 * `api-origin.ts` once `/api/places/*` needed the identical decision (EI-83) —
 * one copy, because the localhost guard inside it is a postmortem, not a
 * convenience, and a forked copy is exactly how that postmortem repeats.
 */
export { resolveApiBaseURL as resolveAuthBaseURL } from "./api-origin";

export const authClient = createAuthClient({
  baseURL: resolveApiBaseURL(
    process.env.NEXT_PUBLIC_AUTH_URL,
    typeof window === "undefined" ? null : window.location.hostname,
  ),
});

export const { useSession, signIn, signUp, signOut } = authClient;
