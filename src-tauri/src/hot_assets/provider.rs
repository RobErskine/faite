//! The `Assets` implementation that serves a bundle from disk (EI-254/EI-256).
//!
//! `Context::set_assets` replaces the provider *behind* `tauri://localhost`,
//! so swapping the frontend never moves the page's origin — Dexie, auth,
//! capabilities and CSP all behave exactly as a stock build. The two obvious
//! alternatives (a remote `frontendDist`, or a custom URI scheme) both change
//! the origin, and on WKWebView a new origin means a new IndexedDB, which
//! would orphan the user's entire local board.
//!
//! ## Per-file fallback is a last resort, not the design
//!
//! `get` falls back to the embedded copy for anything it cannot read, so a
//! damaged bundle still boots. That is a safety net for the unexpected, NOT
//! the activation policy: serving one file from the binary beside the rest
//! from disk mixes two builds, which `docs/DESKTOP.md` §13.3 records as a real
//! hazard. `mod.rs` verifies a bundle whole before it is ever activated, so in
//! practice this path should never fire.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

// Via `tauri::utils` (its own `pub use tauri_utils as utils`) rather than a
// direct `tauri-utils` dependency — the version then cannot drift out of step
// with the `tauri` this is implementing a trait for.
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

/// Reads assets from `root`, falling back to `fallback` (the embedded assets
/// this binary shipped with) for anything it cannot serve.
pub struct DirAssets<R: Runtime> {
  root: PathBuf,
  fallback: Box<dyn Assets<R>>,
}

impl<R: Runtime> DirAssets<R> {
  pub fn new(root: PathBuf, fallback: Box<dyn Assets<R>>) -> Self {
    Self { root, fallback }
  }

  /// Maps an `AssetKey` onto a path inside `root`.
  ///
  /// `AssetKey` is already normalized by Tauri (rooted, unix separators, no
  /// trailing slash — `tauri-utils/src/assets.rs`), so `..` should never
  /// arrive here. It is rejected anyway: this path will one day be fed by a
  /// downloaded archive, and the check costs nothing next to the class of bug
  /// it forecloses.
  fn resolve(&self, key: &AssetKey) -> Option<PathBuf> {
    let rel = key.as_ref().trim_start_matches('/');
    if rel.is_empty()
      || Path::new(rel)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
      return None;
    }
    Some(self.root.join(rel))
  }
}

impl<R: Runtime> Assets<R> for DirAssets<R> {
  fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
    match self.resolve(key).and_then(|path| std::fs::read(path).ok()) {
      Some(bytes) => Some(Cow::Owned(bytes)),
      // Deliberately not an error: a bundle that is missing one file still
      // boots, because the binary's own copy answers instead.
      None => self.fallback.get(key),
    }
  }

  fn iter(&self) -> Box<AssetsIter<'_>> {
    // Collected eagerly into owned pairs rather than streamed, because the
    // trait's iterator borrows `self` and a lazy directory walk would have to
    // hold an open handle for that whole lifetime. The export is ~80 entries
    // at the top level; this is not a hot path.
    let mut out: Vec<(Cow<'_, str>, Cow<'_, [u8]>)> = Vec::new();
    collect(&self.root, &self.root, &mut out);
    Box::new(out.into_iter())
  }

  fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
    // Empty on purpose, and safe *only* because of a fact about this app's
    // own config: `tauri.conf.json`'s CSP carries `script-src 'self'
    // 'unsafe-inline' 'unsafe-eval'`, so no inline script in the export
    // depends on a compile-time hash to run. Tightening that CSP later would
    // break hot bundles here first — S6 in the runbook exists to prove this
    // claim rather than trust this comment.
    Box::new(std::iter::empty())
  }
}

/// Recursive directory walk, yielding rooted keys (`/board.html`) to match
/// what `EmbeddedAssets::iter` produces.
fn collect<'a>(root: &Path, dir: &Path, out: &mut Vec<(Cow<'a, str>, Cow<'a, [u8]>)>) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      collect(root, &path, out);
    } else if let (Ok(rel), Ok(bytes)) = (path.strip_prefix(root), std::fs::read(&path)) {
      out.push((
        Cow::Owned(format!("/{}", rel.to_string_lossy())),
        Cow::Owned(bytes),
      ));
    }
  }
}

/// A provider that serves nothing.
///
/// Exists purely to get the embedded assets *out* of the `Context`.
/// `set_assets` replaces the provider and returns the old one, but the
/// replacement needs to hold the old one as its fallback — so the extraction
/// is done in two moves, with this as the throwaway in between. It is dropped
/// immediately and never answers a request.
pub struct NoAssets;

impl<R: Runtime> Assets<R> for NoAssets {
  fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
    None
  }

  fn iter(&self) -> Box<AssetsIter<'_>> {
    Box::new(std::iter::empty())
  }

  fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
    Box::new(std::iter::empty())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use tauri::Wry;

  /// A stand-in for the embedded assets, so a test can tell "served from
  /// disk" and "served from the binary" apart by content.
  struct Baked(&'static str);

  impl Assets<Wry> for Baked {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
      Some(Cow::Borrowed(self.0.as_bytes()))
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
      Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
      Box::new(std::iter::empty())
    }
  }

  fn temp_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("faite-hot-assets-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  fn assets(root: PathBuf) -> DirAssets<Wry> {
    DirAssets::new(root, Box::new(Baked("BAKED")))
  }

  #[test]
  fn a_file_on_disk_wins_over_the_baked_copy() {
    let root = temp_root("wins");
    std::fs::write(root.join("board.html"), "FROM DISK").unwrap();

    let provider = assets(root);
    let served = provider.get(&AssetKey::from("board.html")).unwrap();
    assert_eq!(served.as_ref(), b"FROM DISK");
  }

  #[test]
  fn nested_paths_resolve() {
    let root = temp_root("nested");
    std::fs::create_dir_all(root.join("_next/static")).unwrap();
    std::fs::write(root.join("_next/static/app.js"), "CHUNK").unwrap();

    let provider = assets(root);
    let served = provider
      .get(&AssetKey::from("_next/static/app.js"))
      .unwrap();
    assert_eq!(served.as_ref(), b"CHUNK");
  }

  /// The core safety property: a bundle missing a file is not a broken app.
  /// Every miss is answered by the copy compiled into the binary.
  #[test]
  fn a_missing_file_falls_back_instead_of_failing() {
    let root = temp_root("missing");

    let provider = assets(root);
    let served = provider.get(&AssetKey::from("board.html")).unwrap();
    assert_eq!(served.as_ref(), b"BAKED");
  }

  /// A file that disappears mid-session (a swap running underneath a live
  /// window) must degrade to the baked copy, not to a blank screen.
  #[test]
  fn a_file_deleted_after_startup_falls_back() {
    let root = temp_root("deleted");
    let path = root.join("board.html");
    std::fs::write(&path, "FROM DISK").unwrap();
    let provider = assets(root);
    assert_eq!(
      provider
        .get(&AssetKey::from("board.html"))
        .unwrap()
        .as_ref(),
      b"FROM DISK"
    );

    std::fs::remove_file(&path).unwrap();
    assert_eq!(
      provider
        .get(&AssetKey::from("board.html"))
        .unwrap()
        .as_ref(),
      b"BAKED"
    );
  }

  /// `AssetKey` normalizes away traversal before we ever see it, so this is
  /// belt-and-braces — but this root will eventually be filled by a
  /// downloaded archive, and that is precisely when the assumption is worth
  /// having encoded as a test rather than a comment.
  #[test]
  fn traversal_is_refused_and_falls_back() {
    let root = temp_root("traversal");
    std::fs::write(root.parent().unwrap().join("outside.txt"), "SECRET").unwrap();

    let provider = assets(root);
    for key in ["../outside.txt", "/../outside.txt", "a/../../outside.txt"] {
      let served = provider.get(&AssetKey::from(key)).unwrap();
      assert_eq!(served.as_ref(), b"BAKED", "{key} escaped the bundle root");
    }
  }

  #[test]
  fn iter_yields_rooted_keys_for_nested_files() {
    let root = temp_root("iter");
    std::fs::create_dir_all(root.join("_next")).unwrap();
    std::fs::write(root.join("board.html"), "A").unwrap();
    std::fs::write(root.join("_next/app.js"), "B").unwrap();

    let provider = assets(root);
    let mut keys: Vec<String> = provider.iter().map(|(key, _)| key.into_owned()).collect();
    keys.sort();
    assert_eq!(keys, vec!["/_next/app.js", "/board.html"]);
  }

}
