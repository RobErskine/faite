#!/usr/bin/env node
/**
 * Packages `.next-static` into a hot-asset bundle the desktop shell can
 * download and activate, plus the manifest that describes it (EI-254).
 *
 *   npm run desktop:bundle
 *
 * Writes `.desktop-assets/faite-assets-<version>.tar.gz` and
 * `.desktop-assets/manifest.json`.
 *
 * ## The manifest is the safety mechanism, not paperwork
 *
 * `docs/DESKTOP.md` §13.3: activating a bundle file-by-file, with the binary's
 * embedded copy answering whatever is missing, can serve a stale chunk beside
 * new markup — a page assembled from two different builds, with no error
 * anywhere. So a bundle is verified **whole, before activation**: every path
 * the manifest claims must be present and hash-correct, or the whole bundle is
 * rejected and the embedded copy stays in charge.
 *
 * That makes the per-file hashes the load-bearing part of this file. The
 * tarball is just transport.
 *
 * ## Why the version is a content hash
 *
 * Not semver, and not hand-maintained. A bundle's identity IS its content, so
 * "forgot to bump the version" cannot happen, and two builds of identical
 * output are the same version by construction. This is a different namespace
 * from `tauri.conf.json`'s `version`, which still describes the Rust shell and
 * still moves by hand a few times a year.
 *
 * ## `minShellVersion`
 *
 * The frontend can be newer than the shell around it, because the shell only
 * changes on a real release. If a bundle starts calling a Tauri command that
 * an older shell does not have, that shell must refuse the bundle rather than
 * boot into a broken board. Bump this when — and only when — the JS↔Rust
 * contract grows: a new `#[tauri::command]`, a new plugin, a new capability.
 * The current contract is three keychain commands (`src-tauri/src/keychain.rs`)
 * and four plugins.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative } from "node:path";

const EXPORT_DIR = ".next-static";
const OUT_DIR = ".desktop-assets";

/** The app's entry document. A bundle without it is not a bundle. */
const ENTRY = "board.html";

/** Lowest shell version that can run this frontend. See the doc comment. */
const MIN_SHELL_VERSION = "0.1.0";

/** Walks `dir`, returning rooted keys (`/board.html`) in sorted order. */
function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push("/" + posix.join(...relative(base, full).split(/[\\/]/)));
  }
  return out.sort();
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function main() {
  if (!statSync(EXPORT_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`No ${EXPORT_DIR}/. Run \`npm run build:static\` first.`);
    process.exit(1);
  }

  const paths = walk(EXPORT_DIR);
  if (!paths.includes(`/${ENTRY}`)) {
    console.error(`${EXPORT_DIR}/ has no ${ENTRY} — refusing to publish a bundle nothing can boot.`);
    process.exit(1);
  }

  const files = {};
  let totalBytes = 0;
  for (const path of paths) {
    const bytes = readFileSync(join(EXPORT_DIR, path.slice(1)));
    files[path] = sha256(bytes);
    totalBytes += bytes.length;
  }

  // Version derived from the content, so it cannot disagree with what shipped.
  const version = sha256(paths.map((path) => `${path}:${files[path]}`).join("\n")).slice(0, 12);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const archive = join(OUT_DIR, `faite-assets-${version}.tar.gz`);

  // COPYFILE_DISABLE stops macOS's bsdtar from writing `._name` AppleDouble
  // entries for extended attributes. Those are invisible locally and would
  // extract as files the manifest never claimed — which the all-or-nothing
  // verifier is entitled to treat as a corrupt bundle.
  execFileSync("tar", ["-czf", archive, "-C", EXPORT_DIR, "."], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdio: "inherit",
  });

  const archiveBytes = readFileSync(archive);
  const manifest = {
    version,
    createdAt: new Date().toISOString(),
    minShellVersion: MIN_SHELL_VERSION,
    entry: `/${ENTRY}`,
    archive: { name: posix.basename(archive), sha256: sha256(archiveBytes), bytes: archiveBytes.length },
    unpackedBytes: totalBytes,
    fileCount: paths.length,
    files,
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`\nbundle  ${version}`);
  console.log(`files   ${paths.length} (${mb(totalBytes)} unpacked)`);
  console.log(`archive ${archive} (${mb(archiveBytes.length)})`);
  console.log(`shell   requires >= ${MIN_SHELL_VERSION}`);
}

main();
