#!/usr/bin/env node
/**
 * Makes a fresh worktree usable: local D1 tables, and a test account that is
 * already verified.
 *
 *   npm run dev:bootstrap
 *   npm run dev:bootstrap -- --email me@example.com --password hunter2hunter2
 *   npm run dev:bootstrap -- --from ~/Sites/faite/.dev.vars
 *   npm run dev:bootstrap -- --skip-migrate
 *
 * ## Why this exists (EI-249)
 *
 * `.wrangler/`, `.dev.vars` and `node_modules/` are all git-ignored, so a new
 * worktree starts with no local database at all. Three things then bite, in
 * this order, and EI-248 lost real time to all three:
 *
 * 1. Local D1 is per-directory. Until `auth:migrate:local` runs *here*, every
 *    query fails with "no such table" — only in dev, which reads like a code
 *    bug rather than a setup gap.
 * 2. Signing up locally never delivers mail. The `send_email` binding cannot
 *    reach the network under local `wrangler dev`, so `src/server/email.ts`
 *    logs the message instead. The verification link is real, but it is buried
 *    in the `npm run preview` terminal and easy to scroll past.
 * 3. `email_verified` then has to be flipped by hand in the local SQLite file.
 *
 * So this script never asks the app for anything. It writes the account
 * straight into local D1 — already verified — which removes the emailed link
 * from the path entirely. No worker has to be running.
 *
 * That is possible because Better Auth's password hash is portable: its
 * default scrypt implementation is exported as `hashPassword` from
 * `better-auth/crypto`, and the string it returns is exactly what the running
 * server's `verifyPassword` accepts. We are not re-implementing the hash, we
 * are calling the same function the server calls.
 *
 * ## Scope
 *
 * The auth unblock only. It deliberately does not seed board data: the board
 * seeds itself from `useBootstrap()` into IndexedDB, and the Playwright suite
 * runs against `next dev` with no D1, no worker and no user, so nothing in
 * `e2e/` depends on this script.
 *
 * See `docs/SETUP.md` for what the manual version of this looks like.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";

// The database *name* from wrangler.jsonc, not the `AUTH_DB` binding —
// `wrangler d1 execute` takes the name. Keep these in step if either changes.
const DATABASE = "faite-auth";

// Every key `.dev.vars` needs. ATTACHMENTS_ORIGIN is listed because it must be
// present and EMPTY locally: a value sends attachment bytes to
// files.myfaite.app, which does not resolve on a laptop.
const DEV_VARS_KEYS = [
  "NEXTJS_ENV",
  "BETTER_AUTH_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_PLACES_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "ATTACHMENTS_ORIGIN",
];

const argv = process.argv.slice(2);

// This script only ever touches local state, and the cost of being wrong is a
// stranger's password in the production user table. `--remote` and `--prod`
// are what a tired hand types, so refuse them by name rather than ignoring
// them silently.
for (const forbidden of ["--remote", "--prod", "--production"]) {
  if (argv.includes(forbidden)) {
    fail(`${forbidden} is not supported. This script is local-only, by design.`);
  }
}

function flag(name, fallback) {
  const at = argv.indexOf(name);
  if (at === -1) return fallback;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) fail(`${name} needs a value.`);
  return value;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const email = flag("--email", process.env.FAITE_DEV_EMAIL ?? "dev@example.com");
const password = flag("--password", process.env.FAITE_DEV_PASSWORD ?? "faite-local-dev");
const name = flag("--name", "Dev");

// Better Auth rejects anything shorter than 8 before it ever reaches the
// database, so catch it here rather than after we have written a row.
if (password.length < 8) fail("Password must be at least 8 characters.");

const root = process.cwd();
if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "wrangler.jsonc"))) {
  fail(`This does not look like the repo root: ${root}`);
}

console.log(`\n  Bootstrapping ${root}\n`);

// ---------------------------------------------------------------- .dev.vars

const devVars = join(root, ".dev.vars");
if (existsSync(devVars)) {
  console.log("  .dev.vars        already present, left alone");
} else {
  // Default to the primary checkout. It is the one copy that is guaranteed to
  // exist and to be current, and it is where every other worktree's came from.
  const from = resolve(
    flag("--from", process.env.FAITE_DEV_VARS ?? join(homedir(), "Sites/faite/.dev.vars")),
  );
  if (from !== devVars && existsSync(from)) {
    copyFileSync(from, devVars);
    console.log(`  .dev.vars        copied from ${from}`);
  } else {
    console.error(`\n  No .dev.vars here, and none to copy from (looked in ${from}).`);
    console.error("  Pass --from <path>, or create .dev.vars with these keys:\n");
    for (const key of DEV_VARS_KEYS) {
      console.error(`    ${key}=${key === "ATTACHMENTS_ORIGIN" ? "        (must stay empty locally)" : ""}`);
    }
    console.error("\n  Generate BETTER_AUTH_SECRET with: npx @better-auth/cli secret\n");
    process.exit(1);
  }
}

// ----------------------------------------------------------------- migrate

if (argv.includes("--skip-migrate")) {
  console.log("  migrations       skipped (--skip-migrate)");
} else {
  console.log("  migrations       applying to local D1...");
  try {
    execFileSync("npm", ["run", "auth:migrate:local"], { stdio: "inherit" });
  } catch {
    fail("auth:migrate:local failed. Run it on its own to see why.");
  }
}

// -------------------------------------------------------------- test user

/**
 * Runs SQL through a temp file rather than `--command`.
 *
 * The statements below interpolate an email and a scrypt hash, and a `--command`
 * string has to survive both the shell and wrangler's own parsing. A file has
 * to survive neither.
 */
function sql(statements, { json = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faite-bootstrap-"));
  const file = join(dir, "statements.sql");
  writeFileSync(file, statements);
  try {
    const args = ["wrangler", "d1", "execute", DATABASE, "--local", "--file", file];
    if (json) args.push("--json");
    const out = execFileSync("npx", args, {
      encoding: "utf8",
      stdio: json ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
    });
    return json ? JSON.parse(out.slice(out.indexOf("["))) : out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Single-quotes are the only metacharacter that matters inside a SQLite string
// literal, and doubling them is the whole of the escaping rule.
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

const hash = await hashPassword(password);
const now = Date.now();

// `email` carries a unique index, so this is a real upsert: re-running against
// an account that already exists re-verifies it instead of failing.
sql(`
INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
VALUES (${q(`dev-bootstrap-${now}`)}, ${q(name)}, ${q(email)}, 1, ${now}, ${now})
ON CONFLICT(email) DO UPDATE SET email_verified = 1, updated_at = ${now};
`);

// Read the id back rather than assuming ours won: on the conflict path the row
// keeps whatever id it was created with, possibly by a real signup.
const [{ results }] = sql(`SELECT id FROM user WHERE email = ${q(email)};`, { json: true });
const userId = results[0]?.id;
if (!userId) fail(`Inserted ${email} but could not read it back.`);

// Delete-then-insert, so a re-run with a different --password repairs the
// account instead of leaving the old hash in place.
sql(`
DELETE FROM account WHERE user_id = ${q(userId)} AND provider_id = 'credential';
INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
VALUES (${q(`${userId}-credential`)}, ${q(userId)}, 'credential', ${q(userId)}, ${q(hash)}, ${now}, ${now});
`);

console.log(`
  Ready.

    email     ${email}
    password  ${password}

  Two terminals:

    npm run preview     the Workers runtime on :8787, serves /api/*
    npm run dev         Next on :3000, hot reload

  Then sign in at http://localhost:3000 — use localhost, not 127.0.0.1.
`);
