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
 * ## Why the S3 API rather than `wrangler r2 object put` (EI-263)
 *
 * Because it lets the credential stay scoped to ONE bucket.
 *
 * Wrangler uploads through Cloudflare's REST endpoint, which a bucket-scoped
 * R2 token cannot use — it answers `403 / code 10000`, which is
 * cloudflare/workers-sdk#9235. Making wrangler work would mean an
 * account-level `Workers R2 Storage · Edit` token, and that grants read and
 * delete on EVERY bucket on the account, `faite-attachments` included. That
 * bucket holds users' uploaded files behind ownership checks (EI-244/EI-245);
 * handing CI the ability to wipe it, in exchange for not writing forty lines
 * here, is a bad trade.
 *
 * Bucket-scoped R2 tokens are built for exactly this path: the Access Key ID
 * is the token's id and the Secret Access Key is the SHA-256 of its value.
 * So the S3 API is not a workaround, it is the supported use of the narrower
 * credential.
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
import { AwsClient } from "aws4fetch";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = ".desktop-assets";
const BUCKET = "faite-desktop-assets";

const dryRun = process.argv.includes("--dry-run");

/** Reads an environment variable, or explains precisely what is missing. */
function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set.\n` +
        "Publishing needs an R2 token scoped to the faite-desktop-assets bucket:\n" +
        "  CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\n" +
        "Cloudflare shows the last two once, when the R2 API token is created.",
    );
    process.exit(1);
  }
  return value;
}

async function main() {
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

  // Credentials are read only for a real publish, so `--dry-run` stays useful
  // as a "did the bundle build, and what would go up" check on any machine.
  const client = dryRun
    ? null
    : new AwsClient({
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
        service: "s3",
        region: "auto",
      });
  const endpoint = dryRun
    ? null
    : `https://${required("CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com/${BUCKET}`;

  const put = async (key, file, contentType) => {
    console.log(`→ ${dryRun ? "[dry-run] " : ""}${key}`);
    if (dryRun) return;

    const response = await client.fetch(`${endpoint}/${key}`, {
      method: "PUT",
      body: readFileSync(file),
      headers: { "content-type": contentType },
    });
    if (!response.ok) {
      // Surfaced in full: a 403 here is almost always the token being scoped
      // to a different bucket, and the body says which.
      console.error(`Upload of ${key} failed — ${response.status} ${response.statusText}`);
      console.error(await response.text());
      process.exit(1);
    }
  };

  // Archive first, and awaited: the manifest is the pointer every client
  // reads, so it must never land before the thing it points at.
  await put(manifest.archive.name, archivePath, "application/gzip");
  await put("manifest.json", manifestPath, "application/json");

  console.log(
    dryRun
      ? `\nDry run. Would publish bundle ${manifest.version}.`
      : `\nPublished bundle ${manifest.version}. Desktop clients pick it up within 6h, or on next launch.`,
  );
}

await main();
