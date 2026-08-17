# Desktop shell (Tauri v2) — working document

**Self-contained handoff.** Everything needed to continue the desktop work on
Faite without re-deriving it. This is a living document, updated as each
milestone ships — read the milestone table below before assuming anything
past D1 exists yet.

> **Numbering.** This document's milestones are **D0…D6** — a separate axis
> from the product roadmap's **P0…P7** and the mobile track's **M-1…M6**
> (`docs/ARCHITECTURE.md` §7, `docs/MOBILE.md`). They do not line up. A bare
> "P<n>"/"M<n>" anywhere in this file means those other axes.

---

## 1. Why, and what

Native macOS (then Windows) apps — not a rewrite, a native shell around the
existing web app — plus two features the web can't do:

- **Feature A — menu bar item.** Status-bar icon → popover listing
  today/overdue to-dos → click one → main window opens on that item.
- **Feature B — context-aware quick capture.** Global hotkey (works when app
  unfocused) → small always-on-top window → new to-do carrying the context of
  whatever the user was looking at (Linear/Jira URL + ticket title, etc).

**The groundwork was already paid for before D0 started.** `npm run
build:static` (`output: "export"` → `.next-static/`) exists and is CI-guarded.
`/board` is `ssr:false` and renders entirely from Dexie — the server is never
a render dependency. The board works fully offline. `capacitor://localhost`
is already in `TRUSTED_ORIGINS`, laid for a future Capacitor mobile shell; a
desktop shell consumes the same offline-first design.

## 2. Locked architecture decisions

Decided before D0 started; D0's job was to stress-test these against a real
build, not to re-litigate them.

1. **Tauri v2**, not Electron. ~10MB bundle vs ~150MB, ~100MB vs ~350MB
   resident. Cost: Rust for tray/hotkey/window management/sidecar spawn/
   keychain (roughly 500–800 lines), plus a Swift helper for context capture —
   this project is not TS-only anymore.
2. **Bundled static export, not remote-load.** `frontendDist` → `.next-static/`
   baked into the `.app`. Rejected: loading `myfaite.app` directly (no offline
   boot, a web deploy could break desktop with no per-platform rollback) and
   load-remote-with-bundled-fallback (two non-deterministic code paths).
3. **Bearer tokens, not cookies**, for the desktop shell's auth. Better Auth
   `bearer` plugin; token in the OS keychain via the `keyring` Rust crate,
   injected as a header from Rust, never in `localStorage`. D0 §7 below is why
   this is closer to mandatory than merely-better.
4. **Menu bar popover: read-on-show, not live-query.** Opened by a click,
   lives seconds — a one-shot Dexie read on `show`, not `useLiveQuery`. Reduces
   the hard requirement to "shared IndexedDB across webviews in one app",
   which D0 §5 below confirms directly. Sync ownership is arbitrated by Rust
   (board window owns the sync engine when open; hands off to a hidden
   background webview when it closes) — **not** by Web Locks or
   `BroadcastChannel` coordination.
5. **Context capture via a Swift sidecar using the Accessibility API**, not
   Screen Recording (gated since 10.15, titles only) or AppleScript
   (per-browser Automation grants, Firefox has none). One permission
   (Accessibility) buys app name + window title + `AXDocumentAttribute` (file
   path) + browser URL via `AXWebArea` → `AXURL`, and generalizes to
   non-browser apps for free. Permission ladder: rung 1 (frontmost app, no
   permission) must be useful on its own; rung 2 (full AX) is additive, asked
   for at first use, not at install.
6. **No Mac App Store.** MAS sandboxing forbids AX-inspecting other apps and
   spawning an unsandboxed sidecar. Developer ID + notarization + self-hosted
   updates, same model as Raycast/Alfred/Bartender/Rectangle Pro.
7. **`src-tauri/` at repo root**, Tauri's own convention, `frontendDist` →
   `../.next-static`. Swift helper as an `externalBin` sidecar (D5, not built
   yet — D0 only has a standalone prototype, see §8 below).

Full rationale, the deep-link (`?todo=`) design, the `todo.source` schema
shape, and the D1–D6 milestone breakdown live in the planning doc this spike
worked from (not checked into the repo — ask Rob for
`i-want-to-start-lucky-sonnet.md` if picking this back up).

---

## 3. D0 spike findings

D0 is throwaway — **nothing here ships**. Its only job was answering the
architecture questions above against a real build before D1+ commits to them.
Everything below is from an actual `cargo build`/`tauri build --debug` run on
this machine, not "should work in theory." The harness that produced these
numbers is `src-tauri/src/d0_probe.rs` — read its doc comment for how it
works; it is explicitly spike-only and not wired into any non-probe build
path (`FAITE_D0_PROBE=1` env var gates it; unset, the app just opens one
window on `/board`, same as D1's shell would).

### 3.1 Tauri shell loads the real static export — **PASS**

`npx tauri init` scaffolded `src-tauri/` with `frontendDist: "../.next-static"`.
`npm run build:static` produces the export with **absolute** `/_next/...`
asset paths, as flagged in the plan doc as a known gotcha — **it's a
non-issue**: Tauri's asset protocol serves `frontendDist` as the document
root at `tauri://localhost/`, so an absolute `/_next/...` path resolves
exactly like it would against any web server whose document root is that same
directory. No `assetPrefix` rewriting needed for production; `next.config.ts`
only needs the conditional `assetPrefix` for the **dev** loop (`next dev` on
`:3000` via `devUrl`), which is the existing documented Next-on-Tauri pattern.

### 3.2 Real board renders and writes to IndexedDB — **PASS, with a load-bearing fix found**

The board **did not render at all** on first attempt. `window.onerror` in
every probe window caught:

```
BetterAuthError: Invalid base URL: tauri://localhost. URL must include 'http://' or 'https://'
```

`src/lib/auth-client.ts` calls `createAuthClient({ baseURL: resolveApiBaseURL(...) })`.
With no `NEXT_PUBLIC_AUTH_URL` set at build time (the normal `npm run
build:static` invocation), `resolveApiBaseURL` returns `undefined`, and Better
Auth's client falls back to `window.location.origin` — which is
`tauri://localhost`, a scheme Better Auth's own URL validation rejects
outright. The error is thrown synchronously during module init in a
client-side chunk, which aborted the whole render tree before the board's
"Add a to-do" input ever mounted.

**Fix, confirmed working:** build the static export with
`NEXT_PUBLIC_AUTH_URL=https://myfaite.app` set. `resolveApiBaseURL`'s
localhost-guard (`src/lib/api-origin.ts`) doesn't strip this — it only strips
`http(s)://localhost`-style overrides, and `https://myfaite.app` isn't one —
so Better Auth gets a real base URL and constructs cleanly. After that:

- The board rendered fully, including the "Add a to-do" input.
- A synthetic keyboard-driven todo creation (native-setter + `input` event +
  `Enter` keydown, the standard React-controlled-input trick) produced a real
  row in Dexie's `faite` IndexedDB database, table `todos`, verified by
  reading it straight out of IndexedDB (not through the app's own code path,
  so this isn't circular).
- **This is a load-bearing finding for D1, not a D0-only workaround.** D1's
  shell config must bake `NEXT_PUBLIC_AUTH_URL=https://myfaite.app` into its
  `build:static` invocation (or an equivalent desktop-specific build step),
  or the shipped app will crash on boot the same way. Suggest a
  `build:static:desktop` npm script, or folding this into
  `beforeBuildCommand` in `tauri.conf.json`, so it can't be forgotten per
  decision #3 (bearer auth) already assuming an explicit, non-same-origin API
  base URL — this makes that assumption a hard requirement, confirmed
  empirically, not just "the cleaner design."

### 3.3 Shared storage across two `WebviewWindow`s — **PASS — the single most important finding**

This gates the whole menu-bar (D3) and sync-ownership (D2) design per the
plan doc's decision #4 / risk #2. Tested with two real, separately-created
`WebviewWindow`s (`board_a`, `board_b`), both loading `/board.html` on
`tauri://localhost`:

| Mechanism | Result |
|---|---|
| IndexedDB — **real app database** (`faite`, table `todos`) | **Shared.** A todo created via the UI in window A was read back — correct title, via a raw cursor scan, no caching layer involved — from window B, opened as a fresh `IndexedDB.open("faite")` connection. |
| IndexedDB — synthetic test database | **Shared.** Same result via a dedicated `d0-probe-db`, kept separate from the app's real data so this harness can never corrupt a real board. |
| `localStorage` | **Shared.** A value set in A was read correctly in B. |
| `BroadcastChannel` | **Shared** (bonus, not required). A message posted in A was received in B within milliseconds. |

**Conclusion: the plan doc's "very likely true (one `WKWebsiteDataStore`)"
guess is confirmed.** The read-on-show menu bar design (decision #4) and
Rust-arbitrated sync ownership (no cross-webview `BroadcastChannel`/Web Locks
dependency needed for correctness, though `BroadcastChannel` is available as
a nice-to-have) can both proceed as designed. The IPC-payload fallback in the
plan doc is **not needed**.

Data also persisted correctly across separate process launches of the probe
binary (a todo created in one run was still present, alongside a new one, in
the next run) — the WKWebsiteDataStore backing this is genuinely persistent,
not per-process.

### 3.4 Background-webview timer proof — **FAIL — a real, negative finding for D2's sync design**

A third window (`hidden_probe`, created with `visible: false`) ran
`setInterval(fn, 5000)` and reported each tick plus
`document.visibilityState`/`document.hidden`.

- `document.visibilityState` reported `"hidden"` / `document.hidden === true`
  throughout, as expected for a non-visible window.
- **The timer fired exactly once** (~5s after being set up) **and then never
  fired again**, confirmed over two separate runs: one waited 50s total, a
  second deliberately waited 110s total (90s past the first tick). Zero
  subsequent ticks in either run.

This looks like WebKit/AppKit throttling or fully suspending JS timers in a
hidden `NSWindow`'s `WKWebView` — similar in spirit to mobile Safari's
background-tab throttling, but here it reads as a hard suspend rather than a
slowdown (a throttled-but-alive timer would still eventually have ticked
again over 90 extra seconds; it didn't).

**This is a direct threat to decision #4's sync-ownership design**, which
hands the sync engine (currently a `visibilityState`-gated ~30s poll loop,
`src/lib/sync/engine.ts`) to a hidden background webview when the board
closes. If hidden-webview timers are suspended after their first fire, that
background sync loop will not run reliably. Needs follow-up before D2 locks
in the design — options to investigate: (a) keep the window minimized/
occluded rather than `visible: false` (a different code path in AppKit,
possibly not throttled the same way), (b) drive the sync tick from Rust
(a native timer that calls `window.eval()` into the hidden webview on
schedule, sidestepping the webview's own JS timer entirely), (c) confirm
whether `tauri-plugin-log`'s debug-assertions build behavior or App Nap
specifically (vs. window visibility) is the actual cause — this spike did not
isolate those two.

### 3.5 Swift AX prototype — **built and runs; live browser-URL capture unverified pending Rob**

Standalone script (not the D5 sidecar shape) at
`desktop/context-probe/ax-probe.swift`. Compiles clean with `swiftc`.
Implements exactly the decision-doc rung ladder:

- Rung 1 (`NSWorkspace.shared.frontmostApplication`, no permission) — **works,
  verified live**: `swiftc -o /tmp/ax-probe ax-probe.swift && /tmp/ax-probe`
  correctly returned this session's host process (`Jean`,
  `com.jean.desktop`, real pid) with `axTrusted: false` and a clean
  `apiDisabled` `AXError` for the rung-2 attempt — latency **~75ms** for the
  full rung-1 + failed-rung-2 round trip.
- Rung 2 (`AXUIElementCreateApplication` → `kAXFocusedWindowAttribute` →
  `AXDocumentAttribute` / walk to `AXWebArea` → `AXURL`) — **implemented,
  cannot be exercised in this environment.** `AXIsProcessTrusted()` correctly
  reports `false`; granting Accessibility requires a human clicking through
  System Settings → Privacy & Security → Accessibility, which this agent
  cannot do. The script also sets `AXUIElementSetMessagingTimeout(0.2)`
  per decision #6's hang-mitigation, and depth-limits its `AXWebArea` tree
  walk (max 6) as a defensive measure beyond what the plan doc specified.
- Browsers available on this machine for a future live pass: **Safari,
  Chrome, Arc** (all in `/Applications`). **Firefox is not installed** —
  per the plan doc it needs `AXManualAccessibility` poked separately and has
  no AppleScript URL support, so it should get its own line in the eventual
  `docs/CAPTURE.md` matrix regardless.
- `--watch` mode (re-capture every 2s) is included for a human to Cmd-Tab
  between apps and watch it track focus live — needs Rob.

### 3.6 TCC identity check — **blocked, needs Rob**

Whether a signed `.app`'s `externalBin` sidecar inherits the parent bundle's
Accessibility grant, and whether only one row appears in System Settings (vs.
two, which would look like malware per risk #5 in the plan doc), cannot be
tested without (a) a signed, notarized-or-at-least-ad-hoc-signed build and
(b) a human granting Accessibility and inspecting System Settings. Not
attempted — flagged rather than guessed.

### 3.7 Cross-origin auth probe — **CSP correctly not the blocker; server-side CORS confirmed as the real gate**

From a real `tauri://localhost` window (custom-protocol build, not the
`devUrl` dev loop — see the pitfall in §4 below), with `tauri.conf.json`'s CSP
set to
`connect-src 'self' https://myfaite.app wss://myfaite.app ...`:

- `fetch("https://myfaite.app/api/auth/get-session", {credentials:"include"})`
  → **rejected**, `TypeError: Load failed`. **Zero `securitypolicyviolation`
  events fired** — confirmed via an injected listener — so this was not a CSP
  block. A direct `curl -H "Origin: tauri://localhost"` against the same
  endpoint from this machine confirms why: the response carries **no
  `Access-Control-Allow-Origin` header at all** for that origin. This is a
  live-server CORS rejection, not a client-side policy issue.
- `new WebSocket("wss://myfaite.app/api/sync/ws")` → closed abnormally (code
  `1006`) after an `error` event. A manual WS-upgrade `curl` against the same
  URL with the same `Origin` header got back `HTTP 401`, i.e. the server
  rejects the upgrade outright pre-CORS, consistent with `isAllowedWsOrigin`
  and/or session-auth gating in `src/server/sync/ws-server.ts` not yet
  knowing about this origin.

**Answer to the plan doc's explicit question: adding the CSP `connect-src`/
`wss:` entries was necessary but confirmed *not sufficient*.** The
server-side changes decision #2 already scoped to D2 (`TRUSTED_ORIGINS` in
`src/server/auth.ts`, feeding both `cors.ts` and `isAllowedWsOrigin`) are
required before any real request from the Tauri origin will succeed. D0
deliberately did not touch server code, so this was expected, but it's now
empirically confirmed rather than assumed — and confirmed cleanly enough
(zero CSP violations, an explicit missing-header result, an explicit 401) to
be confident D2's planned changes are the right ones and are sufficient in
kind, even though their exact implementation wasn't touched here.

One spike-only wrinkle: the probe harness's own instrumentation (a throwaway
localhost HTTP server the harness uses to report results out of the webview,
since going through Tauri's `invoke`/capability ACL wasn't worth plumbing for
a one-off harness) needed `http://127.0.0.1:8799` added to `connect-src` too.
**That entry is spike scaffolding, not a real CSP requirement** — it should
not survive into D1's actual CSP, which only needs `'self'`,
`https://myfaite.app`, and `wss://myfaite.app`.

### 3.8 Footprint — **PASS, comfortably inside the plan doc's ~100MB estimate**

Measured via `ps -o rss` against the compiled binary directly (not `cargo
run`, which adds a wrapping process):

| Build | Windows | RSS |
|---|---|---|
| Debug (`cargo build --features tauri/custom-protocol`) | 3 (2 visible boards + 1 hidden) | 82–106 MB across several runs |
| Release (`cargo build --release --features tauri/custom-protocol`) | 3 (2 visible boards + 1 hidden) | 82–84 MB |

Cold-launch (process exec → first webview `page_load` inside the app):
**~5–6 seconds**, measured twice (a "cold" first launch and an immediate
"warm" relaunch of the same binary, which didn't meaningfully improve on the
first). **Caveat heavily before repeating this number**: this is an
**unsigned dev/local-release build**, launched directly as a raw Mach-O
(not through Launch Services / a `.app` bundle), and **creating 3 windows
concurrently** — D1's actual shell is a single main window at first launch.
All three of those push the number pessimistic relative to what a notarized
`.app` double-clicked by a user would show. Worth re-measuring once D1 has a
real signed bundle with the intended single-window startup path.

### 3.9 dev-loop pitfall found and worth flagging for D1

Tauri decides `devUrl` (dev loop) vs. embedded `frontendDist` (production)
based on whether the `tauri` crate's `custom-protocol` Cargo feature is
enabled — **not** on `cargo build --release` vs. debug profile, which was the
initial (wrong) assumption going into this spike. A plain `cargo build` or
`cargo build --release`, run directly rather than through `tauri dev` /
`tauri build`, **always** resolves to `devUrl` if one is configured,
regardless of profile — and since D0 had no `next dev` server actually
running on `:3000`, every such run silently loaded a WebKit error page while
still executing injected init scripts, which is a confusing failure mode if
you don't know to check `location.origin` in the results. The correct way to
force the embedded/production path outside of `tauri dev`/`tauri build` is
`cargo build --features tauri/custom-protocol` (or use `tauri build --debug
--no-bundle` for a faster iteration loop that still gets the feature flag
right automatically). Worth a one-line note in whatever D1 doc covers the dev
loop, since this cost real time to diagnose here.

---

## 4. Needs Rob — cannot be verified without physical presence

1. **Accessibility permission grant.** `desktop/context-probe/ax-probe.swift`
   is built and rung-1-verified; rung 2 (`AXWebArea` → `AXURL`, the whole
   point of Feature B) needs a human to grant Accessibility to a compiled
   binary via System Settings → Privacy & Security → Accessibility, then
   re-run `/tmp/ax-probe` (or `swift ax-probe.swift --watch` and Cmd-Tab
   around) against Safari/Chrome/Arc to see real `AXURL` values and latency
   with the API actually enabled.
2. **TCC identity check** (§3.6). Needs a signed build plus a human watching
   System Settings while an `externalBin` sidecar spawns, to confirm one row
   vs. two.
3. **Firefox AX behavior**, if it's worth installing for the D5 support
   matrix — needs `AXManualAccessibility` poked per-app, per the plan doc;
   not installed on this machine.
4. **A real signed/notarized `.app` footprint measurement** (§3.8's caveat) —
   meaningfully different from the unsigned-binary numbers here, and cold
   launch specifically may look better through normal Launch Services
   double-click startup.

---

## 5. Files this spike added

- `src-tauri/` — Tauri v2 scaffold. `tauri.conf.json` sets `frontendDist:
  "../.next-static"`, `withGlobalTauri: true` (spike convenience, revisit for
  D1 — the real shell should likely use the typed `bridge.ts` surface the
  plan doc describes rather than the global), and the CSP from §3.7.
  `src/lib.rs` branches on `FAITE_D0_PROBE` to either run the throwaway probe
  harness (`src/d0_probe.rs`) or open one normal window on `/board.html` —
  the latter is the actual shape a minimal D1 shell would start from.
- `desktop/context-probe/ax-probe.swift` — standalone Swift AX prototype,
  §3.5.
- `eslint.config.mjs` — added `src-tauri/**` to the global ignore list (a
  real, permanent fix: without it, ESLint tried to parse Cargo's embedded
  copies of the static export's JS as source and produced ~70 spurious
  errors).
- `package.json` / `package-lock.json` — `@tauri-apps/cli` as a dev
  dependency.
- `.gitignore` — `d0-probe-results.jsonl` (the probe harness's own scratch
  output).

`npm run typecheck`, `npm run lint`, and `npm run test` (1575 tests) all pass
clean on top of these changes. `npm run verify`'s full build steps were not
re-run end-to-end in this session for time reasons, but typecheck/lint/test
— the parts any of this could plausibly have broken — are green.

---

## 6. D1 — real window model, desktop bridge, native app menu

Ships the EI-129 cleanup plus EI-130/131/132. Bundled into one PR
deliberately — all three touch `src-tauri/src/lib.rs`, and D0's own
follow-up work had already hit a real merge conflict splitting overlapping
`lib.rs` changes across parallel branches.

### 6.1 EI-129 remainder — spike cleanup + freshness guard

`src-tauri/src/d0_probe.rs` and its `FAITE_D0_PROBE` branch in `lib.rs` are
gone; `run()` now unconditionally builds the real window set (§6.2). The
probe's CSP scaffolding entry (`http://127.0.0.1:8799` in `connect-src`,
flagged in §3.7 as spike-only) and its `.gitignore` line
(`d0-probe-results.jsonl`) are removed too. `capabilities/default.json`'s
window list was updated from the probe's `board_a`/`board_b`/`hidden_probe`
labels to the real `main`/`core` labels (§6.2).

`src-tauri/build.rs` now fails the build loudly (a `panic!` in the build
script, before `tauri_build::build()` runs) if `frontendDist`
(`../.next-static/`, relative to `src-tauri/`) is missing, empty, or older
than `src/`'s newest file — a stale/missing export otherwise fails silently
until someone launches the app and sees a blank or outdated window. Verified
by hand: deleting `.next-static/` and touching a file under `src/` each
independently produce the expected panic with a `npm run build:static`
pointer; `npm run build:static` (with `NEXT_PUBLIC_AUTH_URL=https://myfaite.app`
per §3.2) followed by `cargo build` then succeeds cleanly. Kept simple per
scope — no attempt to gate this only for the `custom-protocol`-feature build
(the one that actually embeds `frontendDist`); it runs, and can fail, on
every `cargo build` including the plain `devUrl` dev loop.

Also dropped, as general "this isn't a spike shell anymore" cleanup while
touching these files: `tauri.conf.json`'s `productName`/`identifier` lost
their `-spike`/`.spike` suffixes (`Faite` / `app.myfaite.desktop`), and
`withGlobalTauri` flipped from the spike's `true` to `false` now that
`bridge.ts` (§6.3) is the intended typed surface instead of the injected
`window.__TAURI__` global — exactly the revisit §5 flagged.

### 6.2 EI-130 — window inventory

`src-tauri/src/lib.rs` builds two `WebviewWindow`s in `setup`:

- `main` — the visible board window, `board.html`, `1200×800`. What the user
  sees at launch.
- `core` — hidden (`visible(false)`), same `board.html` origin (so it shares
  IndexedDB/localStorage with `main`, per the D0 §3.3 finding), not wired to
  anything yet. This is the future home for sync ownership (D2) and the
  menu-bar popover (D3) per decision #4 — D1's job was only to establish
  that it exists and stays alive, not to put sync logic in it. Its doc
  comment in `lib.rs` repeats the §3.4 hidden-timer caveat inline so it's
  not missed by whoever wires D2 in.

Quit-on-last-window-close is disabled on macOS: `Builder::build()` +
`App::run(|_, event| { #[cfg(target_os = "macos")] if let
RunEvent::ExitRequested { api, .. } = event { api.prevent_exit(); } })`,
replacing the old `.run(tauri::generate_context!())` shorthand that doesn't
give access to `RunEvent`. Closing `main` alone now leaves `core` (hidden)
running — standard menu-bar-app behavior. **Compile-verified only** — confirming
NSApplication actually stays resident with the dock icon gone or present as
expected needs a real launch and window-close, which needs a display
session Rob has and this agent doesn't.

### 6.3 EI-131 — desktop bridge

`src/lib/desktop/bridge.ts`: `isDesktopShell(): boolean`, backed by
`@tauri-apps/api/core`'s `isTauri()` (checks `globalThis.isTauri`, the flag
Tauri's webview injects — not `window.__TAURI__`, which only exists when
`withGlobalTauri` is on, which D1 turned off, see §6.1). SSR-safe (`isTauri()`
reads `globalThis`, never touches `window` directly), so it's safe to call
from code that also runs during prerender/static generation — it just
resolves `false` there. `@tauri-apps/api@^2.11.1` added to `dependencies`
(not `devDependencies` — this ships in the runtime bundle, unlike
`@tauri-apps/cli`). Unit-tested (`bridge.test.ts`) against
`globalThis.isTauri` directly, no Tauri runtime needed. Nothing consumes it
yet — that's the point, it's the seam, not a feature.

### 6.4 EI-132 — native app menu + window state

`src-tauri/src/lib.rs`'s `app_menu()` builds an explicit macOS app menu via
`tauri::menu::{MenuBuilder, SubmenuBuilder}`: an app submenu (About/
Services/Hide/Hide Others/Show All/Quit), **Edit** (Undo/Redo/Cut/Copy/
Paste/Select All), and Window (Minimize/Maximize/Close), set via
`app.set_menu(...)` in `setup`.

Worth being honest about what this actually fixes: Tauri v2 already
auto-installs `tauri::menu::Menu::default()` on macOS whenever no custom
menu is set (`Builder::enable_macos_default_menu`, on by default,
`crates/tauri/src/app.rs`) — and that default already includes a full Edit
submenu. So Cmd+C/Cmd+V/Cmd+A were very likely already working in the D0
spike's shell, contrary to this ticket's premise that they'd be silently
missing. `app_menu()` is built explicitly anyway rather than relying on that
implicit default, both because the ticket asked for a menu built "via
Tauri's menu API" and because an implicit default is one incidental
`.menu()` call away from silently disappearing later. Non-macOS builds
(not a real target yet, see decision #6) get a minimal fallback app.item +
Edit + Window, just so `cargo build` stays sane on other host platforms.

Window size/position persistence uses `tauri-plugin-window-state` (`2.4.1`,
Rust crate; no JS package needed since nothing calls its manual
save/restore APIs from the frontend) — registered as a target-scoped
`[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]`
entry in `Cargo.toml` and gated with `#[cfg(desktop)]` at the `.plugin(...)`
call site in `lib.rs`, matching the plugin's own docs. Restoration is
automatic — no code needed beyond registering the plugin.
`capabilities/default.json` grants `window-state:default`.

**Compile-verified only.** `cargo build`, `cargo build --features
tauri/custom-protocol`, and `cargo clippy --all-targets` are all clean with
zero warnings. Actually seeing the menu bar render, confirming Cmd+C/Cmd+V
work inside the webview, and confirming a resized/moved window is restored
on relaunch all need a real display session and were not exercised here.

### 6.5 Verification summary

`npm run typecheck`, `npm run lint`, `npm run test` (1577 tests — 2 new,
`bridge.test.ts`), `npm run build`, and `npm run build:static` all pass
clean. `cargo build` / `cargo build --features tauri/custom-protocol` /
`cargo clippy --all-targets` in `src-tauri/` all pass with zero warnings.
Nothing in this milestone was interactively exercised in a running app —
windows, menu, and window-state restoration are compile-verified only, per
§6.2/§6.4 above.
