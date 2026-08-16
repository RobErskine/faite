use std::path::Path;
use std::time::SystemTime;

fn main() {
  check_frontend_dist();
  tauri_build::build();
}

/// EI-129: `frontendDist` (`.next-static/`, produced by `npm run
/// build:static`) is what Tauri's asset protocol serves as the app's
/// document root. Nothing forces that command to run before `cargo build`
/// — a developer who forgets, or who edits `src/` and rebuilds only the
/// Rust side, gets a stale or missing bundle with no error until the app
/// is actually launched and shows a blank window or old content. Fail the
/// build loudly here instead, per docs/DESKTOP.md.
fn check_frontend_dist() {
  let manifest_dir =
    std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set by cargo");
  let repo_root = Path::new(&manifest_dir).join("..");
  let dist = repo_root.join(".next-static");

  if !dist.exists() {
    panic!(
      "frontendDist `{}` does not exist. Run `npm run build:static` (see \
       tauri.conf.json's `beforeBuildCommand`, which does this \
       automatically for `tauri build`/`tauri dev`) before running `cargo \
       build` directly.",
      dist.display()
    );
  }

  let is_empty = dist
    .read_dir()
    .map(|mut entries| entries.next().is_none())
    .unwrap_or(true);
  if is_empty {
    panic!(
      "frontendDist `{}` exists but is empty. Re-run `npm run build:static`.",
      dist.display()
    );
  }

  // Freshness: a stale export (source edited after the last export) is a
  // "why isn't my change showing up" trap for anyone iterating with `cargo
  // build`/`cargo run` directly instead of `tauri dev`/`tauri build`,
  // neither of which re-runs `next build` for you.
  let dist_mtime = newest_mtime(&dist);
  let src_mtime = newest_mtime(&repo_root.join("src"));
  if let (Some(dist_mtime), Some(src_mtime)) = (dist_mtime, src_mtime) {
    if src_mtime > dist_mtime {
      panic!(
        "frontendDist `{}` is stale — `src/` has files newer than the \
         static export. Re-run `npm run build:static` before building the \
         Tauri shell.",
        dist.display()
      );
    }
  }

  // Re-run this check on the next `cargo build` whenever either side
  // changes, rather than only when something under `src-tauri/` itself
  // does (cargo's default rerun tracking, which this replaces once any
  // `rerun-if-changed` is emitted, only covers the crate's own directory
  // and wouldn't see either of these on its own).
  println!("cargo:rerun-if-changed={}", dist.display());
  println!("cargo:rerun-if-changed={}", repo_root.join("src").display());
}

/// Walks `dir` recursively and returns the newest file modification time
/// found. `None` if the directory can't be read or contains no files.
fn newest_mtime(dir: &Path) -> Option<SystemTime> {
  let mut newest: Option<SystemTime> = None;
  let mut stack = vec![dir.to_path_buf()];

  while let Some(current) = stack.pop() {
    let Ok(entries) = std::fs::read_dir(&current) else {
      continue;
    };
    for entry in entries.flatten() {
      let path = entry.path();
      if path.is_dir() {
        stack.push(path);
        continue;
      }
      let Ok(metadata) = entry.metadata() else {
        continue;
      };
      let Ok(modified) = metadata.modified() else {
        continue;
      };
      newest = Some(match newest {
        Some(current_newest) if current_newest > modified => current_newest,
        _ => modified,
      });
    }
  }

  newest
}
