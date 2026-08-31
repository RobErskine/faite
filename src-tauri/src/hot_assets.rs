//! EI-254 spike — serve the frontend from a directory on disk instead of the
//! copy baked into this binary, so a web deploy can reach an installed app.
//!
//! **This is spike code. It is not the feature.** There is no download here,
//! no signature check, and no server manifest — the directory is assumed to
//! already exist and to be trustworthy. Its only job is to answer the
//! questions in `.ai/ei-254-hot-assets-runbook.md` against a real build, and
//! then be deleted like `d0_probe.rs` was (docs/DESKTOP.md §3).
//!
//! ## Why this mechanism and not the obvious ones
//!
//! `docs/DESKTOP.md` §2 decision #2 bakes the static export into the binary,
//! and the sync engine moves rows rather than code, so nothing that ships to
//! the web can reach an installed `.app`. The two obvious fixes both change
//! the page's **origin** — a remote `frontendDist`, or a custom URI scheme —
//! and on WKWebView an origin change means a different IndexedDB. That would
//! orphan the user's entire local board, which is the one thing this app
//! cannot do. Tauri offers no storage migration for it.
//!
//! `Context::set_assets` avoids the problem completely: it replaces the
//! provider *behind* the existing `tauri://localhost` protocol. The origin,
//! and therefore Dexie, auth, capabilities and CSP injection, are untouched.
//!
//! ## The fallback is the point
//!
//! Decision #2's real defence was "the app boots offline, always". This
//! preserves that literally: anything unexpected — no directory, an empty
//! one, a file that disappeared mid-session, a traversal attempt — falls
//! through to the embedded assets this binary already carries. The same
//! fail-towards-working rule EI-147's `evaluateUpdate` follows.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

// Via `tauri::utils` (its own `pub use tauri_utils as utils`) rather than a
// direct `tauri-utils` dependency — the version then cannot drift out of step
// with the `tauri` this is implementing a trait for.
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

/// Marks a directory as a real, fully-extracted bundle. The app's entry
/// document, so a directory that lacks it is by definition unusable and we
/// keep the embedded copy instead. A real implementation would check a
/// manifest and its signature; this is the spike's stand-in for that gate.
const SENTINEL: &str = "board.html";

/// Where a downloaded bundle would live. macOS-only, and derived by hand
/// rather than through `app.path()` because `set_assets` has to run *before*
/// the `App` exists — there is no `AppHandle` to ask yet.
pub fn bundle_dir(identifier: &str) -> Option<PathBuf> {
  let home = std::env::var_os("HOME")?;
  let dir = PathBuf::from(home)
    .join("Library/Application Support")
    .join(identifier)
    .join("hot-assets/current");

  // Sanity gate. A directory that exists but has no entry document is a
  // half-extracted or hand-broken bundle, and booting from it would show a
  // blank window with no way back.
  dir.join(SENTINEL).is_file().then_some(dir)
}

/// Points the context's asset provider at a downloaded bundle when one is
/// present, and returns the context unchanged when it is not.
///
/// Called with the freshly generated context, immediately before `build`. The
/// two-step swap is forced by the API: `set_assets` hands back the provider it
/// replaced, and the replacement needs to *hold* that provider as its
/// fallback, so the embedded assets are extracted with a throwaway first.
pub fn apply<R: Runtime>(mut context: tauri::Context<R>) -> tauri::Context<R> {
  let Some(dir) = bundle_dir(&context.config().identifier) else {
    return context;
  };

  let embedded = context.set_assets(Box::new(NoAssets));

  // SPIKE PROBE (S3/Q1) — measured before the swap so the two numbers below
  // come from different providers. Proving "the swap took" needs evidence
  // about the bytes the webview will actually receive, not just that a
  // directory was found: a fallback that silently answers every request would
  // look identical from the outside.
  let key = AssetKey::from(SENTINEL);
  let embedded_len = embedded.get(&key).map(|bytes| bytes.len());

  context.set_assets(Box::new(DirAssets::new(dir.clone(), embedded)));
  let served_len = context.assets().get(&key).map(|bytes| bytes.len());

  // `eprintln!` rather than the log plugin: this runs before the `App` (and
  // therefore before any plugin) exists. Which copy of the frontend a build
  // is serving is the first question any bug report about this will need
  // answered, so it is not conditional on a debug build.
  eprintln!("[hot-assets] serving frontend from {}", dir.display());
  eprintln!(
    "[hot-assets] /{SENTINEL}: embedded={embedded_len:?} bytes, serving={served_len:?} bytes"
  );
  context
}

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

  /// The directory existing is not enough. A half-extracted bundle has no
  /// entry document, and booting from it would show a blank window with no
  /// way back — so `bundle_dir` must refuse it and leave the binary's own
  /// copy in charge.
  #[test]
  fn bundle_dir_refuses_a_directory_without_the_entry_document() {
    let home = temp_root("sentinel-home");
    let current =
      home.join("Library/Application Support/app.test.identifier/hot-assets/current");
    std::fs::create_dir_all(&current).unwrap();

    let saved = std::env::var_os("HOME");
    // SAFETY: single-threaded assertion around a process-global; restored
    // immediately below.
    unsafe { std::env::set_var("HOME", &home) };

    let without = bundle_dir("app.test.identifier");
    std::fs::write(current.join(SENTINEL), "<html></html>").unwrap();
    let with = bundle_dir("app.test.identifier");

    if let Some(saved) = saved {
      unsafe { std::env::set_var("HOME", saved) };
    }

    assert_eq!(
      without, None,
      "a bundle with no entry document was accepted"
    );
    assert_eq!(with, Some(current));
  }
}
