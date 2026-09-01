//! The bundle manifest, and the rule that a bundle is verified WHOLE (EI-256).
//!
//! Produced by `scripts/desktop/bundle-assets.mjs`, served from
//! `/api/desktop/assets/manifest.json`.
//!
//! ## Why whole, and not file by file
//!
//! `docs/DESKTOP.md` §13.3, learned from the EI-254 spike: activating a bundle
//! file-by-file — letting the binary's embedded copy answer whatever is
//! missing — can serve a stale chunk beside new markup. A page assembled from
//! two different releases, reporting no error anywhere, is a far worse outcome
//! than not updating at all.
//!
//! So `verify` is all-or-nothing by construction. Every path the manifest
//! claims must be present with a matching hash, and nothing may be present
//! that the manifest does not claim. A bundle that fails any part of that is
//! rejected entire, and the previously active copy stays in charge.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Archive {
  pub name: String,
  pub sha256: String,
  pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
  /// Content hash of the bundle. Compared for equality, never ordered.
  pub version: String,
  /// Lowest shell version that may activate this bundle. Semver, ordered.
  #[serde(rename = "minShellVersion")]
  pub min_shell_version: String,
  /// The entry document, rooted (`/board.html`).
  pub entry: String,
  pub archive: Archive,
  #[serde(rename = "fileCount")]
  pub file_count: usize,
  /// Rooted path → SHA-256, for every file in the bundle.
  pub files: BTreeMap<String, String>,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

impl Manifest {
  pub fn parse(json: &str) -> Result<Self, String> {
    let manifest: Manifest =
      serde_json::from_str(json).map_err(|error| format!("unreadable manifest: {error}"))?;

    // Internal consistency, checked before anything on disk is touched. A
    // manifest disagreeing with itself is not a bundle worth downloading.
    if manifest.version.is_empty() {
      return Err("manifest has no version".into());
    }
    if manifest.files.len() != manifest.file_count {
      return Err(format!(
        "manifest lists {} files but claims {}",
        manifest.files.len(),
        manifest.file_count
      ));
    }
    if !manifest.files.contains_key(&manifest.entry) {
      return Err(format!("manifest has no entry document at {}", manifest.entry));
    }
    Ok(manifest)
  }

  /// Confirms the archive is the one this manifest describes, before a single
  /// byte of it is written anywhere.
  pub fn check_archive(&self, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != self.archive.bytes {
      return Err(format!(
        "archive is {} bytes, manifest says {}",
        bytes.len(),
        self.archive.bytes
      ));
    }
    let actual = sha256_hex(bytes);
    if actual != self.archive.sha256 {
      return Err(format!("archive hash {actual} does not match the manifest"));
    }
    Ok(())
  }

  /// The all-or-nothing check against an extracted directory.
  ///
  /// Rejects three separate ways a bundle can be wrong, and they are not the
  /// same failure: a **missing** file would fall through to the binary's copy
  /// and mix builds; a **changed** file is corruption or tampering; an
  /// **extra** file is something the publisher never described, which has no
  /// business being served under our own origin.
  pub fn verify(&self, root: &Path) -> Result<(), String> {
    for (path, expected) in &self.files {
      let on_disk = root.join(path.trim_start_matches('/'));
      let bytes = std::fs::read(&on_disk).map_err(|_| format!("bundle is missing {path}"))?;
      let actual = sha256_hex(&bytes);
      if &actual != expected {
        return Err(format!("{path} does not match its manifest hash"));
      }
    }

    let found = count_files(root);
    if found != self.files.len() {
      return Err(format!(
        "bundle holds {found} files, manifest describes {}",
        self.files.len()
      ));
    }
    Ok(())
  }
}

fn count_files(dir: &Path) -> usize {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return 0;
  };
  entries
    .flatten()
    .map(|entry| {
      let path = entry.path();
      if path.is_dir() {
        count_files(&path)
      } else {
        1
      }
    })
    .sum()
}

/// `0.2.0` → `[0, 2, 0]`, or `None` for anything unreadable.
///
/// Mirrors `parseVersion` in `src/lib/desktop/version.ts` deliberately — the
/// same `minShellVersion` string is read by both halves, and two different
/// answers to "is this shell new enough" would be worse than either answer.
fn parse_version(version: &str) -> Option<Vec<u64>> {
  let core = version.trim().trim_start_matches(['v', 'V']);
  let core = core.split(['-', '+']).next()?;
  if core.is_empty() {
    return None;
  }
  core.split('.').map(|part| part.parse::<u64>().ok()).collect()
}

/// True when `installed` is at least `required`.
///
/// **An unreadable version on either side returns `false`** — the opposite of
/// `evaluateUpdate`'s "fail towards current", and deliberately so. There, an
/// unreadable version must not take a working app away from a user. Here, it
/// would let an unverifiable bundle be activated, so the safe answer is to
/// decline the update and keep running what already works. Both rules resolve
/// the same way in the end: leave the app as it is.
pub fn shell_is_new_enough(installed: &str, required: &str) -> bool {
  let (Some(installed), Some(required)) = (parse_version(installed), parse_version(required))
  else {
    return false;
  };
  for index in 0..installed.len().max(required.len()) {
    let left = installed.get(index).copied().unwrap_or(0);
    let right = required.get(index).copied().unwrap_or(0);
    if left != right {
      return left > right;
    }
  }
  true
}

#[cfg(test)]
mod tests {
  use super::*;

  fn manifest_json(files: &[(&str, &str)], count: usize) -> String {
    let entries: Vec<String> = files
      .iter()
      .map(|(path, hash)| format!("\"{path}\":\"{hash}\""))
      .collect();
    format!(
      r#"{{"version":"abc123","minShellVersion":"0.1.0","entry":"/board.html",
         "archive":{{"name":"b.tar.gz","sha256":"deadbeef","bytes":4}},
         "fileCount":{count},"files":{{{}}}}}"#,
      entries.join(",")
    )
  }

  fn temp_root(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("faite-manifest-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn parses_a_well_formed_manifest() {
    let json = manifest_json(&[("/board.html", "aa")], 1);
    let manifest = Manifest::parse(&json).unwrap();
    assert_eq!(manifest.version, "abc123");
    assert_eq!(manifest.files.len(), 1);
  }

  #[test]
  fn refuses_a_manifest_that_disagrees_with_itself() {
    let json = manifest_json(&[("/board.html", "aa")], 9);
    assert!(Manifest::parse(&json).unwrap_err().contains("claims 9"));
  }

  #[test]
  fn refuses_a_manifest_with_no_entry_document() {
    let json = manifest_json(&[("/other.html", "aa")], 1);
    assert!(Manifest::parse(&json).unwrap_err().contains("entry document"));
  }

  #[test]
  fn archive_must_match_hash_and_length() {
    let json = manifest_json(&[("/board.html", "aa")], 1);
    let mut manifest = Manifest::parse(&json).unwrap();
    manifest.archive.sha256 = sha256_hex(b"good");
    manifest.archive.bytes = 4;

    assert!(manifest.check_archive(b"good").is_ok());
    assert!(manifest.check_archive(b"bad!").unwrap_err().contains("hash"));
    assert!(manifest.check_archive(b"toolong").unwrap_err().contains("bytes"));
  }

  #[test]
  fn verify_accepts_an_exact_bundle() {
    let root = temp_root("exact");
    std::fs::write(root.join("board.html"), "A").unwrap();
    let json = manifest_json(&[("/board.html", &sha256_hex(b"A"))], 1);
    assert!(Manifest::parse(&json).unwrap().verify(&root).is_ok());
  }

  /// The §13.3 hazard, as a test: a missing file must sink the whole bundle,
  /// because the alternative is the binary's stale copy quietly filling in.
  #[test]
  fn verify_rejects_a_missing_file() {
    let root = temp_root("missing");
    std::fs::write(root.join("board.html"), "A").unwrap();
    let json = manifest_json(
      &[("/board.html", &sha256_hex(b"A")), ("/app.js", &sha256_hex(b"B"))],
      2,
    );
    let error = Manifest::parse(&json).unwrap().verify(&root).unwrap_err();
    assert!(error.contains("missing /app.js"), "{error}");
  }

  #[test]
  fn verify_rejects_a_changed_file() {
    let root = temp_root("changed");
    std::fs::write(root.join("board.html"), "TAMPERED").unwrap();
    let json = manifest_json(&[("/board.html", &sha256_hex(b"A"))], 1);
    let error = Manifest::parse(&json).unwrap().verify(&root).unwrap_err();
    assert!(error.contains("does not match"), "{error}");
  }

  /// An extra file is not harmless: it would be served from our own origin
  /// having never been described by the publisher.
  #[test]
  fn verify_rejects_an_undeclared_extra_file() {
    let root = temp_root("extra");
    std::fs::write(root.join("board.html"), "A").unwrap();
    std::fs::write(root.join("smuggled.js"), "X").unwrap();
    let json = manifest_json(&[("/board.html", &sha256_hex(b"A"))], 1);
    let error = Manifest::parse(&json).unwrap().verify(&root).unwrap_err();
    assert!(error.contains("2 files"), "{error}");
  }

  #[test]
  fn shell_version_ordering() {
    assert!(shell_is_new_enough("0.1.0", "0.1.0"));
    assert!(shell_is_new_enough("0.2.0", "0.1.0"));
    assert!(shell_is_new_enough("1.0", "0.9.9"));
    assert!(!shell_is_new_enough("0.1.0", "0.2.0"));
  }

  /// Unlike the client-side check, an unreadable version here declines the
  /// update rather than waving it through. See the doc comment.
  #[test]
  fn an_unreadable_version_declines_the_bundle() {
    assert!(!shell_is_new_enough("0.1.0", "latest"));
    assert!(!shell_is_new_enough("nightly", "0.1.0"));
  }
}
