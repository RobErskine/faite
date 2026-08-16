// EI-178 spike only — see ei178_probe.rs doc comment. Not wired into any
// production shell.
mod ei178_probe;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      if std::env::var("FAITE_EI178_PROBE").is_ok() {
        ei178_probe::run(app.handle());
      } else {
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("probe.html".into()))
          .title("EI-178 probe (run with FAITE_EI178_PROBE=1)")
          .inner_size(600.0, 400.0)
          .build()?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
