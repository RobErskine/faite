import { createAuthClient } from "better-auth/react";
import { getStoredAuthToken, isDesktopShell } from "./desktop/bridge";
import { resolveApiBaseURL } from "./api-origin";

/**
 * Kept as a named export because auth was the first consumer and
 * `auth-client.test.ts` pins the behaviour here. The implementation moved to
 * `api-origin.ts` once `/api/places/*` needed the identical decision (EI-83) —
 * one copy, because the localhost guard inside it is a postmortem, not a
 * convenience, and a forked copy is exactly how that postmortem repeats.
 */
export { resolveApiBaseURL as resolveAuthBaseURL } from "./api-origin";

/**
 * D2a: the desktop shell has no cookie for its own webview origin
 * (`tauri://localhost` — see docs/DESKTOP.md §7.4/§9), so every request this
 * client makes needs its bearer token attached instead. `fetchOptions.auth`
 * accepts an async `token` function — better-fetch (Better Auth's client
 * transport) calls it fresh per request and omits the `Authorization` header
 * entirely when it resolves to `undefined` — so this is a genuine no-op for
 * the ordinary browser case, not a second auth path layered on top of
 * cookies. The token itself lives only in the OS keychain (`bridge.ts`),
 * never here and never in `localStorage`.
 */
async function desktopBearerToken(): Promise<string | undefined> {
  if (!isDesktopShell()) return undefined;
  return (await getStoredAuthToken()) ?? undefined;
}

export const authClient = createAuthClient({
  baseURL: resolveApiBaseURL(
    process.env.NEXT_PUBLIC_AUTH_URL,
    typeof window === "undefined" ? null : window.location.hostname,
  ),
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: desktopBearerToken,
    },
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;
