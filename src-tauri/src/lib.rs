use tauri::menu::{Menu, MenuBuilder, SubmenuBuilder};
#[cfg(not(target_os = "macos"))]
use tauri::menu::PredefinedMenuItem;
use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Window label for the main, user-visible board. The only window a user
/// ever sees at launch.
const MAIN_WINDOW: &str = "main";

/// Window label for the hidden background webview — D1 only establishes its
/// existence and lifecycle. It shares the same `tauri://localhost` origin
/// (and therefore the same IndexedDB/localStorage, per the D0 spike's §3.3
/// finding) as `main`, which is what makes it viable as the future home for
/// sync ownership (D2) and the menu-bar popover (D3) once those land — this
/// milestone does not wire either of those in yet.
///
/// Known caveat carried over from the D0 spike (docs/DESKTOP.md §3.4): a
/// hidden `WebviewWindow`'s JS timers stop firing after their first tick.
/// Nothing in this window relies on a JS timer today; D2 will need to drive
/// any future sync loop from Rust (or find another workaround) rather than
/// assuming `setInterval` survives here.
const CORE_WINDOW: &str = "core";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();

  // Window size/position persistence (EI-132). Desktop-only crate — not a
  // dependency at all on mobile targets, see Cargo.toml.
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
  }

  let app = builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("board.html".into()))
        .title("Faite")
        .inner_size(1200.0, 800.0)
        .build()?;

      // Hidden background webview. Not shown, not closable by the user
      // (there's no chrome for it to close from) — it lives for the
      // lifetime of the app and, combined with the `ExitRequested` handler
      // in `run` below, is what keeps the process (and NSApplication) alive
      // on macOS after the user closes the main board window, matching
      // standard menu-bar-app behavior.
      WebviewWindowBuilder::new(app, CORE_WINDOW, WebviewUrl::App("board.html".into()))
        .title("Faite (background)")
        .visible(false)
        .skip_taskbar(true)
        .build()?;

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

  app.run(|_app_handle, event| {
    // macOS: don't quit when the main board window closes. The hidden
    // `core` window (built above) keeps at least one window alive, but
    // this is the documented, explicit belt-and-suspenders mechanism Tauri
    // provides for "stay running with no visible windows" — see
    // docs/DESKTOP.md's window/sync-ownership section.
    #[cfg(target_os = "macos")]
    if let RunEvent::ExitRequested { api, .. } = event {
      api.prevent_exit();
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
