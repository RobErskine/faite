# Desktop shell (Tauri v2) — working document

**Self-contained handoff.** Everything needed to continue the desktop work on
Faite without re-deriving it. This is a living document, updated as each
milestone ships — read the milestone table below before assuming anything
past D1 exists yet.

> **Numbering.** This document's milestones are **D0…D6** — a separate axis
> from the product roadmap's **P0…P7** and the mobile track's **M-1…M6**
> (`docs/ARCHITECTURE.md` §7, `docs/MOBILE.md`). They do not line up. A bare
> "P<n>"/"M<n>" anywhere in this file means those other axes.

| Milestone | Scope | Status |
|---|---|---|
| D0 | Architecture spike — stress-test the locked decisions (§2) against a real build | ✅ Done — §3 |
| D1 | Real window model, desktop bridge (`isDesktopShell()`), native app menu, window-state persistence | ✅ Done — §6 |
| D1.5 | Installable, dock-resident `.app` — hide-on-close/reopen, ad-hoc signing, `desktop:build`/`desktop:dev` scripts | ✅ Done — §7 |
| D1.6 | Developer ID + notarization | ✅ Done — §8 |
| D2a | Desktop login + sync — `TRUSTED_ORIGINS`, api-key bearer auth, OS-keychain token storage, WS auth | ✅ Done — §9 |
| D2b (EI-145) | Background sync while the window is closed — Rust-driven timer into the hidden webview | ✅ Done — §10 |
| D2c (EI-147) | Build-version check against the server + a "get the update" button (no auto-updater) | ✅ Done — §12 |
| D3 | Feature A — menu bar popover (today/overdue to-dos, read-on-show) | Not started |
| D4 | Feature B — global hotkey, always-on-top quick-capture window | Not started |
| D5 | Swift sidecar — Accessibility-API context capture (decision #5), wired as an `externalBin` | Standalone prototype only — §3.5, not integrated |
| D6 | Not yet scoped beyond decision #1's "then Windows" | — |

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
3. **Bearer tokens, not cookies**, for the desktop shell's auth. Token in the
   OS keychain via the `keyring` Rust crate, never in `localStorage`. D0 §7
   below is why this is closer to mandatory than merely-better. **Confirmed
   empirically, not just by reasoning, in D1.5 (§7.4):** Tauri's HTTP plugin
   cannot rescue a cookie-based session either — the reqwest and webview
   cookie jars are independent stores, and the WebSocket transport never sees
   the cookie at all. **Landed in D2a (§9) via Better Auth's `apiKey` plugin,
   not the literal `bearer` plugin this line originally named** — a scaffold
   for exactly this already existed (`src/server/auth-tokens.ts`, built ahead
   of time for this milestone) and fit better: real revocable tokens in D1,
   not ephemeral session-token headers.
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
numbers was `src-tauri/src/d0_probe.rs`, gated behind `FAITE_D0_PROBE=1` and
never wired into a non-probe build path. **It is no longer on `main`** — EI-129
removed it in PR #14 once D1's real window model landed, on the principle that
throwaway spike code does not stay in shipped desktop code. To read it, recover
it from the D0 branch:

```bash
git show rob/d0-desktop-spike:src-tauri/src/d0_probe.rs
```

The same treatment was applied to EI-178's probe — see
`docs/DESKTOP-SYNC-TIMER-SPIKE.md`.

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

### 3.5 Swift AX prototype — **verified live; all three browsers tested return real page URLs**

Standalone script (not the D5 sidecar shape) at
`desktop/context-probe/ax-probe.swift`. Compiles clean with `swiftc`.
Implements the decision-doc rung ladder.

Rung 1 (`NSWorkspace.shared.frontmostApplication`, no permission) worked from
the first build. **Rung 2 (`AXUIElementCreateApplication` →
`kAXFocusedWindowAttribute` → walk to `AXWebArea` → `AXURL`) was verified live
on 2026-08-21** once Rob granted Accessibility, across five `--watch` runs.
Getting there took four separate bug fixes, all of which are load-bearing for
D5 (EI-164/EI-165) and none of which were obvious from the API docs.

**Support matrix — measured, not assumed:**

| Browser | `AXWebArea` depth | Needs the AX opt-in? | Result |
|---|---|---|---|
| Safari | **6** | No — rejects it (`attributeUnsupported`) | 11/12, 14/26, 6/7 samples returned a real page URL. WebKit builds the tree unconditionally. Window title == page title. |
| Dia (Chromium) | **1** | **Yes — `AXManualAccessibility`** | **0/67 → 45/45.** Window title is truncated and profile-prefixed (`"Personal: Code Vein II -…"`), so rung-1-only context is lossy here too. |
| Google Chrome | **8** | No — rejects both attributes | **0/26 → 14/14.** |
| Firefox, Edge, Brave, Arc | — | — | **UNTESTED.** Firefox is the one the plan doc specifically flagged; not installed on this machine. |
| Faite itself (Tauri) | — | No | Reports `tauri://localhost` — Tauri webviews expose `AXWebArea` like any browser, so **Faite's own capture window is capturable**. Concrete reason EI-164's tracker must ignore self. |

**Latency, all fixes in:** Safari median 12ms, Chrome 24–32ms, Dia 31–90ms.
Worst single sample **396ms** — Dia's cold opt-in on the 3-attempt path, paid
once per browser process, not per capture. A Safari single-attempt outlier hit
**388ms**. EI-165's 400ms cap holds, but the outliers say it must be a
*deadline that degrades gracefully* (show the capture window, fill context in
late) rather than a budget the sidecar assumes it fits inside.

**The four bugs, because each is a trap D5 would otherwise re-enter:**

1. **Chromium keeps its web-content AX tree switched off** until a client
   explicitly asks. Being AX-trusted is necessary but not sufficient. Dia
   accepts `AXManualAccessibility`; `AXEnhancedUserInterface` comes back
   `notImplemented` there. Proven causal by a clean control — Dia quit and
   relaunched (which resets the flag) gave 0/67, and the very next sample
   after the opt-in returned `success` gave a real URL.
   **The flag persists for the life of the browser process**, so the sidecar
   enables once per process, not once per capture — and so a control run
   *after* a treatment run is contaminated. An earlier pass produced a
   35/35 "control" that appeared to refute the entire finding for exactly
   this reason.
2. **The `AXWebArea` depth cap was a guess, and it was wrong.** The original
   `maxDepth: 6` was defensive hand-waving. Chrome's page web area is at
   **depth 8**, so the walk gave up before reaching it and Chrome looked
   unsupported for 26 samples — it never needed the opt-in at all. Safari
   sits at depth **6**, one level from being silently broken the same way.
   Now 12, and the depth is *reported* in the JSON rather than assumed.
3. **The first `AXWebArea` is often not the page.** Inside 6 levels Chrome
   does have one — `chrome://omnibox-popup.top-chrome/`, the address-bar
   dropdown, which is itself a web view. The old "return the first match"
   logic reported it as what the user was looking at. Now all web areas are
   collected and browser-internal schemes (`chrome://`, `devtools://`,
   `about:`, extension popups) are filtered out, with a `nil` fallback —
   "we saw web areas but none were the page" beats a confidently wrong URL.
4. **`AXUIElementSetMessagingTimeout` on the app element bounds almost
   nothing.** Decision #6 says "set it to ~200ms" and the obvious reading —
   set it on the `AXUIElement` you just created for the app — is the one that
   doesn't work. Apple: *"Setting the timeout on another accessibility object
   sets it only for that object"* / *"Pass the system-wide accessibility
   object … if you want to set the timeout globally for this process."* So
   the app element was bounded and every element reached *through* it — the
   focused window, each child of the tree walk, the web area, the `AXURL`
   read — silently used the 6-second system default. Not theoretical: a
   Safari sample took **6120ms** on a path budgeted at 400ms. Now set once on
   `AXUIElementCreateSystemWide()`.

A fifth bug was in the harness rather than the API, and is worth recording
because EI-164 depends on not repeating it: **`--watch` froze on whatever app
was frontmost at launch.** It was `while true { capture(); Thread.sleep(2) }`,
and `NSWorkspace` learns about activation from notifications delivered on a
*run loop* — which a process that only sleeps never pumps. The window title
kept updating (re-read live off the stale pid), which made it look like a
permissions problem. Fixed with a `didActivateApplicationNotification`
observer plus `RunLoop.main.run()` — the same mechanism EI-164 specifies for
the real sidecar, where it additionally has to ignore Faite's own window.

`--no-enable-ax` runs the probe without the opt-in, for A/B'ing a browser that
has been quit and relaunched first.

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

1. ~~**Accessibility permission grant.**~~ **Done 2026-08-21** — granted, and
   rung 2 verified live against Safari, Chrome and Dia. See §3.5 for the
   support matrix, the latency numbers, and the four bugs it surfaced.
2. **TCC identity check** (§3.6). Needs a signed build plus a human watching
   System Settings while an `externalBin` sidecar spawns, to confirm one row
   vs. two.
3. **Firefox, Edge, Brave and Arc AX behavior** — still untested (§3.5).
   Firefox is the one the plan doc singled out and is not installed on this
   machine; per that doc it needs `AXManualAccessibility` poked per-app and
   has no AppleScript URL fallback. Note Chrome turned out NOT to need the
   opt-in, so "Chromium needs it" is not a safe generalization — Edge, Brave
   and Arc each need their own row rather than an inherited one.
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

---

## 7. D1.5 — installable, dock-resident app

Self-contained handoff doc this milestone worked from:
`.ai/desktop-d1.5-runbook.md`. Goal: `cp` a real `.app` into `/Applications`,
Cmd-Tab to it, and use Faite as a daily driver without a browser — close the
window and the app stays in the dock; click the dock icon and the window
returns. D1's `.app` had never actually been launched (§6.2/§6.4's
"compile-verified only" caveats) — D1.5 is the first milestone that runs it.

### 7.1 Hide-on-close, show-on-reopen — reverses D1's window model

D1 (§6.2) kept the process alive with a second, hidden `core` window carrying
no job — a comment, not a mechanism — and left `main`'s own close behavior as
Tauri's default (destroy the window; nothing reopens it). Two bugs followed
from that: closing the board left the process alive with no reachable
window and no way back but Cmd-Q, and `core` doubled RSS and ran a second
Dexie bootstrap against the same IndexedDB for no reason yet.

`src-tauri/src/lib.rs` now does the standard macOS dock-app pattern instead:

- `main`'s `WindowEvent::CloseRequested` calls `api.prevent_close()` then
  `window.hide()` (macOS only) — hide, not destroy, so a later reopen is
  instant and doesn't re-run the board's Dexie bootstrap or lose in-memory
  state.
- `RunEvent::ExitRequested` still calls `api.prevent_exit()` — now doing real
  work, since nothing else keeps the app alive with `core` gone.
- `RunEvent::Reopen` (the documented v2 hook for AppKit's dock-icon-click
  event, [tauri#3084](https://github.com/tauri-apps/tauri/issues/3084)) looks
  up `main` and calls `show()` + `set_focus()`.
- The `core` window and its `CORE_WINDOW` const are deleted outright —
  `prevent_exit` alone is what keeps the app resident, `core` was never doing
  that job. `capabilities/default.json`'s `windows` list is back down to
  `["main"]`. D2b re-adds a hidden window when it actually has one (sync
  ownership); nothing here blocks that.

**Consequence to carry forward, not a regression:** a hidden window's JS
timers are suspended (D0 §3.4), so the sync engine's poll loop stops while
the window is closed. That's D2b's problem to solve (a Rust-driven timer
calling into the hidden webview, per EI-178's spike — see
`docs/DESKTOP-SYNC-TIMER-SPIKE.md`), not D1.5's.

### 7.2 `build.rs` staleness check downgraded from panic to warning

D1 (§6.1) made a stale `.next-static/` (source newer than the last export) a
hard `panic!` on every `cargo build`, including the `devUrl` dev loop, which
never even reads `.next-static/`. `tauri build`'s `beforeBuildCommand` and
(new this milestone) `tauri dev`'s `beforeDevCommand` both re-run
`build:static` ahead of cargo, so the shipping and dev-loop paths can't
actually produce a stale bundle — the panic only ever fired somewhere it was
wrong. The **missing-or-empty** checks stay hard panics; only the staleness
branch became `cargo:warning=`.

### 7.3 Ad-hoc signing, and `tauri dev` gets a real dev loop

- `tauri.conf.json`'s `bundle.macOS.signingIdentity` is now `"-"` (ad-hoc). A
  locally built `.app` with no Apple Developer ID still needs ad-hoc signing
  or Gatekeeper treats it as damaged on Apple Silicon — no quarantine xattr
  from a `cp`, but the missing signature alone is enough
  ([Tauri macOS signing docs](https://v2.tauri.app/distribute/sign/macos/)).
  D1.6 replaces this with a real Developer ID once Rob's enrollment is wired
  in.
- `build.beforeDevCommand: "npm run dev"` — `tauri dev`'s `devUrl` already
  pointed at `http://localhost:3000`, but nothing booted a server there.
  Useful side effect, not just plumbing: `http://localhost:3000` **is** in
  `TRUSTED_ORIGINS` already, so `tauri dev` has working auth and sync today —
  it previews what D2a's `tauri://localhost` origin work is aiming to make
  true for a production build too.
- `package.json` gains `desktop:dev` (`tauri dev`) and `desktop:build`
  (`tauri build`). Install is documented here, not scripted — a script that
  `rm -rf`s a path under `/Applications` isn't worth the keystrokes:
  ```
  npm run desktop:build
  cp -R src-tauri/target/release/bundle/macos/Faite.app /Applications/
  ```
- `src-tauri/Cargo.toml`'s `tauri init` placeholders (`description = "A Tauri
  App"`, `authors = ["you"]`, empty `license`/`repository`) are filled in.

### 7.4 HTTP plugin investigated and rejected as a cookie-auth workaround

Before committing to D2a's bearer-token design (decision #3), checked
whether Tauri's HTTP plugin could let a cookie-based Better Auth session work
from `tauri://localhost` without it. Rejected with evidence, not just
reasoning:

- The plugin's `reqwest`-backed cookie jar and the webview's own cookie store
  are independent — a cookie set by one is invisible to the other
  ([tauri#13045](https://github.com/tauri-apps/tauri/issues/13045)).
- Even within the plugin's own jar, http-only cookies aren't persisted across
  app launches ([tauri#11518](https://github.com/tauri-apps/tauri/issues/11518)).
- Faite's sync v1 transport is WebSocket push
  (`src/server/sync/ws-server.ts`), and a socket connection never receives a
  cookie from either jar regardless. The plugin would at best buy a working
  `/api/auth` call and leave sync permanently dead.

This confirms decision #3 empirically rather than by reasoning alone — see
the note added there.

### 7.5 Running it on your own Mac

```
npm run desktop:build
cp -R src-tauri/target/release/bundle/macos/Faite.app /Applications/
```

Requires `NEXT_PUBLIC_AUTH_URL` to be set at export time — already baked into
`beforeBuildCommand` (`NEXT_PUBLIC_AUTH_URL=https://myfaite.app npm run
build:static`), **not** something `npm run build:static` alone provides. D0
§3.2 is why: with no override, Better Auth's client falls back to
`window.location.origin`, which is `tauri://localhost` — a scheme its own URL
validation rejects, crashing the whole render tree before the board mounts.
A bundle built by hand-running `cargo build`/`cargo tauri build` without that
env var set will show a blank window, not the board.

Signed-out is fully functional today (§2.1) — creating, editing, and
scheduling to-dos all work with no account, no network call, and no error
spam, since `getCurrentOwnerId()` returns `LOCAL_OWNER_ID` and both the sync
engine and `ws-transport` early-return on `isActive()`. Signing in from the
desktop shell itself is blocked until D2a (§2.2) — that's expected, not a
bug, for this milestone.

For iterating on the shell itself, `npm run desktop:dev` (`tauri dev`) boots
`next dev` on `:3000` via the new `beforeDevCommand` and points the webview
at it — auth and sync both work in that loop, unlike a production bundle
today.

### 7.6 Verification summary

Automated: `npm run verify` (typecheck ×2, lint, test suite, `build`,
`build:static`) and `cargo clippy --all-targets` (zero warnings) both green.
`npm run e2e:ci` unaffected by anything in this milestone — none of it
touches `/board`'s own code, only the shell around it.

Manual — the part D1 never did, and D1.5's actual point. `npm run
desktop:build` produced a real, ad-hoc-signed `Faite.app`
(`target/release/bundle/macos/`); `.dmg` bundling failed/hung separately (see
below) but the `.app` itself built and signed cleanly. Launched directly
(`open Faite.app`, no quarantine xattr since it was never downloaded) and
confirmed, without a screenshot (this session has no Screen Recording TCC
grant — see below), via `lsappinfo list`: registered as `"Faite"`,
`bundleID=app.myfaite.desktop`, **`type="Foreground"`, `(in front)`**, with
real `WebKit.Networking`/`WebKit.GPU`/`WebKit.WebContent` XPC children
spawned — i.e. a real window with a real, loaded webview, not a crash-on-
launch. `log show` over the launch window found no `BetterAuthError`/"Invalid
base URL" (the D0 §3.2 regression this milestone depends on staying fixed)
and no crash/fault/exception entries for the process. RSS via `ps`:
**73–87 MB, single window** — comfortably under D0 §3.8's 82–106 MB estimate,
which was for three concurrent windows; this is the genuine single-window D1.5
number that section flagged as worth re-measuring. Quit cleanly via `pkill`.

**Not verified, and needs Rob specifically:** the interactive parts —
Cmd-W-hides / dock-icon-click-reopens / Cmd-Q-quits behavior, window-geometry
restore across relaunch, Cmd-C/V inside the todo input, and a real visual
check that the board (not a blank or error page) is what's actually on
screen. Two things blocked automating further from here, both worth knowing
about rather than silently working around:

- `screencapture` failed with "could not create image from display" — this
  session's process has no Screen Recording TCC grant. The app almost
  certainly rendered on the real display (the WebContent process evidence
  above), just not something this session could photograph.
- `osascript ... tell application "System Events" to keystroke "w" using
  command down` **hung and had to be killed after timing out** — reads as a
  blocked macOS Automation/Accessibility permission prompt for whatever host
  process runs this session's shell. **If a "would like to control this
  computer" or similar system permission dialog is sitting on screen, it's
  from this session — safe to dismiss (Don't Allow is fine; nothing further
  was attempted after the timeout).** No orphaned `osascript` process was
  left running; a stale read/write `.dmg` shadow volume the failed bundling
  step left mounted (`rw.39399.Faite_0.1.0_aarch64.dmg` on `/dev/disk7`) was
  found and `hdiutil detach`ed.

**`.dmg` bundling (`bundle.targets: "all"`, pre-existing, not changed this
milestone) fails or hangs in this environment** — first attempt errored fast
inside `bundle_dmg.sh`, a retry (`tauri build --bundles dmg` alone) hung for
the full 2-minute timeout with zero output, consistent with the same blocked-
Automation-permission cause as the `osascript` case (`create-dmg` also drives
Finder via AppleScript to lay out the disk-image window). **Not required by
this milestone** — the install path is `cp -R Faite.app /Applications/`, no
`.dmg` involved — so left as-is rather than changing `bundle.targets` to drop
`dmg` unilaterally; Rob's own interactive session (which has real Automation
permissions granted to Terminal/Finder already, unlike this one) should just
work. Worth a two-minute check next time this doc is touched, not a blocker.

---

## 8. D1.6 — Developer ID + notarization

Real signing and notarization, verified end to end the same session, same
day as D1.5 — Rob enrolled in the Apple Developer Program and walked through
certificate creation live.

### 8.1 What Rob did (not scriptable — Apple's portal + Keychain Access are GUI-only)

1. Confirmed Apple Developer Program enrollment.
2. Generated a CSR via **Keychain Access → Certificate Assistant → Request a
   Certificate From a Certificate Authority**, saved to disk (this is also
   what creates the paired private key in the login keychain — the step that
   makes everything downstream work).
3. Created a **Developer ID Application** certificate on
   developer.apple.com's Certificates page using that CSR, downloaded the
   `.cer`, double-clicked to install it into the login keychain (pairs it
   with the CSR's private key).
4. Confirmed via `security find-identity -v -p codesigning`:
   `"Developer ID Application: rob erskine (48XAK39593)"`.
5. Generated an **App Store Connect API key** (Users and Access →
   Integrations, "Developer" role) — the modern notarization auth method,
   preferred over Apple ID + app-specific password because it doesn't hit 2FA
   prompts and doesn't expire the same way. Saved the `.p8` outside any git
   working directory (`~/.config/apple/`, `chmod 600`) — **never shared, and
   never should be**; only its file path is a build input.
6. Set four env vars in `~/.zshrc`: `APPLE_SIGNING_IDENTITY`,
   `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`.

### 8.2 What changed in the repo — nothing

**Deliberately no `tauri.conf.json` change.** `signingIdentity` stays `"-"`
(ad-hoc, D1.5's default). `APPLE_SIGNING_IDENTITY` overrides it at build time
per Tauri's own env-var precedence
([reference](https://v2.tauri.app/reference/environment-variables/)), so a
real signed+notarized build happens exactly when those four vars are present
in the environment and not otherwise. Two reasons this beats hardcoding the
identity into the committed config: it doesn't bake a personal name/Team ID
into git history, and it doesn't go stale if the certificate is ever rotated
or revoked — the file needs no edit either way. Anyone building without the
vars set (a fresh contributor, CI with no secrets configured) silently falls
back to ad-hoc, matching D1.5's existing safe default — never a hard failure.

`hardenedRuntime` needed no config either — it **defaults to `true`** in
Tauri v2's schema, and notarization requires it; confirmed active in the
signed binary's own code signature (`flags=0x10000(runtime)`, §8.3).
`providerShortName` (relevant to the older Apple-ID/app-specific-password
notarization path, for disambiguating which team when an Apple ID belongs to
several) wasn't needed — the API-key method identifies the team via
`APPLE_API_ISSUER` unambiguously.

### 8.3 Verified — real signing, real notarization, real Gatekeeper acceptance

`npm run desktop:build -- --bundles app` (scoped to skip the still-unresolved
`.dmg`/Automation-permission issue from §7.6) with all four env vars live:

```
Signing with identity "Developer ID Application: rob erskine (48XAK39593)"
Notarizing Finished with status Accepted for id f71f1c65-1097-48ae-9097-89662e40cad6
Stapling app...
    Finished 1 bundle
```

Confirmed independently, not just trusting the build log:

- `spctl -a -vv Faite.app` → **`accepted`**, `source=Notarized Developer ID`
  — this is the same check macOS itself runs before allowing a downloaded
  app to launch, and it now passes (§7.6's ad-hoc build was, correctly,
  `rejected` by this same check — ad-hoc signing only avoids the "damaged"
  false-positive for an *unquarantined*, locally-built copy; it was never
  going to pass Gatekeeper's real assessment, which is what this milestone
  actually fixes).
- `codesign -dv --verbose=4` → full valid chain (`Developer ID Application:
  rob erskine (48XAK39593)` → `Developer ID Certification Authority` →
  `Apple Root CA`), `TeamIdentifier=48XAK39593`, `flags=0x10000(runtime)`.
- `xcrun stapler validate Faite.app` → **"The validate action worked!"** —
  the notarization ticket is stapled into the bundle itself, so Gatekeeper
  can verify it offline; a user doesn't need network access at first launch.
- Launched the real signed bundle directly (`open Faite.app`) and confirmed
  via `lsappinfo list` it registered as `"Faite"`, `(in front)` — same
  non-visual verification method as §7.6, same caveat about no Screen
  Recording grant in this session to actually photograph it.

**This is a materially stronger result than §7.6's ad-hoc build**: this
`.app` would install and launch cleanly on *any* Mac, downloaded from
anywhere, with zero Gatekeeper friction — not just on the machine that built
it. `.dmg` bundling was not re-attempted here (already demonstrated to hang
on this session's missing Automation permission in §7.6; unrelated to
signing, so no reason to expect this milestone changed that outcome).

### 8.4 What's still open

- **Rob's own interactive-session checklist from §7.6 is unchanged and still
  outstanding** — dock-icon reopen, Cmd-W hide, window-geometry restore,
  Cmd-C/V, and an actual look at the rendered board all still need a human
  at a real display session. Signing/notarization doesn't touch any of that
  behavior.
- **`.dmg` bundling** — still blocked in this environment; untested whether
  Rob's own interactive session resolves it (§7.6).
- **CI signing** — everything above is a local-keychain flow
  (`APPLE_SIGNING_IDENTITY` alone, no `.p12`/`APPLE_CERTIFICATE`). A future
  CI-built release would need the certificate exported and base64-encoded as
  a GitHub Actions secret — not attempted, not needed yet.

---

## 9. D2a — desktop login + sync

Same day as D1.5/D1.6. Rob's own instinct on where to start ("open the
browser, sign in, callback into Faite") turned out to be exactly the right
shape, and better than this doc's own D1.5-era sketch — see §9.1.

### 9.1 The design, and why it beats the original sketch

The original plan (decision #3, and the D1.5 runbook's §5 sequencing)
imagined the desktop shell somehow authenticating itself directly. That was
never going to work: `tauri://localhost` cannot hold a session cookie at all
(D0 §3.7), so ANY approach that tries to sign in *from* the embedded webview
inherits that wall. D2a's actual design never tries:

1. **The desktop shell opens the SYSTEM BROWSER** (`bridge.ts`'s
   `startDesktopLogin()`, via `@tauri-apps/plugin-opener`) to
   `https://myfaite.app/login?callbackURL=%2Fdesktop-handoff` — a real
   `https://` origin, so email/password AND both OAuth providers work
   completely unmodified. Every "sign in"/"sign up" affordance in the app
   (`app-header.tsx`, `welcome-dialog.tsx`, `signed-out-banner.tsx`) opens
   this instead of navigating the webview once `isDesktopShell()` is true.
2. **`callbackURL`** is threaded through `login`/`signup`'s email/password
   branch (previously hardcoded to `/board`) and `<OAuthButtons
   callbackURL>` (already a real prop, just never used for anything but the
   default) to land on `/desktop-handoff` instead.
3. **`/desktop-handoff`** (new page, cookie-authenticated) calls
   `/api/desktop/handoff`, which mints a real, named, revocable API key
   (`auth.api.createApiKey()`, `auth-tokens.ts`'s `apiTokenPlugin` — see
   §9.2 for why this beats a literal `bearer` plugin) and encrypts it plus a
   60-second expiry into an opaque code (`handoff-code.ts`, AES-GCM,
   HKDF-derived from `BETTER_AUTH_SECRET`). The raw key never reaches the
   browser response — only the code does. A **deliberate stateless
   simplification**, documented in `handoff-code.ts` itself: TTL-bounded,
   not single-use-enforced (no new D1 table, no migration — this repo's
   `.ai/lessons.md` has more hard-won D1-migration scars than any other
   topic, and a 60-second local handoff code isn't worth one).
4. The page renders a **"Continue to Faite" button** — not an automatic
   redirect. Browsers can decline to honor a custom-scheme navigation that
   didn't originate from a user gesture; the click is the gesture.
5. Clicking it navigates to `faite://auth-callback?code=…` — macOS hands
   this to the app via `tauri-plugin-deep-link` (registered scheme,
   `tauri.conf.json`'s `plugins.deep-link.desktop.schemes`).
   `bridge.ts`'s `onDesktopAuthCallback()` wires both `getCurrent()`
   (cold start) and `onOpenUrl()` (already running — the overwhelmingly
   common case, since D1.5 made the app dock-resident).
6. **`DesktopAuthProvider`** (new, mounted in `board.tsx` next to
   `SessionProvider`/`SyncProvider`, gated on `isDesktopShell()`) receives
   the callback, POSTs the code to `/api/desktop/exchange` — called from the
   DESKTOP APP this time, genuinely cross-origin from `tauri://localhost`,
   no cookie involved at all — and gets back the real key. **This is the
   only place the plaintext key crosses the wire a second time**, and it
   never touches a URL, browser history, or any logging surface the browser
   touches.
7. The key goes into the OS keychain (`src-tauri/src/keychain.rs`, three
   `#[tauri::command]`s over the `keyring` crate's default `v1` feature —
   confirmed to pull in the macOS backend with zero extra feature flags).
   Sign-out (`app-header.tsx`) clears it explicitly — Better Auth's own
   `signOut()` only clears the cookie, which the desktop shell never had.

### 9.2 The bigger discovery: `useSession()` had to work too, not just sync

The first draft of this milestone made `/api/sync/*` accept the bearer
token via its own route-local check and stopped there. That would have
technically fixed sync while leaving `useSession()` — and therefore
`SessionProvider`, the header's signed-in state, every "are we signed in"
UI check in the app — still blind to a successful desktop login, because
none of them ever touch `/api/sync/*` directly. Rob's original report
("wasn't able to log in") would not actually have been fixed.

The fix: `auth-tokens.ts`'s `apiTokenPlugin` flips
**`enableSessionForAPIKeys: true`**, globally — a valid key now satisfies
`auth.api.getSession()` at every endpoint that calls it, including Better
Auth's own `/api/auth/get-session`. `auth-client.ts` attaches the token via
`fetchOptions.auth: { type: "Bearer", token: async () => … }` — a genuine
Better Auth client feature for exactly this (an async token function,
called fresh per request, omitted entirely when it resolves to
`undefined`) — so the SAME token that authenticates sync also makes
`useSession()`, and therefore the whole app, recognize the desktop login.
One mechanism, every consumer, discovered by asking "what does 'signed in'
actually mean in this app" rather than stopping at "does the transport
authenticate."

**The documented cost of "global," not hidden:** `enableSessionForAPIKeys`
being global means any FUTURE api-key consumer (EI-50's original vision of
a scoped, user-generated, read-only external API token) would also become
full-session-equivalent the instant it's created — `permissions`/
`defaultPermissions` are declared on the plugin but enforced nowhere in
this codebase today. `auth-tokens.ts`'s file comment flags this explicitly
as something to revisit before that second consumer ships, not silently
inherited.

### 9.3 The WebSocket subprotocol carrier

A browser `WebSocket` cannot set an `Authorization` header — the one open
question the D1.5 runbook flagged as needing a real decision. Resolved:
the token rides as a `Sec-WebSocket-Protocol` value
(`WS_BEARER_PROTOCOL_PREFIX = "faite-bearer."`, `src/lib/sync/wire.ts` —
shared between client and server so the two ends can't drift, same pattern
as every other wire constant in that file). `auth-tokens.ts`'s
`customAPIKeyGetter` checks it as a fallback when no `Authorization` header
is present; `user-do.ts` echoes the offered protocol back on the 101
response, which RFC 6455 requires for the browser to consider the
handshake complete. Chosen over a query-param token (the other option the
runbook posed) specifically to keep the token out of any URL, log line, or
proxy trace that a query string would land in.

### 9.4 Two real bugs found only by testing against a live Durable Object

Both invisible to `npm run verify` (1816 tests, all green) — neither is a
logic error a unit test would catch, because both are about what a
**direct** `auth.api.X()` call receives versus what the same call receives
through Better Auth's own HTTP router.

1. **`customAPIKeyGetter` read `ctx.request?.headers`, which is `undefined`
   for every call in this codebase.** Every `/api/*` handler here calls
   `auth.api.getSession({ headers: request.headers })` — headers only, never
   `request` — because none of them are Next.js Route Handlers (`output:
   export` forbids one that reads `Request`, see `worker.ts`'s file
   comment) and none of them go through Better Auth's own router either.
   `ctx.request` is only populated when an endpoint is dispatched from a
   real `Request` object; `ctx.headers` is populated whenever `headers` is
   passed, regardless. The plugin's own default getter reads `ctx.headers`;
   mine copied a pattern that only works from inside `auth.handler(request)`.
   Result: every bearer-token request to `/api/sync/*` silently fell through
   to "no session" — proven wrong only by `curl`ing a real minted token
   against a real Durable Object and getting `unauthenticated` back instead
   of a push ack.
2. **A malformed bearer-shaped credential crashes instead of 401ing.**
   Better Auth's convention is throw-on-invalid-credential (`APIError`),
   normally caught by the HTTP router's error middleware and translated to
   the right response. Calling `.api.getSession()` directly — as every route
   in this file does — bypasses that translation, so `Authorization: Bearer
   faite_garbage` 500'd `/api/sync/*`, `/api/places/*`, and
   `/api/desktop/handoff` alike (all three call the same pattern). Fixed
   once, centrally: `getSessionSafe()` (`auth.ts`), a wrapper that catches
   `APIError` specifically and resolves to `null` (401), letting any other
   exception (a real infra failure) still surface as a 500. All three
   routes now call it instead of the raw method.

Neither bug survived past the same session — both were caught by the live
smoke test below, fixed, and re-verified against the same running Durable
Object before this milestone was called done.

### 9.5 Verified live, against a real Durable Object

Isolated `wrangler dev --port 8791` (checked free first, matching every
prior sync milestone's pattern) with real local D1 migrations applied
(`npm run auth:migrate:local` — the local database had never had auth
migrations run before this session; a fresh `wrangler dev --local` starts
with none). Confirmed via `curl` (and one raw Node `WebSocket` for the
subprotocol path) against a real signed-up account, not mocks:

- **Full handoff round trip**: sign in (cookie) → `POST
  /api/desktop/handoff` → real encrypted code → `POST
  /api/desktop/exchange` (no cookie, `Origin: tauri://localhost`) → real
  `faite_…` key. CORS confirmed on the exchange response
  (`Access-Control-Allow-Origin: tauri://localhost`).
- **`GET /api/auth/get-session` with only `Authorization: Bearer <key>`, no
  cookie** → returns the real session, matching the signed-in user. This is
  the concrete proof the §9.2 gap is actually closed, not just reasoned
  about.
- **`POST /api/sync/push` / `GET /api/sync/pull`** with the bearer token →
  real writes and reads against the account's Durable Object, round-tripped
  correctly.
- **WebSocket**: `new WebSocket(url, ["faite-bearer.<token>"])` → handshake
  succeeded, `ws.protocol` echoed the offered value back, a `pull` request
  over the socket returned real data.
- **Cookie-based sync still works unchanged** — the ordinary browser path
  regression-checked against the same server.
- **Negative cases**, all confirmed 401 (not 500, after §9.4's second fix):
  garbage bearer token against `/api/sync/push`, `/api/places/autocomplete`
  (short-circuited to 501 first in this environment — no
  `GOOGLE_PLACES_API_KEY` set locally, so the auth fix itself wasn't
  reachable there, but the identical code path is proven by the other two
  routes), and `/api/desktop/handoff`. No auth at all on `/api/sync/push`
  → 401, unchanged from before this milestone.
- **The OS-level deep-link registration**: rebuilt and re-signed/notarized
  the real `.app` (D1.6's flow, confirmed unaffected by the two new Rust
  plugins), launched it, then `open "faite://auth-callback?code=…"` from a
  separate shell — macOS activated Faite (`lsappinfo`'s `(in front)`), no
  "no application can open this URL" error. This is the part that is
  genuinely specific to this session's `tauri.conf.json`/`capabilities`
  config (the scheme registration itself); Tauri's own plugin handling the
  JS-side dispatch is well-trodden, official behavior this session's unit
  tests already cover.

### 9.6 Two more bugs, found by Rob's first real click-through

Both invisible to every automated check (1817 tests, clippy, a live
Durable Object smoke test) because both are about the packaged app's
runtime environment, not its logic.

1. **"Couldn't open your browser to sign in."** The opener plugin needs TWO
   grants, not one: `opener:allow-open-url` enables the *command*, and a
   *scope* separately decides which URLs it may open. I granted only the
   first, so the command was callable and every URL was denied. The plugin's
   own `opener:default` set bundles `allow-default-urls` (all `https`,
   `http`, `mailto`, `tel`) to cover this. Took the narrower option instead —
   a scoped grant listing exactly `https://myfaite.app/*` and
   `http://localhost:*/*` (the `tauri dev` loop, §7.3) — since this app only
   ever opens its own hardcoded login URL. Verified the scope string is
   embedded in the shipped binary, not just the config.

   Generalizable, and the same shape as this repo's `tailwind-merge` and
   dnd-kit-sensor lessons: **a permission that names a command is not the
   same as a permission that names the command's arguments.** When a plugin
   ships a `default` permission SET, read what's in it before hand-picking
   one entry out of it — the set exists because one entry usually isn't
   enough.

2. **The in-webview `/login` and `/signup` pages were reachable, and failed
   in the worst possible way.** Every entry point had been made
   desktop-aware — except `app-header.tsx`'s "Sign up" CTA (line 123), a
   second, separate button from the account menu's "Sign in" that I'd
   already fixed. From there the webview rendered a real form that posts to
   the real API: a wrong password reports "wrong password" correctly, and a
   CORRECT password silently returns to a signed-out board, because
   `tauri://localhost` cannot hold the session cookie that comes back (D0
   §3.7). **A failure that looks like success is worse than an error**, and
   the same dead end was still reachable via "Forgot password?", the
   signup↔login footer links, and `reset-password`'s redirect — so fixing
   the one missed button was not sufficient.

   Fixed at the destination rather than the entry points:
   `DesktopAuthNotice` (`src/components/auth/desktop-auth-notice.tsx`) is
   what `/login` and `/signup` render instead of their form whenever
   `isDesktopShell()` is true. The form is not rendered at all there, so
   there is no longer any route — current or future — that lands a desktop
   user on a sign-in that cannot work. **Guard the destination, not each
   path to it**: entry points multiply, and the fourth one added later
   won't remember to check.

### 9.7 Confirmed working end to end

**Rob signed in on the desktop app with his real production credentials
and reached his real board — 2026-08-21, after the §9.6 fixes.** The full
chain is live: system browser → production `myfaite.app` login → handoff
code → `faite://` deep link → keychain token → authenticated
`useSession()` and sync. Deployed to production (worker version
`e293b3e0-0466-42df-9a52-166632e18ec2`), including the
`enableSessionForAPIKeys` cutover and both `/api/desktop/*` routes.

Not a milestone blocker, but true and worth stating: this is a genuine
daily-driver state, and D2b's absence (below) is now the sharpest edge on
it.

### 9.8 What's still open

- **`.dmg` bundling** — unaffected by this milestone, same open item as §8.4.
- **The `enableSessionForAPIKeys` caveat** (§9.2) — revisit before shipping
  a SECOND api-key consumer (EI-50's scoped external API token), since
  `permissions` are declared but enforced nowhere today.
- **CI signing** (§8.4) — local-keychain flow only.
- **EI-261 (later)** — every sign-in described here mints a brand-new
  full-access key and never revokes the previous one; the account can
  accumulate an unbounded number of `"Faite desktop"` keys. Fixed by naming
  each one per-device (`hostname()` via `@tauri-apps/plugin-os`, threaded
  through `callbackURL`'s own query string into `/api/desktop/handoff`) so
  multiple devices are distinguishable and individually revocable, rather
  than by revoking on next sign-in. That work also found and closed a real
  security hole in the scope-check fallback this section's `permissions`
  design relied on — see `docs/API.md`'s "SECURITY: the name-based scope
  fallback was removed" for the full account.

---

## 10. D2b — background sync while the window is closed

Executes EI-178's spike (`docs/DESKTOP-SYNC-TIMER-SPIKE.md`) recommendation
directly — that document did the hard research; this section is the
landing, not a redesign.

### 10.1 The mechanism

D1.5 removed the hidden `core` window because it had no job yet (§7.1). D2b
gives it one back, under a new name and a real reason to exist:

1. `main`'s `CloseRequested` handler (`lib.rs`) — already hiding the window
   per D1.5 — now also calls `background_sync::start_background_sync()`.
2. That creates a hidden (`visible: false`) webview, labeled
   `background-sync`, loading a **new, dedicated, minimal page**
   (`src/app/background-sync/page.tsx`) — not `board.html` reused hidden.
   The page mounts only `<SyncProvider />`, nothing else. Deliberately not
   the full board: a hidden window doesn't need `DndContext` or keyboard
   shortcuts, and specifically must NOT mount `DesktopAuthProvider` — Tauri's
   deep-link `onOpenUrl` is an app-wide event, not scoped to one webview, so
   a second listener would race the main window to handle the same
   `faite://auth-callback` URL.
3. A `tokio::time::interval` (30s, matching `DEFAULT_INTERVAL_MS` in
   `engine.ts` — not literally shared across the Rust/TS boundary) calls
   `window.eval("window.__faiteBackgroundSyncTick && …()")` into that hidden
   webview every tick. **This works specifically because it's Rust-driven,
   not self-scheduled**: EI-178 measured a hidden window's own JS
   `setInterval` at 1 tick out of an expected 24, and Rust-driven `eval()`
   into that same hidden window at 24/24 — `evaluateJavaScript:` wakes a
   throttled `WKWebView` for the call, per the spike's research (§3 there).
4. `sync-provider.tsx` registers `window.__faiteBackgroundSyncTick` whenever
   `isDesktopShell()` is true (harmless no-op in the main window — nothing
   ever calls it there, since Rust only `eval()`s into `background-sync` by
   label) — calling it invokes `engine.notifyRemoteChange()`, the exact same
   undebounced, `isActive()`-gated, Web-Lock-respecting trigger the socket's
   `onRemoteChange`/`onOpen` handlers already use. **The existing JS
   sync/HLC/outbox logic is completely unchanged** — Rust only calls the
   doorbell, per the spike's explicit recommendation against reimplementing
   any of it natively.
5. `RunEvent::Reopen` (the dock-icon-click handler, D1.5) calls
   `background_sync::stop_background_sync()` before showing `main` again —
   aborts the tick task and closes the hidden window. The board window's own
   `SyncProvider` never stopped running while hidden (React/Dexie state
   persists; only JS *timers* are what die), so it just resumes owning sync
   the moment it's visible again — no handoff ceremony needed on this side.

### 10.2 Why a dedicated page, and why explicitly not `DesktopAuthProvider`

Reusing `board.html` for the hidden window (D1's original design, before
D1.5 found it had no job) would have been the smaller diff. Rejected anyway:
the hidden window has no user to show a keyboard shortcut sheet or a drag
target to, and mounting `DesktopAuthProvider` there specifically would be a
correctness bug, not just waste — see §10.1 point 2. A ~10-line page beats
carrying that risk for the sake of reusing a bundle that was never sized for
this job.

### 10.3 Verified

- `cargo check --all-targets` / `cargo clippy --all-targets` — clean, zero
  warnings, first attempt (`background_sync.rs` compiled correctly against
  `tauri::async_runtime::spawn` + `tokio::time::interval` composing on the
  same runtime with no explicit runtime wiring needed).
- `npm run verify` — typecheck, lint, **1817 tests**, both Next builds,
  green. `background-sync.html` confirmed present in the `build:static`
  output route list.
- Built, signed, and notarized the real `.app` with this milestone included
  — `spctl`/`codesign` unaffected (same signing pipeline as D1.6/D2a),
  launched cleanly.
- **Rob confirmed the real close→sync→reopen sequence works** — created a
  to-do on another device while the board was closed, and it was already
  there on reopen, no manual refresh needed. This session itself had no
  Accessibility automation access to test the close/reopen click-through
  directly (`osascript`'s window-suite `close` isn't implemented by a Tauri
  window; `System Events` keystroke automation returned a clean "not
  allowed", not a hang) and traced the design by hand instead — idempotent
  start via the `Mutex<Option<JoinHandle>>` guard, teardown ordering on
  `Reopen`, the `TICK_JS` snippet's `&&`-guard against a not-yet-booted or
  already-torn-down window. The trace was right about sync working; it had
  no way to catch what visual inspection alone caught immediately — see
  §10.4.
- One adjacent question resolved while investigating, not touched: does
  `prevent_exit()`'s unconditional call on `RunEvent::ExitRequested` (D1.5)
  mean Cmd-Q is broken? No — the app menu's `SubmenuBuilder::quit()` exits
  directly, bypassing `ExitRequested` entirely; that handler only ever gates
  the "last window closed → auto-exit" path. Confirmed by reading
  `lib.rs:150`, not by testing Cmd-Q itself. Pre-existing D1.5 behavior,
  unrelated to and unaffected by D2b — noted here because it came up while
  reasoning about this milestone's process-exit edge cases, not because
  anything about it changed.

### 10.4 A real bug, found by Rob's first real close-the-board test

**The hidden window wasn't hidden.** Rob closed the board and saw a real,
visible, empty black `Faite (background sync)` window with a title bar.
`.visible(false)` on the builder was right; something downstream was
overriding it.

Root cause: `tauri_plugin_window_state::Builder::default()` (D1.5/EI-132,
registered globally, untouched by D2b's own diff) runs `restore_state()` on
**every** window it isn't explicitly told to skip. For a label it has never
seen before — true the very first time this new hidden window is ever
created — its "no saved state" branch leaves `should_show` at
`WindowState::default()`'s `visible: true` and unconditionally calls
`.show()` before this module's own code gets a chance to matter. Nothing
about D2b's own window-visibility code was wrong; a global plugin
registered for a completely different reason (persisting `main`'s geometry
across relaunches) was reaching into a window it was never meant to manage.

Fixed with `.with_denylist(&[background_sync::BACKGROUND_WINDOW])` on the
plugin registration — not `skip_initial_state`, which only skips the
restore call but still lets the plugin track and persist this window's
state on every close; a denylist excludes it entirely; the very first
check in the plugin's window-creation hook. Correct independent of the bug,
too: this window's geometry is meaningless and was never something worth
persisting.

**The general shape, worth carrying forward**: a plugin registered
globally for one window's benefit (`main`'s geometry) applies to every
window by default unless each new window is explicitly told to opt out.
Adding a new window anywhere in this app needs to ask "which of the
globally-registered plugins does this window need to be excluded from?",
not just "what does this window need to opt into?" — the failure mode is
silent and only shows up as behavior, not a compile error or a log line.

### 10.5 What's still open

- **Reconfirm after the §10.4 fix.** Sync itself was already confirmed
  working before the denylist fix landed — the visibility bug didn't break
  sync, it only meant the mechanism doing so was visible when it should not
  have been. Worth one more close/reopen pass to confirm the window is now
  actually hidden, not just that sync still works.
- **Foreground reminders while closed** — not touched by this milestone.
  D2b only restores *sync*; whether a reminder notification should also
  fire from the hidden window (and how, since `Notification` API behavior in
  a non-frontmost, hidden webview is untested) is a separate question this
  section deliberately didn't scope in.
- **Windows/WebView2** — EI-178's research (§3 there) found the same class
  of hidden-window timer-suspension problem is documented on Windows too,
  but nothing here has been run there. A D6 concern, not a D2b gap.
- **The mild redundancy this design accepts**: while `main` is hidden (not
  yet reopened), its own `SyncProvider`/WebSocket connection is still
  technically alive in memory (hiding a window doesn't unmount React) even
  though its JS timers are dead — so there are briefly two live sync
  contexts for the same account (main's dormant one, background's active
  one) rather than a clean handoff. Not a correctness risk (this app's sync
  design already tolerates N simultaneous connections for the same account
  by construction — multi-tab support has always assumed this), just a
  small, deliberately-unoptimized inefficiency: one extra idle WebSocket and
  occasional redundant polling for as long as the window stays closed.

---

## 11. Sign-out clears the device, and lands on a signed-out screen

Signing out used to end the Better Auth session and clear the keychain token,
and nothing else. That left the whole board — 12 Dexie tables, plus
`faite:bound-owner-id` — on the device, so the next person to open the app saw
the previous user's todos. Fixed by `clearDeviceData()`
(`src/lib/store/clear-device.ts`); the sequence and the clear/keep key table
live in `docs/AUTH.md` § *What sign-out does*.

Two parts of that fix are desktop-specific.

### 11.1 Why the shell needs its own landing page

The web build sends sign-out to `/`, the marketing page, which already carries
"Log in" and "Sign up". Neither exists here:

- `NEXT_PUBLIC_APP_SHELL=1` (set by `build:static`, which
  `tauri.conf.json`'s `beforeBuildCommand` runs) makes `/` an **unconditional
  redirect stub to `/board`** — see `app/page.tsx`.
- `main` opens `board.html` **directly** (§6.2), so there is no navigation
  history to fall back to either.

So `/` and a plain `location.reload()` both land the user straight back on a
board, which is the one thing signing out has to stop. Sign-out in an
app-shell build therefore goes to **`signed-out.html`**
(`src/app/signed-out/page.tsx`), a relative filename because the export is
flat `.html` served from `tauri://localhost` and `capacitor://localhost`
alike.

### 11.2 Why it is not `login.html`, and not a gate

The static export **does** contain a `login.html`, and navigating to it would
be actively wrong: `tauri://localhost` cannot hold a session cookie (§3.7),
which is the whole reason §9.1 opens the SYSTEM BROWSER for every sign-in
affordance. An in-app login form here would be a form that can never succeed.
So the page's primary action is `startDesktopLogin()`, with a line of copy
setting the expectation that the browser is about to open —
`signed-out/page.test.tsx` asserts there is no `/login` link on this path.

It is also **not a gate on `/board`**. ARCHITECTURE §2.13 is deliberate and
still holds in the shell: the board works fully with no account and offline.
This is where sign-out *lands*, not a wall — hence "Continue without an
account", which is the honest description of what the board still is. Anyone
who wants a real gate is asking for a different decision than §2.13, and
should change §2.13 first.

### 11.3 The hidden windows need nothing

`flushOutbox()` only reaches the calling document's engine, so `core` (§6.2)
and the D2b background window (§10) are missed by the flush. That is safe
rather than merely tolerable:

- The keychain token is cleared **before** `signOut()`, and `auth-client.ts`
  reads it fresh per request (§9.2), so nothing in any window authenticates
  afterwards.
- `clearDeviceData()` removes `faite:bound-owner-id`, and every engine's
  `isActive()` re-reads it on each tick — including the one
  `__faiteBackgroundSyncTick` drives through `notifyRemoteChange()` →
  `trigger()`. Both hidden windows go inactive on their own.
- They share one IndexedDB (§3.3), so the wipe is already theirs too.

No cross-window message, no Rust involvement, nothing added to
`background_sync.rs`.

### 11.4 Verified on a real build

Confirmed by Rob against a real `tauri build`, in a real display session:
signing out shows the signed-out screen rather than a board, "Sign in" opens
the system browser, the `faite://auth-callback` round trip still lands, and
the board is genuinely empty afterwards.

This closes the one gap this section shipped with. It is also the first
milestone in this document whose desktop behavior was confirmed by a human at
a display session in the same pass that wrote it — §4's standing caveat did
not have to be carried forward.

Automated coverage that backs it up, so a regression is caught without a
display session next time:

| Test | Guards |
|---|---|
| `app-header.test.tsx` | app-shell sign-out targets `signed-out.html`, never a reload |
| `signed-out/page.test.tsx` | no `/login` link on the desktop path; the board escape hatch stays |
| `clear-device.test.ts` | the wipe, the keep-list, cursor-before-tables, no network |
| `use-reminders.test.tsx` | the cleared key does not come back on a re-render |

---

## 12. Build-version check + "get the update" (EI-147)

The **cheap** half of desktop updates, shipped years ahead of the expensive
half on purpose. It does not install anything. It asks the server how old
this build is, says so when the answer is "too old", and opens the download
page in the system browser. EI-134 (`plugin-updater` + minisign keypair) and
EI-136 (tag → sign → notarize → publish) are still the real answer, and this
is deliberately not a substitute for them.

### 12.1 Why this can't wait for the updater

The desktop bundle is a frozen static export (§2 decision #2). A web deploy
cannot reach it. So the day a server change stops supporting an old client is
the day that client breaks silently and forever — **unless it was already in
the habit of asking**. A client shipped without the check can never be taught
the check. Everything else here (which version is newest, which is the floor,
where the download lives) is data the server sends, so it can change with no
client release; the only irreversible decision is whether the field asks at
all.

### 12.2 The mechanism

| Piece | File |
|---|---|
| The policy the server serves | `src/server/desktop/version.ts` |
| `GET /api/desktop/version` — unauthenticated | `src/server/desktop/routes.ts` |
| Compare + decide, shared by both halves | `src/lib/desktop/version.ts` |
| `getVersion()` / `openUrl()` wrappers | `src/lib/desktop/bridge.ts` |
| Check on launch, every 6h, and on demand | `src/components/desktop/use-desktop-update.ts` |
| The bar across the top of the board | `src/components/desktop/update-banner.tsx` |
| Settings → About: version + "Check for updates" | `src/components/settings/desktop-update-row.tsx` |
| Where the button lands | `src/app/download/page.tsx` |

Three states, from `evaluateUpdate(installed, policy)`:

- **current** — silent.
- **outdated** (`installed < latest`) — dismissible amber bar, plus the
  Settings row offering the download.
- **blocked** (`installed < minimum`) — non-dismissible red bar, `role="alert"`.
  Sync is over for this copy until it is replaced by hand.

`minimum` is the emergency lever and is set equal to `latest` today, so
nothing is blocked and nothing is out of date: the check's whole job right
now is to *exist in the field*.

### 12.3 Three decisions worth not re-litigating

**It fails towards "current", every time.** No shell, an unreadable version,
an offline check, a 500, a malformed body, a version string this can't parse
— all of them leave the app silent. The alternative failure mode is an app
that tells a user it is obsolete because their wifi dropped, and whose only
remedy is a download they also cannot do. `evaluateUpdate` refuses to block on
a version it cannot read for the same reason: the inputs are hand-edited
constants, and a typo must not brick every running copy.

**`/api/desktop/version` takes no auth at all** — the only route under that
prefix that doesn't. An app too old to sync is very likely an app that cannot
authenticate either, and the answer it needs is a public fact about the
product, not about the caller.

**`downloadUrl` must stay on `SITE_ORIGIN`.** Checked twice: `parseVersionPolicy`
drops a policy that points anywhere else, and Tauri's own
`opener:allow-open-url` allow-list (`src-tauri/capabilities/default.json`)
would refuse it regardless. Moving downloads to another host — a GitHub
release, say — means widening both, deliberately. The client check exists so
that mistake is a quiet no-op instead of a rejected `invoke` at click time.

### 12.4 The 426 the server doesn't send yet

`src/lib/sync/transport.ts` maps `426 Upgrade Required` from `/api/sync/*` to
`SyncOutdatedError` and fires a `faite:client-outdated` window event, which
makes `useDesktopUpdate` re-check immediately rather than waiting out its
six-hour timer. **No server code sends a 426 today.** It is here for the same
reverse-dependency reason as the rest of this section: the server can start
sending it in any future deploy, but only clients that already know how to
read it will do anything sensible when it arrives.

An event rather than a new `SyncOutcome` status: nothing consumes a
`SyncOutcome` for display today, so a status only this banner reads would mean
widening `runSyncCycle`, `runOnce`, `createSyncRunner` and `SyncProvider` for
one string.

### 12.5 Releasing, until EI-136 exists

Bumping the policy is the **last** step of a release, not the first:

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. `npm run desktop:build`, sign, notarize (§8).
3. Put the artifact where `downloadUrl` points.
4. Only then bump `latest` in `src/server/desktop/version.ts` and deploy.

`src/server/desktop/version.test.ts` fails if `latest` is above the version in
`tauri.conf.json` (announcing a build nobody can install) or above `minimum`
(locking everyone out with nothing to upgrade *to*).

**Getting your own machine current is a different thing, and is one command:**
`npm run desktop:install` (`scripts/desktop-install.mjs`) rebuilds from the
working tree, quits the running copy, replaces `/Applications/Faite.app`, and
relaunches. It is deliberately not a release — it bumps no version and
publishes nothing, so the update bar stays silent afterwards, which is correct.
Reach for it after any merge whose work you want to see in the Mac app; the
sync engine moves rows, not code, and will never carry a web change into an
installed build.

### 12.6 Verified

- `npm run verify` — typecheck, lint, 2,252 unit tests, both Next builds.
- Unit coverage: `version.test.ts` (comparison, the three states, the
  never-block-on-a-parse-failure rule, the off-origin URL), the server policy
  tripwires above, `update-banner.test.tsx` (all three states, dismissal, a
  failed check staying silent, the 426 event, nothing at all in a browser
  tab), `transport.test.ts` (426 → `SyncOutdatedError` + event), and
  `bridge.test.ts` (`getShellVersion`).
- **Not yet confirmed against a real signed build** — §4's standing caveat
  applies. What a display session still has to show: the bar appearing after
  `latest` is bumped server-side, and "Get the update" opening the system
  browser at `/download` (the `opener` allow-list is the risk, and it is
  already correct on paper).

---

## 13. EI-254 spike — hot asset bundle (in progress)

Re-opens **decision #2** (§2). The question: can a web deploy reach an
installed `.app` without a `cargo build`, without moving the webview's origin,
and without ever producing a copy that fails to boot?

**So far: yes, on all three.** Ticket
[EI-254](https://linear.app/rob-erskine/issue/EI-254/d-spike-hot-asset-bundle-a-web-deploy-reaches-installed-desktop-apps),
runbook `.ai/ei-254-hot-assets-runbook.md`.

**The probe is not on `main`.** It lives on
`rob/ei-256-hot-assets-24-download-verify-whole-activate-atomically`, where
EI-256 turns it into the real implementation — same rule `d0_probe.rs` got, and
for a sharper reason than tidiness: the probe activates whatever directory it
finds, with no signature and no manifest check. That was the right shape for
answering a question on one machine. On `main` it would be an unverified
asset-load path inside a signed, notarized app.

### 13.1 The mechanism, and why not the two obvious ones

`Context::set_assets` (`tauri-2.11.5/src/lib.rs:423`) replaces the provider
*behind* the existing `tauri://localhost` protocol, and hands back the embedded
provider so it can be kept as a fallback. `trait Assets` is four methods
(`setup`, `get`, `iter`, `csp_hashes`); `AssetKey` is a rooted unix path, so a
disk provider is `root.join(key.trim_start_matches('/'))`.

The two obvious alternatives both move the **origin** — a remote `frontendDist`,
or a custom URI scheme. On WKWebView a new origin is a new IndexedDB, which
would orphan the user's entire local board, and Tauri ships no migration for
it. That is disqualifying on its own. Remote-load is *additionally* discouraged
by Tauri's own docs, with two origin-matching CVEs behind the warning.

One API wrinkle, worth not rediscovering: the replacement must *hold* the
provider it replaces, so the extraction takes two calls with a throwaway
(`NoAssets`) in between. There is no one-call form.

### 13.2 Evidence

Against a real ad-hoc-signed release build, launched from the terminal so
stderr is readable:

| Check | Result |
|---|---|
| Swap engages, serves the disk copy | **PASS** — `embedded=23511 bytes, serving=23773 bytes`; the second number is exactly the size of the file on disk, which carried an edit the binary had never seen |
| A web change reaches the app with **no** `cargo build` | **PASS** — same binary, edited bundle, relaunch |
| Bundle with no entry document (half-extracted) | **PASS** — gate refuses it, zero swap lines, app boots embedded |
| A file deleted from an otherwise-valid bundle | **PASS** — that file falls back to the binary's copy, app boots |
| Path traversal out of the bundle root | **PASS** — refused, falls back (unit test) |

Seven unit tests in `hot_assets.rs` cover the provider's decision table
directly (disk wins, nested paths, missing file, file deleted *after* startup,
traversal, `iter` key shape, the entry-document gate). `cargo test --lib`, 7
passed.

**Numbers.** Export 14 MB raw, **3.8 MB gzipped** — the realistic download.
Binary 13 MB, unchanged by the probe (the embedded copy still ships; it is the
fallback).

### 13.3 The finding that changes the design

**Per-file fallback is a correctness hazard, not just a safety net.** It kept
the app alive when a chunk was deleted — by serving *that chunk from the
binary* alongside HTML from disk. Across two different builds that is a
Frankenstein page: new markup, stale chunk, no error anywhere.

So the production shape is **all-or-nothing**, decided before activation: the
bundle carries a manifest, every file in it is verified present (and hashed) at
startup, and a bundle that fails verification is rejected *whole* in favour of
the embedded copy. Per-file fallback then only ever fires for paths the
manifest never claimed. The probe deliberately has the weaker behaviour, which
is how the hazard surfaced at all.

### 13.4 Not yet answered

- **Dexie contents across a swap** — the origin provably does not change, so
  this holds by construction, but it has not been *observed*. §4's standing
  caveat applies: needs a display session.
- **Rendering under the shipped CSP** — the app boots and stays alive, but
  nothing here has looked at the window. Expected fine (`script-src` already
  carries `'unsafe-inline'`, so `csp_hashes` returning empty costs nothing).
- **The D2b background webview** — answered by construction (the provider is
  per-`App`, not per-window), not by test.
- **Apply choreography** — swap-on-next-launch is what the probe does.
  Whether the EI-147 bar should say "Restart to update" is a product call.
- **Download, signature, manifest, server policy** — the build, not the spike.
