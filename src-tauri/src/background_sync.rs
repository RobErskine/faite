//! D2b: sync while the board window is closed.
//!
//! **Why a Rust-driven timer at all.** A hidden (`visible: false`)
//! `WebviewWindow`'s own JS `setInterval` fires once and then never again —
//! measured directly (D0 spike, `docs/DESKTOP.md` §3.4) and confirmed again
//! against a real compiled binary with a dedicated probe (EI-178,
//! `docs/DESKTOP-SYNC-TIMER-SPIKE.md`). The same spike also confirmed the
//! fix: a Rust-side timer calling `window.eval()` into that same hidden
//! webview reaches and executes reliably (24/24 ticks vs 1/24), because
//! `evaluateJavaScript:` wakes a throttled `WKWebView` for the call —
//! whatever suspends a *self-scheduled* JS timer does not block an
//! *externally triggered* one. This module is that mechanism, landed for
//! real (the spike's own harness was throwaway and never shipped).
//!
//! **What this deliberately does NOT do**: reimplement sync in Rust. Each
//! tick just calls `window.__faiteBackgroundSyncTick()` (`sync-provider.tsx`)
//! — the exact same JS sync engine the board window uses, just invoked
//! externally instead of self-scheduling. The spike's own recommendation
//! (§4) found no evidence a native reimplementation is needed.

use std::sync::Mutex;
use std::time::Duration;
use tauri::{async_runtime::JoinHandle, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Label for the hidden background webview. Loads `background-sync.html` —
/// a dedicated minimal page (`src/app/background-sync/page.tsx`), not the
/// real board — see that page's own doc comment for why reusing
/// `board.html` here would be the wrong call, not just a bigger one.
pub(crate) const BACKGROUND_WINDOW: &str = "background-sync";

/// Matches `DEFAULT_INTERVAL_MS` in `src/lib/sync/engine.ts` — not
/// literally shared across the Rust/TS boundary, so keep the two in sync by
/// hand if either changes.
const TICK_INTERVAL: Duration = Duration::from_secs(30);

const TICK_JS: &str = "window.__faiteBackgroundSyncTick && window.__faiteBackgroundSyncTick();";

/// App-managed state (`app.manage(...)` in `lib.rs`) — the handle to the
/// running tick loop, so `stop_background_sync` can cancel exactly the task
/// `start_background_sync` spawned, across the two independent call sites
/// (`CloseRequested`, `RunEvent::Reopen`) that own this window's lifecycle.
#[derive(Default)]
pub struct BackgroundSyncState {
  tick_task: Mutex<Option<JoinHandle<()>>>,
}

/// Called from `main`'s `CloseRequested` handler, right after `hide()`.
/// Idempotent — a second call while a tick loop is already running is a
/// no-op, which matters because nothing here prevents the window from being
/// hidden more than once in a row.
pub fn start_background_sync(app: &AppHandle) {
  let state = app.state::<BackgroundSyncState>();
  let mut tick_task = state.tick_task.lock().unwrap();
  if tick_task.is_some() {
    return;
  }

  if app.get_webview_window(BACKGROUND_WINDOW).is_none() {
    let built = WebviewWindowBuilder::new(
      app,
      BACKGROUND_WINDOW,
      WebviewUrl::App("background-sync.html".into()),
    )
    .title("Faite (background sync)")
    .visible(false)
    .skip_taskbar(true)
    .build();

    if let Err(error) = built {
      eprintln!("[faite] failed to create the background sync window: {error}");
      return;
    }
  }

  let app_for_tick = app.clone();
  *tick_task = Some(tauri::async_runtime::spawn(async move {
    let mut interval = tokio::time::interval(TICK_INTERVAL);
    // `interval.tick()` fires immediately on the first call. Skipping it is
    // not a correctness fix, just avoiding a redundant sync: the newly
    // created window's own `SyncProvider` already triggers one on mount
    // (`engine.start()`), which lands at essentially the same moment.
    interval.tick().await;
    loop {
      interval.tick().await;
      let Some(window) = app_for_tick.get_webview_window(BACKGROUND_WINDOW) else {
        // Torn down by `stop_background_sync` (the window closes before
        // this task is aborted, not after — see its own comment). Stop
        // rather than keep ticking a window that no longer exists.
        break;
      };
      let _ = window.eval(TICK_JS);
    }
  }));
}

/// Called from `RunEvent::Reopen`, before the main window is shown again.
/// Cancels the tick loop and closes the background window — the board
/// window owns sync while it's open (unaffected by any of this: its own
/// `SyncProvider`/engine never stopped running), so a background tick
/// racing a foreground one would be wasted work, not a correctness bug, but
/// there is no reason to pay for both.
pub fn stop_background_sync(app: &AppHandle) {
  let state = app.state::<BackgroundSyncState>();
  if let Some(handle) = state.tick_task.lock().unwrap().take() {
    handle.abort();
  }
  if let Some(window) = app.get_webview_window(BACKGROUND_WINDOW) {
    let _ = window.close();
  }
}
