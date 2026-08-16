import { isTauri } from "@tauri-apps/api/core";

/**
 * The seam between "running in the Tauri desktop shell" and "running in a
 * regular browser tab" (or, at P7, Capacitor's WebView — this check is
 * Tauri-specific, not "is this some native shell or other"). Nothing here
 * talks to Rust yet; this is deliberately just the detection primitive
 * D1 needs, so later work (tray, global hotkeys, the menu-bar popover) has
 * one place to gate desktop-only UI instead of every call site re-deriving
 * "am I in Tauri" its own way.
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
