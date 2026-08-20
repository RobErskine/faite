# Desktop D1.5 runbook — installable, dock-resident Faite.app

**Self-contained handoff.** Everything needed to execute D1.5 without
re-deriving it. Written 2026-08-20. Read `docs/DESKTOP.md` §1–§6 for the
architecture decisions and the D0/D1 findings this builds on;
`docs/DESKTOP-SYNC-TIMER-SPIKE.md` for the background-timer measurements.

**Goal:** Rob can `cp` a real `.app` into `/Applications`, Cmd-Tab to it, and
use Faite as a daily driver without a browser. Close the window → app stays in
the dock → click the dock icon → window returns.

---

## 1. Where the track actually is

**D1 complete, D2 not started.** Last functional desktop commit `335644a`
(2026-08-16, EI-129/130/131/132); `60343de` (08-19) only regenerated icons.
There is no `rob/d2-*` branch anywhere.

**Nothing in D1 has ever been launched** — `docs/DESKTOP.md` says
"compile-verified only" three times (§6.2, §6.4, §6.5). D1.5 is the first
milestone that runs the app.

On `main` today: `src-tauri/` scaffold, `tauri.conf.json`, `build.rs` freshness
guard, real branded icons (`scripts/icons/generate.mjs` → `npx tauri icon`),
`main` + hidden `core` windows, native macOS app menu, `tauri-plugin-window-state`,
and `src/lib/desktop/bridge.ts` (`isDesktopShell()` — nothing consumes it).

Absent: any npm script for tauri, any `bundle.macOS` signing config, any
`#[tauri::command]`, desktop in CI, `tauri://localhost` in `TRUSTED_ORIGINS`,
and the Better Auth `bearer` plugin.

## 2. Two findings that shape everything

### 2.1 The board already works with no account

`/board` has **no auth guard** — no middleware, no redirect, no session read
that can block render (`src/app/board/page.tsx`; `docs/ARCHITECTURE.md` §2.13
explains why a gate was deliberately rejected). Signed-out is first-class:
`getCurrentOwnerId()` returns `LOCAL_OWNER_ID` (`src/lib/store/owner.ts`), the
sync engine and `ws-transport` both early-return on `isActive()` with zero
network and zero error spam, and the **entire** Playwright suite runs
signed-out (`e2e/support/fixtures.ts` clicks "Continue without an account").

So a bundled static export in a Tauri window is a fully working board today.
It just isn't synced.

### 2.2 Login from the desktop shell is genuinely blocked until D2a

macOS pins the webview origin to `tauri://localhost`. Tauri v2's scheme
override (`useHttpsScheme`) is Windows/Android only — no macOS escape hatch.
That origin is neither a secure origin nor a valid domain, so Better Auth's
cookie session cannot be established. D0 §3.7 measured it: no
`Access-Control-Allow-Origin`, and `HTTP 401` on the WebSocket upgrade.

**Tauri's HTTP plugin does not rescue this.** Investigated 2026-08-20 and
rejected with evidence: the reqwest jar and webview jar are independent stores
([tauri#13045](https://github.com/tauri-apps/tauri/issues/13045)), http-only
cookies aren't persisted across launches
([tauri#11518](https://github.com/tauri-apps/tauri/issues/11518)), and socket
connections never receive the cookie. Faite's sync v1 is WebSocket push
(`src/server/sync/ws-server.ts`), so the plugin buys a working `/api/auth` call
and a dead sync transport.

**`docs/DESKTOP.md` decision #3 (bearer tokens) is confirmed correct** — now
empirically, not just by reasoning.

### 2.3 Product decision recorded

Rob wants the shipped desktop app to **require an account**. That is a decision
about what ships, deliberately separated from what he installs locally this
week — see §5's sequencing. Local todos are not stranded by that separation:
`adoptLocalData()` (`src/lib/store/adopt-owner.ts`) rewrites `ownerId` from
`local-user` in one transaction and enqueues an outbox row per record, so first
sign-in pushes them up while sync pulls his web todos down.

## 3. Three bugs to fix (all in never-launched D1 code)

1. **`prevent_exit` with no reopen path** (`src-tauri/src/lib.rs:84`). Closing
   the board leaves the process alive with no reachable window and no way back
   but Cmd-Q. Rob's answer to "what should closing do" makes this the right
   *intent*, just half-implemented.
2. **The hidden `core` window loads `board.html`** (`lib.rs:56`) — a second full
   copy of the board with no job until D2b, doubling RSS and running a second
   bootstrap against the same IndexedDB.
3. **`build.rs` hard-panics** when any file under `src/` is newer than
   `.next-static/`, on *every* cargo build including the `devUrl` dev loop where
   `.next-static` isn't even served. One edit bricks `tauri dev`.

## 4. The work

### 4.1 `src-tauri/src/lib.rs` — hide-on-close, show-on-reopen

Standard macOS pattern. **Hide, don't destroy** — reopening is then instant and
doesn't re-run the board's Dexie bootstrap or lose in-memory state.

- `main` window: handle `WindowEvent::CloseRequested` → `api.prevent_close()`
  then `window.hide()` (macOS only).
- Keep `RunEvent::ExitRequested` → `api.prevent_exit()`.
- Add `RunEvent::Reopen` → get `main`, `show()`, `set_focus()`. This is the
  documented v2 dock-click hook
  ([tauri#3084](https://github.com/tauri-apps/tauri/issues/3084),
  [78839b6](https://github.com/tauri-apps/tauri/commit/78839b6d2f1005a5e6e1a54b0305136bae0c3a7c)).
- Delete the `CORE_WINDOW` const and its builder block — `prevent_exit` already
  keeps the app alive, so `core` was only carrying a comment. D2b re-adds it
  when it has a job. Update `capabilities/default.json` `windows` → `["main"]`.
- Leave `app_menu()`, the window-state plugin, and the `main` builder otherwise
  alone.

Consequence to write down in the doc, not a regression: a hidden-on-close
window has suspended JS timers (D0 §3.4), so sync stops while the window is
closed. That is exactly D2b's problem.

### 4.2 `src-tauri/build.rs` — stale becomes a warning

Keep the hard `panic!` for **missing or empty** `.next-static/`. Change the
*staleness* branch to `println!("cargo:warning=…")`. Safe because `tauri build`
runs `beforeBuildCommand` (which re-runs `build:static`) before cargo — the
shipping path cannot produce a stale bundle, so the panic only ever fired where
it was wrong. Record as a deliberate revision of `docs/DESKTOP.md` §6.1.

### 4.3 `src-tauri/tauri.conf.json`

- Add `bundle.macOS.signingIdentity: "-"` (ad-hoc). A locally built `.app`
  carries no quarantine xattr so Gatekeeper won't prompt; ad-hoc signing is what
  stops Apple Silicon treating it as damaged
  ([Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)).
- Add `build.beforeDevCommand: "npm run dev"` so `tauri dev` boots the server
  its `devUrl` already points at. **Useful side effect:** the dev loop's origin
  is `http://localhost:3000`, which *is* in `TRUSTED_ORIGINS` — so `tauri dev`
  has working auth and sync today, and previews what D2a will feel like.
- CSP unchanged.

### 4.4 `package.json`

```
"desktop:dev":   "tauri dev",
"desktop:build": "tauri build",
```
Document install in `docs/DESKTOP.md` rather than scripting it — a script that
`rm -rf`s a path in `/Applications` isn't worth the keystrokes:
```
npm run desktop:build
cp -R src-tauri/target/release/bundle/macos/Faite.app /Applications/
```

### 4.5 `src-tauri/Cargo.toml`

Still `tauri init` defaults: `description = "A Tauri App"`, `authors = ["you"]`,
empty `license`/`repository`. Fill in.

### 4.6 `docs/DESKTOP.md`

- Add the **D0–D6 milestone table** the doc's own preamble (line 5) tells
  readers to consult. It does not exist — stale cross-reference.
- New §7 "Running it on your own Mac": build/install commands, the
  `NEXT_PUBLIC_AUTH_URL` requirement (§3.2) and where it's baked in
  (`beforeBuildCommand`, *not* `npm run build:static`), what local-only mode
  does and doesn't do, adoption-on-sign-in.
- Record the D1 reversals (§4.1, §4.2 above) and §2.2's HTTP-plugin finding so
  decision #3 carries evidence.

## 5. Sequencing after D1.5

- **D1.6** — Developer ID + notarization. Rob is enrolled in the Apple Developer
  Program. Also unblocks D0 §3.6's open TCC identity check (does the D5 Swift
  sidecar inherit the app's Accessibility grant, or show a second alarming row
  in System Settings?).
- **D2a** — desktop login + sync; this is where the account requirement becomes
  real. Order: (1) `tauri://localhost` → `TRUSTED_ORIGINS` (`src/server/auth.ts:10`),
  one line, feeds `cors.ts` and `isAllowedWsOrigin` for free. (2) Better Auth
  `bearer` plugin server-side — note `src/server/auth-tokens.ts`'s
  `apiTokenPlugin` is **not** this and cannot substitute, it's deliberately
  inert (`enableSessionForAPIKeys: false`). (3) `keyring` crate + first
  `#[tauri::command]` get/set pair; `bridge.ts` grows `getAuthToken()`.
  (4) Inject `Authorization: Bearer` into `auth-client.ts` (via
  `fetchOptions.customFetchImpl`) and `src/lib/sync/transport.ts`.
  (5) **Open question — browser `WebSocket` cannot set headers**, so
  `ws-transport.ts` needs the token via query param or subprotocol and
  `ws-server.ts` must accept it. Decide before starting; only undesigned piece.
  (6) Then gate the desktop build on a session.
- **D2b** (EI-145) — background sync while the window is closed. EI-178 already
  measured the answer: Rust `tokio::time::interval` → `window.eval()` into a
  hidden webview got 24/24 ticks vs 1/24 for a self-scheduled JS timer. Also
  needs `src/lib/sync/engine.ts`'s three `visibilityState === "visible"` gates
  relaxed — today the loop never even arms in a hidden window, a separate
  problem stacked on WebKit's suspension.

## 6. Verification

Automated:
- `npm run verify` (typecheck, lint, 1577 tests, `build`, `build:static`)
- `cd src-tauri && cargo clippy --all-targets` — must stay zero-warning
- `npm run e2e:ci` — unaffected; confirm green

Manual smoke — **the part D1 never did**:
1. `npm run desktop:build`, copy to `/Applications`, launch from Spotlight.
2. Board renders with the "Add a to-do" input. Guards D0 §3.2's
   `BetterAuthError: Invalid base URL: tauri://localhost` boot crash — a bundle
   built without `NEXT_PUBLIC_AUTH_URL` shows a blank window.
3. Create a todo → Cmd-Q → relaunch → still there.
4. Resize/move → quit → relaunch → geometry restored
   (`tauri-plugin-window-state`, never verified).
5. Menu bar shows Faite/Edit/Window; Cmd-C/V/A work in the todo input.
6. **The dock behaviour:** Cmd-W closes the window, app stays in the dock; click
   the dock icon → same window returns, focused, state intact. Cmd-Q quits.
7. Cmd-Tab shows Faite with the branded icon.
8. `ps -o rss= -p $(pgrep -x Faite)` — records the signed-bundle, single-window
   footprint D0 §3.8 flagged as unmeasured and `.ai/wave-4-runbook.md` tracks as
   EI-180. Expect well under D0's pessimistic 82–106 MB.
