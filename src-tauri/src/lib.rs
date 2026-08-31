use tauri::menu::{Menu, MenuBuilder, SubmenuBuilder};
#[cfg(not(target_os = "macos"))]
use tauri::menu::PredefinedMenuItem;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

mod background_sync;
mod keychain;

/// Window label for the main, user-visible board. The only window a user
/// ever sees at launch.
const MAIN_WINDOW: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Window size/position persistence (EI-132). Desktop-only crate — not a
  // dependency at all on mobile targets, see Cargo.toml.
  //
  // `with_denylist` excludes the D2b background-sync window entirely — NOT
  // decoration. This plugin's `restore_state` runs on every window it
  // isn't told to skip, and for a label it has never seen before (true the
  // very first time this hidden window is ever created), its "no saved
  // state" branch leaves `should_show` at `WindowState::default()`'s
  // `visible: true` and calls `.show()` unconditionally — silently
  // overriding the `.visible(false)` this window is built with
  // (background_sync.rs). Found live: the hidden window rendered as a real,
  // visible, empty black window on Rob's first close-the-board test. A
  // denylist (not `skip_initial_state`, which only skips the RESTORE call
  // but still lets the plugin manage/save this window's state) is correct
  // here regardless of the bug — this window's geometry is meaningless and
  // shouldn't be persisted at all.
  #[cfg(desktop)]
  {
    builder = builder.plugin(
      tauri_plugin_window_state::Builder::default()
        .with_denylist(&[background_sync::BACKGROUND_WINDOW])
        .build(),
    );
  }

  // D2a: `faite://auth-callback` (docs/DESKTOP.md §9) — the system-browser
  // login flow's only channel back into the app. Scheme registered in
  // tauri.conf.json's `plugins.deep-link.desktop.schemes`; the JS side
  // (`bridge.ts`, `@tauri-apps/plugin-deep-link`'s `onOpenUrl`/`getCurrent`)
  // does the actual handling — nothing Rust-side needs to inspect the URL.
  builder = builder.plugin(tauri_plugin_deep_link::init());

  // D2a: opens the system browser for login (`bridge.ts`'s
  // `startDesktopLogin`). The one thing this app ever opens is its own
  // hardcoded `/login` URL — never anything user- or server-supplied — so
  // the plugin's default `opener:allow-open-url` capability grant is not a
  // meaningful widening of what this app can already do.
  builder = builder.plugin(tauri_plugin_opener::init());

  let app = builder
    .invoke_handler(tauri::generate_handler![
      keychain::get_auth_token,
      keychain::set_auth_token,
      keychain::clear_auth_token,
    ])
    .manage(background_sync::BackgroundSyncState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let main_window =
        WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("board.html".into()))
          .title("Faite")
          .inner_size(1200.0, 800.0)
          .build()?;

      // Hide-on-close, dock-resident (D1.5). Cmd-W / the red traffic light
      // triggers `CloseRequested`; prevent the default destroy and hide the
      // window instead, so the process (and NSApplication) stays alive with
      // no visible window — standard dock-app behavior. Hiding rather than
      // destroying also means a later `RunEvent::Reopen` doesn't have to
      // rebuild the window or re-run the board's Dexie bootstrap.
      //
      // A hidden window's JS timers stop firing on their own (D0 spike
      // §3.4), which would silently stop sync the moment this fires — D2b
      // (background_sync.rs, called just below) is what keeps it running.
      #[cfg(target_os = "macos")]
      {
        let window_for_close = main_window.clone();
        let app_handle_for_close = app.handle().clone();
        main_window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_for_close.hide();
            // D2b: sync doesn't get to just stop because nobody's looking
            // at the window — see background_sync.rs.
            background_sync::start_background_sync(&app_handle_for_close);
          }
        });
      }

      // Native app menu. Tauri v2 already auto-installs
      // `menu::Menu::default()` on macOS when no custom menu is set
      // (`enable_macos_default_menu`, on by default) — including a full
      // Edit submenu (Cut/Copy/Paste/Select All/Undo/Redo), which is why
      // Cmd+C etc. would actually already work here even without this
      // block. It's built explicitly anyway so the menu is documented,
      // intentional, and doesn't silently disappear the day someone adds a
      // custom `.menu()` call for another reason and loses the implicit
      // default without noticing.
      app.set_menu(app_menu(app)?)?;

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    #[cfg(target_os = "macos")]
    match event {
      // Don't quit when the main window closes (it's hidden, not
      // destroyed, by the `CloseRequested` handler above) — this is the
      // documented mechanism Tauri provides for "stay running with no
      // visible windows".
      RunEvent::ExitRequested { api, .. } => {
        api.prevent_exit();
      }
      // Dock icon clicked while the app has no visible window. The
      // documented v2 hook for macOS's "reopen" AppKit event
      // (https://github.com/tauri-apps/tauri/issues/3084).
      RunEvent::Reopen { .. } => {
        // Before showing main again: the board window is about to own sync
        // itself again (its own SyncProvider never stopped running), so the
        // background tick loop and its hidden window are done for now.
        background_sync::stop_background_sync(app_handle);
        if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW) {
          let _ = window.show();
          let _ = window.set_focus();
        }
      }
      _ => {}
    }
  });
}

/// Builds the standard macOS-style app menu: app submenu (About/Services/
/// Hide/Quit), Edit (Undo/Redo/Cut/Copy/Paste/Select All), and Window. This
/// mirrors `tauri::menu::Menu::default()`'s shape but is spelled out
/// explicitly per EI-132 rather than relying on the implicit default.
fn app_menu(app: &tauri::App) -> tauri::Result<Menu<tauri::Wry>> {
  let pkg_info = app.package_info();
  let about_metadata = tauri::menu::AboutMetadataBuilder::new()
    .name(Some(pkg_info.name.clone()))
    .version(Some(pkg_info.version.to_string()))
    .build();

  #[cfg(target_os = "macos")]
  let app_submenu = SubmenuBuilder::new(app, pkg_info.name.clone())
    .about(Some(about_metadata))
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;

  let edit_submenu = SubmenuBuilder::new(app, "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()?;

  let window_submenu = SubmenuBuilder::new(app, "Window")
    .minimize()
    .maximize()
    .separator()
    .close_window()
    .build()?;

  let mut builder = MenuBuilder::new(app);
  #[cfg(target_os = "macos")]
  {
    builder = builder.item(&app_submenu);
  }
  #[cfg(not(target_os = "macos"))]
  {
    // Non-macOS platforms fold "About" and "Quit" into the Edit menu's
    // neighbors instead of a dedicated app submenu, matching Tauri's own
    // `Menu::default()` shape for Windows/Linux. Not a shipping target
    // yet (macOS-only per docs/DESKTOP.md decision #6 and friends), kept
    // here only so a non-mac `cargo build` still compiles a sane menu.
    let about = PredefinedMenuItem::about(app, None, Some(about_metadata))?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    builder = builder.item(&about).item(&quit);
  }

  builder
    .item(&edit_submenu)
    .item(&window_submenu)
    .build()
}
