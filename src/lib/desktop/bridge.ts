import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { hostname } from "@tauri-apps/plugin-os";
import { openUrl } from "@tauri-apps/plugin-opener";
import { apiUrl } from "@/lib/api-origin";

/**
 * The seam between "running in the Tauri desktop shell" and "running in a
 * regular browser tab" (or, at P7, Capacitor's WebView — this check is
 * Tauri-specific, not "is this some native shell or other"). One place to
 * gate desktop-only UI instead of every call site re-deriving "am I in
 * Tauri" its own way.
 *
 * `NEXT_PUBLIC_APP_SHELL` (see `src/app/page.tsx`) is a *build-time* flag —
 * "this bundle is the `output: export` app-shell build" — set for both the
 * Capacitor and desktop targets alike. `isDesktopShell()` is the
 * complementary *runtime* check: it answers "is this specific page load
 * happening inside Tauri's webview right now", which the build flag alone
 * can't tell you (an app-shell build's static files are also just files on
 * disk — nothing stops someone opening `board.html` in a plain browser).
 *
 * Backed by `@tauri-apps/api/core`'s own `isTauri()`, which checks
 * `globalThis.isTauri` (a flag Tauri's webview injects) rather than sniffing
 * `window.__TAURI__` directly — the latter is only present when
 * `tauri.conf.json`'s `app.withGlobalTauri` is on, which D1 deliberately
 * turned off (see docs/DESKTOP.md §5) in favor of this typed surface. Safe
 * to call during SSR/prerender: `globalThis` always exists, so this just
 * resolves to `false` off the client.
 */
export function isDesktopShell(): boolean {
  return isTauri();
}

/**
 * D2a's login/signup entry point. Opens the SYSTEM BROWSER to the normal
 * login or signup page — never navigates the embedded webview there —
 * because `tauri://localhost` cannot complete a Better Auth sign-in at all
 * (D0 §3.7: no cookie can ever be set for that origin). Every "sign in" /
 * "sign up" affordance in the app (`app-header.tsx`, `welcome-dialog.tsx`,
 * `signed-out-banner.tsx`) calls this instead of rendering a plain `<Link>`
 * once `isDesktopShell()` is true. `callbackURL=/desktop-handoff` is what
 * routes the browser back to the page that mints the handoff code; see
 * `login/page.tsx`/`signup/page.tsx` and `desktop-handoff/page.tsx`.
 *
 * `apiUrl()` (not a hardcoded `https://myfaite.app`) so this resolves
 * against whatever `NEXT_PUBLIC_AUTH_URL` this build was baked with — the
 * same mechanism `auth-client.ts` already uses, not a second copy of that
 * decision (see the `.env.local` lesson in `.ai/lessons.md`).
 *
 * EI-261: reads the OS hostname and folds it into `callbackURL`'s own query
 * string — `?device=<hostname>` — rather than a second top-level param,
 * because `callbackURL` is the one value Better Auth's post-sign-in
 * redirect and `login/page.tsx`'s `router.push(callbackURL)` both carry
 * through VERBATIM as an opaque string; a sibling param would not survive
 * that hop. `desktop-handoff/page.tsx` reads it back out and sends it on to
 * `/api/desktop/handoff`, which uses it only as a display label for the
 * minted key (`desktopKeyName` in `desktop/routes.ts`) — never anything
 * more, see that function's doc comment. `hostname()` failing (no
 * `os:allow-hostname` grant, or the plugin genuinely has nothing to report)
 * degrades to the unlabeled handoff this flow always used, rather than
 * blocking sign-in over a display nicety.
 */
export async function startDesktopLogin(page: "login" | "signup" = "login"): Promise<void> {
  const deviceName = await hostname().catch(() => null);
  const callbackPath = deviceName
    ? `/desktop-handoff?device=${encodeURIComponent(deviceName)}`
    : "/desktop-handoff";
  await openUrl(apiUrl(`/${page}?callbackURL=${encodeURIComponent(callbackPath)}`));
}

/** OS-keychain read (`src-tauri/src/keychain.rs`) — never `localStorage`
 * (decision #3, docs/DESKTOP.md §2). `null` for "signed out", not an error. */
export async function getStoredAuthToken(): Promise<string | null> {
  return invoke<string | null>("get_auth_token");
}

export async function setStoredAuthToken(token: string): Promise<void> {
  await invoke("set_auth_token", { token });
}

export async function clearStoredAuthToken(): Promise<void> {
  await invoke("clear_auth_token");
}

/**
 * Extracts the one-time handoff code from a `faite://auth-callback?code=…`
 * URL. `null` for anything that isn't that shape — a malformed URL, a
 * different path, no `code` param — so callers can silently ignore a deep
 * link that isn't this one rather than assuming every open-URL event is a
 * login callback.
 */
export function parseAuthCallbackUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "faite:" || parsed.hostname !== "auth-callback") return null;
  const code = parsed.searchParams.get("code");
  return code && code.length > 0 ? code : null;
}

/**
 * Wires up both halves of receiving the deep link: `getCurrent()` for a
 * cold start (the OS launched the app because of this URL) and
 * `onOpenUrl()` for while the app is already running (the overwhelmingly
 * common case — the app is a dock-resident background process per D1.5, so
 * a login click almost always finds it already alive). Fires `handler` with
 * the raw URL string for each; `parseAuthCallbackUrl` is a separate step so
 * a caller can log/ignore a non-matching deep link instead of this function
 * silently swallowing it.
 *
 * Returns the `onOpenUrl` unlisten function. Nothing currently calls it —
 * this only ever mounts once for the app's lifetime (`desktop-auth-provider.tsx`)
 * — but returning it rather than dropping it keeps the option open instead
 * of closing it off.
 */
export async function onDesktopAuthCallback(handler: (url: string) => void): Promise<() => void> {
  const current = await getCurrent();
  if (current) {
    for (const url of current) handler(url);
  }
  return onOpenUrl((urls) => {
    for (const url of urls) handler(url);
  });
}

/**
 * The version baked into the running `.app` — `src-tauri/tauri.conf.json`'s
 * `version`, which is also its `CFBundleShortVersionString`. EI-147's build
 * check compares this against what the server calls the newest build.
 *
 * A core Tauri command, not a plugin: `core:default` already grants
 * `core:app:allow-version` (`src-tauri/gen/schemas/acl-manifests.json`), so
 * this needs no capability change.
 *
 * `null` off the desktop shell rather than a throw. `getVersion()` is an
 * `invoke` under the hood, and in a plain browser tab there is nothing to
 * invoke — every caller of this is desktop-only anyway, and a nullable
 * return lets them stay a single code path instead of branching on
 * `isDesktopShell()` twice.
 */
export async function getShellVersion(): Promise<string | null> {
  if (!isDesktopShell()) return null;
  try {
    return await getVersion();
  } catch (error) {
    console.error("[faite] could not read the desktop app version", error);
    return null;
  }
}

/**
 * Opens the download page in the SYSTEM browser — the same reason
 * `startDesktopLogin` does: the embedded webview would navigate away from
 * the board, and downloading a `.dmg` inside it leads nowhere useful.
 *
 * The URL is server-supplied (`/api/desktop/version`), so it is checked
 * twice before it gets here: `parseVersionPolicy` requires the app's own
 * origin, and Tauri's `opener:allow-open-url` allow-list
 * (`src-tauri/capabilities/default.json`) refuses anything else regardless.
 */
export async function openDownloadPage(url: string): Promise<void> {
  await openUrl(url);
}

/** What the shell is serving right now, and what it will serve next launch. */
export interface HotAssetStatus {
  /** Active bundle version, or `null` when running the copy inside the binary. */
  active: string | null;
  /** Bundle verified and waiting for the next launch. */
  staged: string | null;
  /** The shell's own version, for `minShellVersion` decisions. */
  shell: string;
}

export async function getHotAssetStatus(): Promise<HotAssetStatus | null> {
  if (!isDesktopShell()) return null;
  try {
    return await invoke<HotAssetStatus>("hot_assets_status");
  } catch (error) {
    console.error("[faite] could not read hot-asset status", error);
    return null;
  }
}

/**
 * Offers a manifest to the shell and asks whether the archive is worth
 * fetching (EI-256).
 *
 * **The shell decides, not this side.** It is what activates bundles, so it
 * owns the questions of whether the version is new, whether an equal bundle is
 * already staged, and whether `minShellVersion` outranks it. Answering here
 * would put that policy in two places, and the copy that mattered would be
 * whichever one was wrong.
 *
 * `false` is the ordinary answer — most checks find nothing new — and never an
 * error worth surfacing.
 */
export async function prepareHotAssetBundle(manifestJson: string): Promise<boolean> {
  if (!isDesktopShell()) return false;
  try {
    return await invoke<boolean>("hot_assets_prepare", { manifest: manifestJson });
  } catch (error) {
    console.error("[faite] could not prepare a hot-asset bundle", error);
    return false;
  }
}

/**
 * Hands the downloaded archive to the shell, which verifies it whole before
 * anything becomes activatable — see `hot_assets/manifest.rs`.
 *
 * The bytes are sent as a plain number array because that is what Tauri's IPC
 * serialises reliably across versions. It is ~3.8 MB, a few times a week at
 * most, on a path the user is not waiting on.
 *
 * Resolves to the staged version, or `null` if the shell rejected it. A
 * rejection is not an error to show anyone: the app keeps running the bundle
 * it already has, which is exactly the intended outcome.
 */
export async function stageHotAssetBundle(archive: ArrayBuffer): Promise<string | null> {
  if (!isDesktopShell()) return null;
  try {
    return await invoke<string>("hot_assets_stage", { archive: Array.from(new Uint8Array(archive)) });
  } catch (error) {
    console.error("[faite] could not stage a hot-asset bundle", error);
    return null;
  }
}

/**
 * Tells the shell this frontend actually came up, clearing a newly activated
 * bundle's probation (EI-257).
 *
 * **Call after the board has rendered, not on load.** The failure being
 * guarded against is "the HTML arrived and the app never started" — reporting
 * any earlier would confirm success for precisely the case that must fail, and
 * a broken bundle would never be rolled back.
 *
 * Deliberately swallows everything. A shell that cannot record this will retry
 * the bundle next launch and, if it keeps hearing nothing, roll it back — the
 * safe direction. Nothing here is worth surfacing to a user.
 */
export async function reportFrontendReady(): Promise<void> {
  if (!isDesktopShell()) return;
  try {
    await invoke("hot_assets_ready");
  } catch {
    // See above: silence is the correct behaviour, not an oversight.
  }
}
