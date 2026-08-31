#!/usr/bin/env node
/**
 * Rebuilds the Mac app from the current working tree and replaces the copy in
 * /Applications with it.
 *
 *   npm run desktop:install
 *
 * ## Why this exists
 *
 * The `.app` ships a frozen static export (`docs/DESKTOP.md` §2, decision #2).
 * The sync engine moves *rows*, not code, so a merge to `main` and a Cloudflare
 * deploy never reach an installed desktop build — only a new build does. Until
 * the updater lands (EI-134) and the release pipeline signs and publishes it
 * (EI-136), "get tonight's work into the Mac app" is a local rebuild, and it
 * was five commands people got wrong in the middle: `ditto` merges into an
 * existing bundle instead of replacing it, so a stale file from the previous
 * build survives unless the target is removed first, and copying over a running
 * app leaves the old process on a binary that is no longer there.
 *
 * ## What this is NOT
 *
 * Not a release. It does not bump `version` in `src-tauri/tauri.conf.json`, it
 * does not touch `DESKTOP_VERSION_POLICY` in `src/server/desktop/version.ts`,
 * and it publishes nothing. Those four steps are ordered deliberately in
 * `docs/DESKTOP.md` §12.5 and the order is the whole safety property: the
 * server announces a build only after the artifact exists. This script is for
 * the machine you are sitting at, where the artifact is the thing it just made.
 *
 * A consequence worth expecting: the version stays 0.1.0 across every run, so
 * the update bar stays silent. That is correct. The bar compares version
 * numbers, and nothing here changes one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const BUILT = "src-tauri/target/release/bundle/macos/Faite.app";
const INSTALLED = "/Applications/Faite.app";

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: "inherit", encoding: "utf8" });

if (process.platform !== "darwin") {
  console.error("This script installs a macOS bundle. Nothing to do here.");
  process.exit(1);
}

// `--bundles app` builds ONLY the .app, skipping the .dmg entirely. Not just
// a speed-up: the dmg step is the failure-prone one (it shells out to
// hdiutil via bundle_dmg.sh, which fails on a stale mount and leaves a ~38MB
// `rw.*.dmg` scratch file behind each time), and it produced an installer
// this script then ignored in favour of the .app sitting next to it. A local
// install has no use for a disk image.
console.log("→ Building (static export + tauri release .app)…");
run("npm", ["run", "desktop:build", "--", "--bundles", "app"]);

if (!existsSync(BUILT)) {
  console.error(`Build reported success but ${BUILT} is missing.`);
  process.exit(1);
}

// A running copy holds the old bundle open. Ask it to quit rather than killing
// it, so the shell gets to persist window state on the way out (D1, §6).
console.log("→ Quitting the running app, if there is one…");
try {
  run("osascript", ["-e", 'tell application "Faite" to quit']);
} catch {
  // Not running. Fine.
}

console.log(`→ Replacing ${INSTALLED}…`);
rmSync(INSTALLED, { recursive: true, force: true });
run("ditto", [BUILT, INSTALLED]);

console.log("→ Launching…");
run("open", ["-a", INSTALLED]);
console.log("Done. The app is running the current tree.");
