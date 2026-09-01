//! Hot asset bundles: a web deploy reaches an installed app (EI-254 → EI-256).
//!
//! `docs/DESKTOP.md` §2 decision #2 bakes the static export into this binary,
//! and the sync engine moves rows rather than code — so before this, nothing
//! shipped to the web could reach an installed `.app`. This module lets the
//! frontend arrive as *data*: verified, staged, and swapped in behind the
//! existing `tauri://localhost` origin.
//!
//! ## Who does what, and why the shell has no HTTP client
//!
//! The **webview** fetches. It already talks to `myfaite.app` on every sync,
//! its CSP already allows exactly that origin, and `parseVersionPolicy`
//! (`src/lib/desktop/version.ts`) already pins both bundle URLs to
//! `SITE_ORIGIN` under test. Adding an HTTP client here would mean a second
//! TLS stack in the binary and a second, unshared copy of those origin rules.
//!
//! The **shell** verifies and writes. Bytes crossing the IPC boundary are
//! trusted for nothing: the archive is hashed against the manifest, every
//! extracted file is hashed against the manifest, and the file count must
//! match exactly (`manifest.rs`). Only then does anything become activatable.
//!
//! ## Nothing is ever swapped underneath a running window
//!
//! Downloading happens whenever; **activation happens only at startup**,
//! before `set_assets`, when no webview exists yet. A bundle verified at
//! 3pm is simply staged, and the app picks it up the next time it launches.
//! This is what keeps a half-applied update from being an observable state.
//!
//! ## The failure ladder
//!
//! Every rung falls towards a working app, never towards a brick — the same
//! rule EI-147's `evaluateUpdate` follows:
//!
//! 1. A verified staged bundle, if one is waiting.
//! 2. Otherwise the currently active bundle.
//! 3. Otherwise the copy compiled into this binary, which is always intact.

mod manifest;
mod provider;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Runtime;

use manifest::{shell_is_new_enough, Manifest};
use provider::{DirAssets, NoAssets};

/// Directory names under `hot-assets/`. Siblings rather than nested so that
/// activation is a sequence of plain renames on one filesystem.
const CURRENT: &str = "current";
const STAGING: &str = "staging";
const PREVIOUS: &str = "previous";
/// Scratch space for an extraction in progress. Never activated; a leftover
/// from a crash is deleted on the next staging attempt.
const INCOMING: &str = "incoming";

/// Holds the manifest between `hot_assets_prepare` and `hot_assets_stage`.
///
/// Two calls rather than one because the manifest is ~40 KB of JSON and the
/// archive is ~3.8 MB of binary: sending them together would mean either
/// base64-ing the archive into JSON, or stuffing the manifest into an IPC
/// header. Splitting them lets each travel in its natural form, and lets the
/// shell decline an unwanted bundle *before* the webview spends bandwidth on
/// it.
#[derive(Default)]
pub struct PendingBundle(Mutex<Option<Manifest>>);

/// Where bundles live. macOS-only, and resolved by hand rather than through
/// `app.path()` because activation runs before the `App` exists.
struct Layout {
  root: PathBuf,
}

impl Layout {
  fn new(identifier: &str) -> Option<Self> {
    let home = std::env::var_os("HOME")?;
    Some(Self {
      root: PathBuf::from(home)
        .join("Library/Application Support")
        .join(identifier)
        .join("hot-assets"),
    })
  }

  fn dir(&self, name: &str) -> PathBuf {
    self.root.join(name)
  }

  /// The manifest of a bundle, stored beside it rather than inside it so that
  /// `verify`'s "no undeclared files" rule stays true of the bundle itself.
  fn manifest(&self, name: &str) -> PathBuf {
    self.root.join(format!("{name}.manifest.json"))
  }

  fn read_manifest(&self, name: &str) -> Option<Manifest> {
    let json = std::fs::read_to_string(self.manifest(name)).ok()?;
    Manifest::parse(&json).ok()
  }

  /// Moves a bundle and its manifest together, or neither.
  fn rename(&self, from: &str, to: &str) -> std::io::Result<()> {
    std::fs::rename(self.dir(from), self.dir(to))?;
    // A bundle whose manifest failed to follow is unusable, and `usable()`
    // rejects it on the next line rather than serving something undescribed.
    let _ = std::fs::rename(self.manifest(from), self.manifest(to));
    Ok(())
  }

  fn remove(&self, name: &str) {
    let _ = std::fs::remove_dir_all(self.dir(name));
    let _ = std::fs::remove_file(self.manifest(name));
  }

  /// A bundle is usable when its manifest reads back and its entry document
  /// is on disk. Deliberately NOT a re-hash of all 365 files: that ran at
  /// staging time, and repeating it on every cold start would add work to the
  /// one moment the user is waiting for a window.
  fn usable(&self, name: &str) -> Option<Manifest> {
    let manifest = self.read_manifest(name)?;
    let entry = self.dir(name).join(manifest.entry.trim_start_matches('/'));
    entry.is_file().then_some(manifest)
  }
}

/// Promotes a staged bundle, then points the context at whichever bundle is
/// active. Call with the freshly generated context, immediately before
/// `build`.
pub fn apply<R: Runtime>(mut context: tauri::Context<R>) -> tauri::Context<R> {
  let Some(layout) = Layout::new(&context.config().identifier) else {
    return context;
  };

  activate_staged(&layout);

  let Some(manifest) = layout.usable(CURRENT) else {
    return context;
  };

  // Two calls, forced by the API: `set_assets` hands back the provider it
  // replaced, and the replacement needs to hold that provider as its
  // fallback. `NoAssets` is the throwaway in between, dropped immediately.
  let embedded = context.set_assets(Box::new(NoAssets));
  context.set_assets(Box::new(DirAssets::new(layout.dir(CURRENT), embedded)));

  // `eprintln!` because this runs before the `App`, and therefore before the
  // log plugin, exists. Which frontend a build is serving is the first thing
  // any report about this will need to establish.
  eprintln!("[hot-assets] serving bundle {}", manifest.version);
  context
}

/// Makes a staged bundle the active one, keeping the outgoing bundle as
/// `previous` for EI-257's rollback.
///
/// **Ordered so that every crash point leaves a bootable app.** Between
/// retiring `current` and promoting `staging` there is a moment with no
/// active bundle at all — and that is the safe state, because the embedded
/// copy answers instead, and the next launch simply retries the promotion.
fn activate_staged(layout: &Layout) {
  let Some(staged) = layout.usable(STAGING) else {
    // Nothing staged, or what is staged is unusable. Clear the latter so a
    // broken directory cannot be retried forever.
    if layout.dir(STAGING).exists() && layout.read_manifest(STAGING).is_none() {
      layout.remove(STAGING);
    }
    return;
  };

  layout.remove(PREVIOUS);
  if layout.dir(CURRENT).exists() {
    let _ = layout.rename(CURRENT, PREVIOUS);
  }
  if let Err(error) = layout.rename(STAGING, CURRENT) {
    eprintln!("[hot-assets] could not activate {}: {error}", staged.version);
    return;
  }
  eprintln!("[hot-assets] activated bundle {}", staged.version);
}

/// What the frontend needs to decide whether to download anything.
#[derive(serde::Serialize)]
pub struct HotAssetStatus {
  /// Bundle currently being served, or `null` when running the embedded copy.
  active: Option<String>,
  /// Bundle verified and waiting for the next launch.
  staged: Option<String>,
  shell: String,
}

#[tauri::command]
pub fn hot_assets_status<R: Runtime>(app: tauri::AppHandle<R>) -> HotAssetStatus {
  let shell = app.package_info().version.to_string();
  let Some(layout) = Layout::new(&app.config().identifier) else {
    return HotAssetStatus { active: None, staged: None, shell };
  };
  HotAssetStatus {
    active: layout.usable(CURRENT).map(|manifest| manifest.version),
    staged: layout.usable(STAGING).map(|manifest| manifest.version),
    shell,
  }
}

/// Accepts a manifest and answers whether the archive is worth downloading.
///
/// The decision lives here rather than in the webview because this is where
/// activation happens: a shell that would refuse to activate a bundle should
/// never let 3.8 MB be fetched for it.
#[tauri::command]
pub fn hot_assets_prepare<R: Runtime>(
  app: tauri::AppHandle<R>,
  pending: tauri::State<'_, PendingBundle>,
  manifest: String,
) -> Result<bool, String> {
  let manifest = Manifest::parse(&manifest)?;
  let shell = app.package_info().version.to_string();

  if !shell_is_new_enough(&shell, &manifest.min_shell_version) {
    // Not an error the user should see. This shell simply cannot run this
    // frontend, and says so by quietly continuing to run the one it has —
    // EI-147's fail-towards-current rule. The version bar is what tells a
    // user their shell is too old; that path is unchanged.
    return Ok(false);
  }

  let layout = Layout::new(&app.config().identifier).ok_or("no home directory")?;
  let already_here = |name: &str| {
    layout.usable(name).map(|other| other.version == manifest.version).unwrap_or(false)
  };
  if already_here(CURRENT) || already_here(STAGING) {
    return Ok(false);
  }

  *pending.0.lock().map_err(|_| "pending bundle lock poisoned")? = Some(manifest);
  Ok(true)
}

/// Verifies a downloaded archive and stages it for the next launch.
///
/// Takes the raw bytes over Tauri's IPC as a `Vec<u8>`. Nothing about them is
/// trusted: the archive is hashed against the manifest agreed in
/// `hot_assets_prepare`, then every extracted file is hashed, then the file
/// count must match. Failure at any point deletes the scratch directory and
/// leaves the active bundle untouched.
#[tauri::command]
pub fn hot_assets_stage<R: Runtime>(
  app: tauri::AppHandle<R>,
  pending: tauri::State<'_, PendingBundle>,
  archive: Vec<u8>,
) -> Result<String, String> {
  let manifest = pending
    .0
    .lock()
    .map_err(|_| "pending bundle lock poisoned")?
    .take()
    .ok_or("no bundle was prepared")?;

  let layout = Layout::new(&app.config().identifier).ok_or("no home directory")?;
  let result = stage_verified(&layout, &manifest, &archive);
  if result.is_err() {
    layout.remove(INCOMING);
  }
  result.map(|()| manifest.version.clone())
}

fn stage_verified(layout: &Layout, manifest: &Manifest, archive: &[u8]) -> Result<(), String> {
  manifest.check_archive(archive)?;

  layout.remove(INCOMING);
  let incoming = layout.dir(INCOMING);
  std::fs::create_dir_all(&incoming).map_err(|error| format!("cannot create staging: {error}"))?;

  unpack(archive, &incoming)?;
  manifest.verify(&incoming)?;

  // Verified, so it may become activatable. Written manifest-first: a
  // directory without its manifest is refused by `usable`, whereas a manifest
  // without its directory is refused too — either half alone is inert.
  layout.remove(STAGING);
  std::fs::write(
    layout.manifest(STAGING),
    serde_json::to_string(manifest).map_err(|error| error.to_string())?,
  )
  .map_err(|error| format!("cannot write manifest: {error}"))?;
  std::fs::rename(&incoming, layout.dir(STAGING))
    .map_err(|error| format!("cannot stage bundle: {error}"))?;

  Ok(())
}

/// Reduces an archive entry's path to a plain relative path inside the bundle,
/// or refuses it.
///
/// Split out from `unpack` so the rule is testable without hand-crafting a
/// malicious tar — the `tar` crate will not even write a `..` entry, so the
/// only way to exercise this through an archive would be to assemble the
/// header bytes by hand.
///
/// `Ok(None)` means "nothing to write" (a bare `./`), which is not an error.
/// Anything that is not a normal path component — `..`, a root, a Windows
/// prefix — is refused outright rather than normalised away, because a
/// publisher with a legitimate reason to emit one does not exist.
fn safe_relative_path(path: &Path) -> Result<Option<PathBuf>, String> {
  let mut safe = PathBuf::new();
  for part in path.components() {
    match part {
      std::path::Component::Normal(name) => safe.push(name),
      std::path::Component::CurDir => {}
      _ => return Err(format!("archive entry escapes the bundle: {}", path.display())),
    }
  }
  Ok((!safe.as_os_str().is_empty()).then_some(safe))
}

/// Unpacks the gzipped tar into `root`.
///
/// Entries are placed by hand rather than via `Archive::unpack` so that every
/// path is checked before it is written. An archive is remote input, and
/// `../` in an entry name is the oldest trick there is — `unpack` does guard
/// against it, but this code owns the guarantee rather than borrowing it.
fn unpack(archive: &[u8], root: &Path) -> Result<(), String> {
  let decoder = flate2::read::GzDecoder::new(archive);
  let mut tar = tar::Archive::new(decoder);
  let entries = tar.entries().map_err(|error| format!("unreadable archive: {error}"))?;

  for entry in entries {
    let mut entry = entry.map_err(|error| format!("unreadable archive entry: {error}"))?;
    let path = entry.path().map_err(|error| format!("bad entry path: {error}"))?.into_owned();

    let Some(safe) = safe_relative_path(&path)? else {
      continue;
    };

    let target = root.join(&safe);
    if entry.header().entry_type().is_dir() {
      std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
      continue;
    }
    if let Some(parent) = target.parent() {
      std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    entry
      .unpack(&target)
      .map_err(|error| format!("cannot write {}: {error}", safe.display()))?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn layout_for(name: &str) -> Layout {
    let root = std::env::temp_dir().join(format!("faite-hot-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    Layout { root }
  }

  fn write_bundle(layout: &Layout, name: &str, version: &str, body: &str) {
    let dir = layout.dir(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("board.html"), body).unwrap();
    let manifest = format!(
      r#"{{"version":"{version}","minShellVersion":"0.1.0","entry":"/board.html",
         "archive":{{"name":"b.tar.gz","sha256":"x","bytes":1}},
         "fileCount":1,"files":{{"/board.html":"{}"}}}}"#,
      manifest::sha256_hex(body.as_bytes())
    );
    std::fs::write(layout.manifest(name), manifest).unwrap();
  }

  #[test]
  fn staging_becomes_current_and_current_becomes_previous() {
    let layout = layout_for("promote");
    write_bundle(&layout, CURRENT, "old", "OLD");
    write_bundle(&layout, STAGING, "new", "NEW");

    activate_staged(&layout);

    assert_eq!(layout.usable(CURRENT).unwrap().version, "new");
    assert_eq!(layout.usable(PREVIOUS).unwrap().version, "old");
    assert!(!layout.dir(STAGING).exists());
  }

  #[test]
  fn activation_is_a_no_op_with_nothing_staged() {
    let layout = layout_for("nothing");
    write_bundle(&layout, CURRENT, "only", "ONLY");

    activate_staged(&layout);

    assert_eq!(layout.usable(CURRENT).unwrap().version, "only");
    assert!(!layout.dir(PREVIOUS).exists());
  }

  /// A staged directory with no readable manifest is not merely skipped, it
  /// is destroyed — otherwise every launch would retry the same wreck.
  #[test]
  fn an_unreadable_staged_bundle_is_discarded() {
    let layout = layout_for("wreck");
    write_bundle(&layout, CURRENT, "good", "GOOD");
    std::fs::create_dir_all(layout.dir(STAGING)).unwrap();
    std::fs::write(layout.dir(STAGING).join("board.html"), "?").unwrap();

    activate_staged(&layout);

    assert!(!layout.dir(STAGING).exists());
    assert_eq!(layout.usable(CURRENT).unwrap().version, "good");
  }

  /// The first-run path: no current bundle at all, so the embedded copy is
  /// what was serving, and staging simply becomes current.
  #[test]
  fn staging_activates_with_no_previous_bundle() {
    let layout = layout_for("firstrun");
    write_bundle(&layout, STAGING, "first", "FIRST");

    activate_staged(&layout);

    assert_eq!(layout.usable(CURRENT).unwrap().version, "first");
    assert!(!layout.dir(PREVIOUS).exists());
  }

  #[test]
  fn a_bundle_missing_its_entry_document_is_not_usable() {
    let layout = layout_for("noentry");
    write_bundle(&layout, CURRENT, "v", "BODY");
    std::fs::remove_file(layout.dir(CURRENT).join("board.html")).unwrap();

    assert!(layout.usable(CURRENT).is_none());
  }

  /// The path guard, exercised directly. `..` is the oldest archive trick
  /// there is, and this bundle root sits next to the user's `current` bundle.
  #[test]
  fn archive_paths_that_escape_the_bundle_are_refused() {
    for hostile in ["../escaped.txt", "a/../../escaped.txt", "/etc/passwd"] {
      let error = safe_relative_path(Path::new(hostile)).unwrap_err();
      assert!(error.contains("escapes the bundle"), "{hostile}: {error}");
    }
  }

  #[test]
  fn ordinary_archive_paths_are_kept_verbatim() {
    let safe = safe_relative_path(Path::new("./_next/static/app.js")).unwrap().unwrap();
    assert_eq!(safe, PathBuf::from("_next/static/app.js"));
    assert!(safe_relative_path(Path::new("./")).unwrap().is_none());
  }

  #[test]
  fn a_real_archive_round_trips_through_unpack_and_verify() {
    let root = std::env::temp_dir().join("faite-hot-roundtrip");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();

    let mut builder = tar::Builder::new(Vec::new());
    for (name, body) in [("board.html", "BOARD"), ("_next/app.js", "CHUNK")] {
      let mut header = tar::Header::new_gnu();
      header.set_size(body.len() as u64);
      header.set_mode(0o644);
      header.set_cksum();
      builder.append_data(&mut header, name, body.as_bytes()).unwrap();
    }
    let tarball = builder.into_inner().unwrap();
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    std::io::Write::write_all(&mut gz, &tarball).unwrap();
    let archive = gz.finish().unwrap();

    unpack(&archive, &root).unwrap();

    let json = format!(
      r#"{{"version":"rt","minShellVersion":"0.1.0","entry":"/board.html",
         "archive":{{"name":"b.tar.gz","sha256":"{}","bytes":{}}},
         "fileCount":2,"files":{{"/board.html":"{}","/_next/app.js":"{}"}}}}"#,
      manifest::sha256_hex(&archive),
      archive.len(),
      manifest::sha256_hex(b"BOARD"),
      manifest::sha256_hex(b"CHUNK"),
    );
    let manifest = Manifest::parse(&json).unwrap();
    assert!(manifest.check_archive(&archive).is_ok());
    assert!(manifest.verify(&root).is_ok());
  }
}
