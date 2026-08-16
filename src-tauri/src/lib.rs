// D0 spike only — see d0_probe.rs doc comment. Not wired into any D1+ shell.
mod d0_probe;

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

      if std::env::var("FAITE_D0_PROBE").is_ok() {
        d0_probe::run(app.handle());
      } else {
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("board.html".into()))
          .title("Faite")
          .inner_size(1200.0, 800.0)
          .build()?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
