# Desktop background-sync timer mitigation spike (D2, EI-178)

> **This spike's §4 recommendation shipped as D2b, 2026-08-21** —
> `docs/DESKTOP.md` §10, `src-tauri/src/background_sync.rs`. Read this
> document for the research and the measurements; read §10 for what
> actually landed and how it was verified. "Nothing here ships" (below)
> refers to the throwaway probe harness itself (§6) — the *recommendation*
> it produced is now real, shipped code.

**Status: research + working prototype, both real.** This spike reproduces
D0's finding, tests three candidate mitigations against an actual compiled
Tauri v2 binary on this machine (not simulated), and gives EI-145
("Rust-arbitrated sync ownership") a recommendation backed by measured
results. Nothing here ships — like D0, this is throwaway spike code.

Read D0's finding first if you haven't: `docs/DESKTOP.md` §3.4 — a hidden
(`visible: false`) `WebviewWindow`'s JS `setInterval` fires once and then never
again, killing the planned design where a hidden background webview runs the
sync engine's ~30s poll loop while the main board window is closed.

> **Only this document was merged.** The probe harness that produced the numbers
> below (`src-tauri/src/ei178_probe.rs`, `ei178-static/probe.html`, and the
> `src-tauri/` scaffold changes described in §6) deliberately stays off `main`,
> following the same decision that removed D0's `d0_probe.rs` in PR #14 —
> throwaway spike code does not live in shipped desktop code. It remains
> recoverable from PR #13 and its branch `rob/ei-178-bg-sync-timer-spike`:
>
> ```bash
> git checkout rob/ei-178-bg-sync-timer-spike -- \
>   src-tauri/src/ei178_probe.rs ei178-static/probe.html
> ```
>
> §6 describes those files as they exist on that branch, so it reads as a
> recovery map rather than an inventory of `main`.

---

## 1. What was tested

A new throwaway probe harness, `src-tauri/src/ei178_probe.rs` (same
report-over-localhost-POST pattern as D0's `d0_probe.rs`, different port),
gated by `FAITE_EI178_PROBE=1`. Frontend is a one-line static HTML file
(`ei178-static/probe.html`) instead of the real Next.js export — this spike
only needed a webview to run JS in, not the real board, so building the full
static export was unnecessary weight.

Four windows, all created in the same process, same run, running
concurrently for ~100s (long enough to see 20+ ticks at a 4s period if a
timer is healthy — D0 used 110s at a 5s period for the same reason):

| Window | Setup | Timer mechanism |
|---|---|---|
| `hidden_js` | `visible: false` | JS `setInterval`, 4s — **the D0 control**, reproduced here |
| `hidden_rust_eval` | `visible: false` | **No JS timer.** A Rust `std::thread` loop calls `window.eval()` into it every 4s |
| `offscreen_visible` | `visible: true`, positioned at `(-8000, -8000)` | JS `setInterval`, 4s |
| `minimized` | `visible: true`, then `.minimize()` (AppKit miniaturize) | JS `setInterval`, 4s |

Run twice: once as a baseline, once with the whole process wrapped in an
`NSProcessInfo.beginActivityWithOptions(.userInitiated, reason:)` App-Nap
opt-out token (`FAITE_EI178_NSACTIVITY=1`), via the `objc2`/`objc2-foundation`
crates (already present in `Cargo.lock` transitively through `wry`/`tao`, so
no new network fetch was needed — this repo's cargo registry cache had them).
Both runs built and ran with `cargo build --features tauri/custom-protocol`
+ direct binary execution, fully offline (`--offline`), per D0's documented
dev-loop pitfall (§3.9 of `docs/DESKTOP.md`).

## 2. Results

Tick counts over the ~100s run (expected ~24 at a healthy 4s cadence):

| Window | Baseline | With NSActivity opt-out |
|---|---|---|
| `hidden_js` (JS timer, hidden) | **1** | **1** |
| `hidden_rust_eval` (Rust-driven `eval()`, hidden) | **24** | **24** |
| `offscreen_visible` (JS timer, visible+off-screen) | **23** | **21** |
| `minimized` (JS timer, miniaturized) | **1** | **1** |

Raw JSONL for both runs was captured locally (`ei178-probe-results-run1-baseline.jsonl`,
`ei178-probe-results-run2-nsactivity.jsonl`, git-ignored — same pattern as
D0's `d0-probe-results.jsonl` — reproducible by rerunning the harness, not
checked in as they're multi-KB debug logs, not source).

### 2.1 `hidden_js` — D0's finding reproduced exactly

Confirms D0 §3.4 was not a fluke or specific to that spike's setup: a hidden
window's self-scheduled JS `setInterval` ticks once (`timer_start` +
one `timer_tick`, `elapsedMs: ~4071`) and then goes completely silent for
the rest of a 100s run, in both the baseline and NSActivity runs.

### 2.2 Investigation question #1 — does Rust-driven `eval()` reach a suspended webview? **YES, reliably.**

`hidden_rust_eval` got all 24 expected ticks, evenly spaced (~4000–4010ms
average interval, matching the Rust-side schedule almost exactly), for the
entire run, in **both** the baseline and NSActivity conditions — while
`document.hidden === true` / `visibilityState: "hidden"` the whole time, and
while its sibling `hidden_js` window (same process, same visibility state,
same run) went dark after tick 1.

**This is the answer to the ticket's key open question.** Whatever suspends
a hidden window's *self-scheduled* JS timers does not block a *Rust-side,
externally-triggered* `window.eval()` call from reaching and executing in
that same hidden webview. This matches independent evidence found during
research (§3 below): `evaluateJavaScript:completionHandler:` is documented
(informally, via Apple Developer Forums threads on WKWebView + App Nap) to
"wake" a throttled `WKWebView`'s Web Content process for the duration of the
call, similar in effect to `beginActivityWithOptions:reason:` — this spike's
result is consistent with that and extends it to the window-occlusion case
D0 found, not just process-level App Nap.

### 2.3 Investigation question #2 — does "visible but occluded" avoid the suspension? **YES, for off-screen positioning.**

`offscreen_visible` (still `visible: true`, just parked at `(-8000, -8000)`,
never actually on any physical or virtual display) ticked 23/24 (baseline)
and 21/24 (NSActivity run) times — not a perfect 24, but overwhelmingly
healthy and clearly a live, un-suspended timer (`visibilityState: "visible"`
throughout), a completely different regime from `hidden_js`'s 1-tick death.
The 1–3 "missing" ticks look like ordinary scheduling jitter accumulating
over a 100s run with 4s-granularity polling from the Rust side to arm things
and the JS side's own `Date.now()`-based `elapsedMs` tracking, not
suspension — there's no cliff, ticks kept arriving right up to the run's
natural end in both runs.

**`minimized` did *not* get this same protection** — `.minimize()`
(AppKit `miniaturize:`, a different call than `.hide()`) also produced only
1 tick in both runs, `visibilityState: "hidden"` throughout. So the
mitigation is specifically "stay `visible: true` and never truly occluded/
miniaturized" — a window that's visible-but-off-screen works, but the
`hide()`/`minimize()` window-state transitions both trigger the same timer
suspension. This is a concrete, actionable distinction D2 needs: whatever
window-state API is used to keep the background webview "out of the way" of
the user, it must not be `hide()` or `minimize()`.

*(Activation-policy testing — `NSApplication.ActivationPolicy.accessory` vs
`.regular` — from the ticket's investigation point #2 was not reached in
this spike; see §4 "Not done" below.)*

### 2.4 Investigation question #4 — is this App Nap, or something else? **Not App Nap — window-level WebKit/AppKit occlusion suspension.**

Two independent pieces of evidence, both from data already in hand:

1. **The NSActivity opt-out changed nothing.** `hidden_js` and `minimized`
   both stayed at exactly 1 tick with `NSActivityUserInitiated` held for the
   entire process lifetime — the option that Apple's own docs and
   lapcatsoftware.com's writeup (§3 below) describe as the standard way to
   prevent App Nap. If App Nap were the mechanism, this should have fixed or
   at least measurably changed `hidden_js`'s behavior. It didn't, at all —
   identical results, tick for tick, timestamp for timestamp within noise.
2. **Other windows in the same process kept ticking normally the whole
   time.** If App Nap (a whole-*process*-level power state, applied when a
   process has no visible windows and isn't doing user-facing work) were
   suspending `hidden_js`'s timer, it should have suspended
   `offscreen_visible`'s timer too — they're the same process, same run,
   same moment. It didn't: `offscreen_visible` ticked ~23/24 times while
   `hidden_js` ticked once. A process-wide power state can't explain a
   per-window difference within the same process at the same time.

Both point at the same conclusion: this is **per-window** WebKit/AppKit
occlusion-driven JS-timer suspension (the window's own `WKWebView` losing
scheduling priority when AppKit considers it non-visible/miniaturized), not
macOS App Nap. App Nap is a real, separate mechanism (well documented — see
§3) that could theoretically compound with this on a fully backgrounded app
with zero visible windows, but it is not what D0 or this spike measured, and
opting out of it does not fix the problem this ticket is about.

## 3. Research (Tauri docs, GitHub issues, Apple docs/forums)

- **Tauri maintainer take on hidden-window throttling** (GitHub Discussion
  [tauri-apps/tauri#8174](https://github.com/tauri-apps/tauri/discussions/8174)):
  a maintainer confirms hidden windows are the standard pattern for
  background JS work in Tauri and describes background throttling as
  "mostly just about animations and setInterval" — consistent with what
  this spike found (JS timers specifically die; the window and its JS
  context otherwise keep working, since `eval()` still reaches it), though
  the maintainer's framing undersells how total the `setInterval` death
  actually is (one tick, then zero, not "slower").
- **`tauri-plugin-background-service`** ([crates.io](https://crates.io/crates/tauri-plugin-background-service),
  [docs.rs](https://docs.rs/tauri-plugin-background-service/latest/tauri_plugin_background_service/)):
  a third-party Tauri v2 plugin for long-lived background tasks. Its desktop
  implementation is documented as "plain `tokio::spawn`" — i.e., a pure
  native Rust task with **no webview involvement at all** — while mobile
  platforms get real OS-specific keepalive (Android foreground service, iOS
  `BGTaskScheduler`). This is independent confirmation from the wider Tauri
  ecosystem that the robust pattern for background work is to get off the
  webview's JS execution context entirely when possible, which lines up with
  this spike's recommendation below.
- **The same failure mode on Windows/WebView2**, not just macOS/WebKit:
  [tauri-apps/tauri#5147](https://github.com/tauri-apps/tauri/issues/5147)
  reports `setInterval` stopping ~5–6 minutes after minimizing on Windows 10
  + WebView2, and
  [MicrosoftEdge/WebView2Feedback#3070](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3070)
  documents WebView2 throttling JS to 1s-granularity when
  `Visibility.Collapsed` is set. Useful context for D2/D6: this is a
  cross-platform "background webview" problem in general, not a
  macOS/WKWebView-only quirk — Windows will very likely need the equivalent
  of §2.3's "stay visible, move off-screen" or §2.2's "drive ticks from
  native code" treatment too, though this spike only tested macOS.
- **Electron's `backgroundThrottling: false`** ([Electron docs](https://www.electronjs.org/docs/latest/api/structures/web-preferences)):
  Electron/Chromium expose this as a first-class, documented
  `BrowserWindow` option specifically to keep `visibilityState` reporting
  `"visible"` even when minimized/occluded/hidden. Tauri/WRY/WKWebView has
  no equivalent public API — the closest is the private, App-Store-rejection-risk
  `WKWebViewConfiguration` key `alwaysRunsAtForegroundPriority` (documented
  informally via [ionic-team/cordova-plugin-ionic-webview#286](https://github.com/ionic-team/cordova-plugin-ionic-webview/issues/286)
  and PR [#45](https://github.com/ionic-team/cordova-plugin-ionic-webview/pull/45))
  — **not recommended for Faite**, since it's a private API and this spike
  found a working alternative (§2.3) that needs no private API at all.
- **`evaluateJavaScript` "waking" a throttled `WKWebView`**: an Apple
  Developer Forums thread ([developer.apple.com/forums/thread/671830](https://developer.apple.com/forums/thread/671830))
  on WKWebView + App Nap describes macOS suspending the WebView's Web
  Content process and `evaluateJavaScript:completionHandler:` "waking" it
  back up, similar in effect to `beginActivityWithOptions:reason:`. This
  spike's §2.2 result is consistent with, and empirically extends, that
  forum report from the App-Nap case to the window-occlusion case.
- **App Nap / `NSActivity` mechanics**: Apple's own
  [Energy Efficiency Guide for Mac Apps: Extend App Nap](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html)
  and [lapcatsoftware.com's "Prevent App Nap Programmatically"](https://lapcatsoftware.com/articles/prevent-app-nap.html)
  — used to build the `NSActivity` opt-out tested in §2.4 and to correctly
  interpret its (negative) result.
- **General Tauri hidden-window issue tracker sweep** — nothing found that
  contradicts this spike's results; several open issues
  ([#14088](https://github.com/tauri-apps/tauri/issues/14088),
  [#10580](https://github.com/tauri-apps/tauri/issues/10580),
  [#12570](https://github.com/tauri-apps/tauri/issues/12570)) describe other,
  unrelated hidden-window bugs (crashes after extended hidden idle time on
  Windows, black-screen-on-fullscreen-hide on macOS) worth being aware of
  for D2/D6 but not directly relevant to the timer-suspension question.

## 4. Recommendation for EI-145 ("Rust-arbitrated sync ownership")

**Primary: Rust-driven ticks into a genuinely hidden webview (investigation
option 1), using `window.eval()` — confirmed working, not just
theoretically sound.** Concretely:

1. When the board window closes, Rust (already the arbiter per D0's
   decision #4) creates/keeps alive a `visible: false` background webview
   loading the same static export.
2. Rust runs its own periodic timer — `tokio::time::interval` is the natural
   fit here since Tauri already runs a Tokio runtime (this spike used
   `std::thread` + `sleep` only to avoid adding a dependency for a
   probe-only binary; `tokio::time::interval` is a drop-in equivalent for
   the real implementation and composes better with the rest of an async
   Rust codebase) — at the sync engine's ~30s cadence.
3. Each tick, Rust calls `window.eval(...)` with a small script that invokes
   a JS-side sync-trigger function already exposed on `window` by the sync
   engine (`src/lib/sync/engine.ts`) — i.e., Rust becomes the scheduler,
   the existing JS sync/HLC/outbox logic stays exactly as-is and just gets
   invoked externally instead of self-scheduling. This is a much smaller
   change than option 3's "reimplement sync in Rust" and this spike found
   no evidence it's necessary.
4. **Do not** rely on `NSActivity`/App-Nap opt-out to fix this — §2.4 shows
   it doesn't, and it would be a no-op complication if added anyway.

**Secondary/complementary, not a replacement: keep the window `visible:
true` but positioned off-screen, never `hide()`d or `minimize()`d.** §2.3's
result means this alone might work without any Rust-side eval-driving at
all — the JS sync engine's own `setInterval` could just keep running
undisturbed. This is architecturally simpler (no Rust↔JS tick bridge to
build/maintain) but has real product-experience costs worth weighing before
choosing it as primary: an off-screen `NSWindow` still exists in the window
list (Mission Control / Dock right-click "Show All Windows" could surface it
to a curious user), and depending on how "off-screen" is
implemented, some multi-monitor or Spaces configurations could theoretically
put those coordinates on a real display. The Rust-driven-eval approach has
no such leakage risk, which is why it's the primary recommendation — but if
D2 wants the simpler code path first and can accept/mitigate the
window-list-visibility wrinkle (e.g. `skip_taskbar`/exclude from window
cycling, which Tauri supports), option 2.3 is a legitimate, separately-confirmed
fallback or even a defense-in-depth pairing with option 1.

**Not recommended as primary, keep as documented fallback:** investigation
option 3 (a fully native Rust scheduler that bypasses the JS sync engine and
reimplements HLC/outbox logic in Rust). This spike found no evidence it's
needed — option 1 (Rust ticks → existing JS sync engine via `eval()`) gets
the same reliability without the cost of a second implementation of
sync/HLC/outbox logic that has to be kept in lockstep with the TS one. Keep
it noted as the nuclear option per the ticket, in case a future finding
(e.g. Windows/WebView2 behaving differently per §3's cross-platform note, or
notarization/sandboxing restricting `eval()` some other way) invalidates
option 1.

## 5. Needs Rob / not done in this spike

- **`NSApplication.ActivationPolicy` (`.accessory` vs `.regular`)** — ticket
  investigation point #2's second half. Not tested; would need a small
  addition to the probe (set the policy via `objc2-app-kit`, already cached
  in this repo's registry per §1) before window creation and rerun. Given
  §2.3 already found a working, simpler mitigation (off-screen positioning)
  and §2.4 already isolated the mechanism to per-window occlusion (where
  activation policy, a process-level setting, is a less likely lever), this
  was deprioritized rather than skipped for lack of time to attempt — worth
  a follow-up run before D2 fully locks the design, but not blocking the
  recommendation above.
- **Windows/WebView2 and Linux/WebKitGTK verification.** §3's research
  found the same class of problem is documented on Windows (WebView2); this
  spike only ran on macOS (this machine). D2/D6 will need an equivalent
  probe run on Windows before shipping a Windows build, per the plan doc's
  eventual Windows milestone.
- **Real Rob presence**, per D0's own needs-Rob list (Accessibility grant,
  TCC identity check, Firefox AX behavior, signed-build footprint) — none of
  those are re-tested here since they're orthogonal to the timer question,
  but they remain open from D0.

## 6. Files this spike added/changed (on branch `rob/ei-178-bg-sync-timer-spike`, not on `main`)

- `src-tauri/src/ei178_probe.rs` — the probe harness described in §1.
  `FAITE_EI178_PROBE=1` runs it; `FAITE_EI178_NSACTIVITY=1` additionally
  holds the App-Nap opt-out token for the run. Not wired into any
  non-probe build path (same convention as D0's `d0_probe.rs`, since removed
  from `main` by PR #14 as part of EI-129). This branch was cut from `main`
  before D0's scaffold landed, so it doesn't carry D0's Next.js-export
  plumbing; see §1 for why a plain static HTML file was enough here.
- `src-tauri/src/lib.rs` — branches on `FAITE_EI178_PROBE` instead of
  `FAITE_D0_PROBE`; non-probe fallback path now points at `probe.html`
  since this branch has no Next.js static export wired up (this branch
  never needed the real board — see §1).
- `ei178-static/probe.html` — one-line static HTML page, the frontend both
  probe and non-probe code paths load. Deliberately not the real Next.js
  export (unnecessary weight for a pure-timer question).
- `src-tauri/Cargo.toml` — added `objc2` / `objc2-foundation` (macOS-only
  target dependency, features `NSProcessInfo` + `NSString`) for the
  `NSActivity` opt-out test in §2.4. Both were already present in
  `Cargo.lock` transitively (via `wry`/`tao`) at exactly the versions this
  repo's local cargo registry cache had, so promoting them to direct
  dependencies required no network access — the whole spike, including both
  probe runs, was built and executed fully offline (`cargo build --features
  tauri/custom-protocol --offline`).
- `src-tauri/tauri.conf.json` — new `identifier`/`productName`
  (`app.myfaite.desktop.ei178probe`), `frontendDist` pointed at
  `../ei178-static`, `devUrl`/`beforeBuildCommand` removed (no dev-server or
  Next.js build needed for this spike), CSP narrowed to just `'self'` +
  the probe's own `http://127.0.0.1:8798` report port.
- `src-tauri/{Cargo.lock,build.rs,capabilities/,icons/,.gitignore}`,
  `package.json`/`package-lock.json` (`@tauri-apps/cli` dev dependency),
  `eslint.config.mjs` (`src-tauri/**` ignore) — carried over unchanged from
  D0's already-reviewed scaffold rather than re-deriving them. That scaffold
  has since landed on `main` (PRs #1 and #14), which is why re-basing this
  branch would collide with it rather than build on it.
- `.gitignore` — added `ei178-probe-results*.jsonl` (this spike's own
  scratch output, same treatment as D0's `d0-probe-results.jsonl`).

Both probe runs' raw JSONL output (57 and 55 report lines respectively) were
reviewed directly (not summarized by a second layer of tooling) to produce
the counts in §2 — the Python one-liner used to tabulate them is not
checked in, but is trivial to reproduce: group the JSONL by `label`+`kind`
and count.
