#!/usr/bin/env node
/**
 * Wipes your own board, server-side, and re-runs the migration ledger.
 *
 *   npm run schema:reset
 *   npm run schema:reset -- --prod      (types-to-confirm)
 *
 * ## This is the SERVER half only
 *
 * A node script cannot reach a browser's IndexedDB or localStorage, so the
 * devices you have open keep their local board and their pull cursor.
 *
 * That used to be the dangerous part — a stale cursor above the server's
 * freshly-reset `next_version` meant a device believed it was caught up and
 * never pulled again, silently, forever. It is no longer dangerous: the DO
 * detects that state on the next pull and tells the client to re-read from 0
 * (`PullResponse.reset`, `user-do.ts`). A device left open will notice within
 * one sync cycle and repopulate the server from whatever it still holds
 * locally.
 *
 * So decide which you actually want:
 *
 * - **Wipe the server, keep this browser's data** — run this, then let the
 *   open tab push its board back up. Useful for re-testing a fresh sync.
 * - **Wipe everything and start from a clean seed** — use the in-app reset,
 *   which calls `resetAccountData()` (`src/lib/store/reset.ts`) and does both
 *   halves in the correct order.
 *
 * See `docs/SCHEMA-OPS.md`.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { call, resolveTarget } from "./target.mjs";

const target = resolveTarget(process.argv.slice(2));

const before = await call(target, "/api/sync/schema");
const rows = Object.entries(before.tables)
  .map(([table, { rows: n }]) => `${table}=${n}`)
  .join("  ");

console.log(`\n  About to WIPE the board on ${target.label}`);
console.log(`  rows: ${rows}`);
console.log(`  schema version: ${before.migrations.at(-1)?.id ?? "none"}\n`);

if (target.prod) {
  // Typed hostname rather than y/N. The failure this guards against is muscle
  // memory in a shell that still has `--prod` in its history, and "y" is
  // exactly what muscle memory types.
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('  Type "myfaite.app" to confirm: ');
  rl.close();
  if (answer.trim() !== "myfaite.app") {
    console.log("  aborted\n");
    process.exit(1);
  }
}

await call(target, "/api/sync/reset", { method: "POST" });
const after = await call(target, "/api/sync/schema");

console.log(`\n  wiped. schema version ${after.migrations.at(-1)?.id ?? "none"}, next version ${after.nextVersion}`);
console.log(`  rows: ${Object.entries(after.tables).map(([t, { rows: n }]) => `${t}=${n}`).join("  ")}`);
console.log(`\n  Open tabs will re-pull from 0 on their next sync cycle.\n`);
