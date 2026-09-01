#!/usr/bin/env node
/**
 * Uploads a built hot-asset bundle to R2, so installed desktop apps can pick
 * it up (EI-255).
 *
 *   npm run desktop:bundle && npm run desktop:publish
 *   npm run desktop:publish -- --dry-run
 *
 * ## Order matters, and it is the safety property
 *
 * The archive goes up FIRST, the manifest LAST. `manifest.json` is the pointer
 * every client reads to decide there is something new, so a client that reads
 * it must find the archive already there. Uploading in the other order opens a
 * window where the fleet is told about a bundle that 404s — and EI-147's whole
 * design rule is never to announce something nobody can install
 * (`docs/DESKTOP.md` §12.5, and `version.test.ts` enforces the same rule for
 * shell builds).
 *
 * That ordering also makes this safe to re-run: a failed manifest upload
 * leaves the previous manifest in place, pointing at a bundle that still
 * exists.
 *
 * ## Retention: nothing is deleted, and that is the decision
 *
 * Wrangler has no object-listing command, so a prune here would have to page
 * the S3 API by hand. It is not worth it. An archive is ~3.8 MB, so a year of
 * daily bundles is about 1.4 GB — roughly two cents a month, inside R2's free
 * tier.
 *
 * A lifecycle rule (`wrangler r2 bucket lifecycle`) would expire them
 * server-side, and is the right tool IF this ever matters. It is not enabled,
 * because age-based expiry would eventually delete the *current* archive
 * during any long gap between deploys, leaving the manifest pointing at a
 * 404 — trading two cents for a broken pipeline.
 *
 * Note that EI-257's rollback does not depend on any of this: it restores the
 * previous bundle from the client's own disk, never by re-downloading.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = ".desktop-assets";
const BUCKET = "faite-desktop-assets";

const dryRun = process.argv.includes("--dry-run");

function main() {
  const manifestPath = join(OUT_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`No ${manifestPath}. Run \`npm run desktop:bundle\` first.`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const archivePath = join(OUT_DIR, manifest.archive.name);
  if (!existsSync(archivePath)) {
    console.error(`Manifest names ${manifest.archive.name}, which is not in ${OUT_DIR}/.`);
    process.exit(1);
  }

  const put = (key, file, contentType) => {
    const args = [
      "r2", "object", "put", `${BUCKET}/${key}`,
      "--file", file,
      "--content-type", contentType,
      "--remote",
    ];
    console.log(`→ ${dryRun ? "[dry-run] " : ""}${key}`);
    if (!dryRun) execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  };

  // Archive first. See the file comment.
  put(manifest.archive.name, archivePath, "application/gzip");
  put("manifest.json", manifestPath, "application/json");

  console.log(
    dryRun
      ? `\nDry run. Would publish bundle ${manifest.version}.`
      : `\nPublished bundle ${manifest.version}. Desktop clients pick it up within 6h, or on next launch.`,
  );
}

main();
