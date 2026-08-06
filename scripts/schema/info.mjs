#!/usr/bin/env node
/**
 * Prints the schema state of your own Durable Object.
 *
 *   npm run schema:info
 *   npm run schema:info -- --prod
 *
 * A DO's SQLite has no external query endpoint — unlike D1, which is
 * reachable through the Cloudflare API. Without this there is no way to
 * confirm a migration actually applied to a real account short of shipping a
 * change and reading `wrangler tail`. See `docs/SCHEMA-OPS.md`.
 */
import { call, resolveTarget } from "./target.mjs";

const target = resolveTarget(process.argv.slice(2));
const info = await call(target, "/api/sync/schema");

console.log(`\n  ${target.label}\n`);

const latest = info.migrations.at(-1);
console.log(`  schema version   ${latest ? `${latest.id} (${latest.name})` : "NONE — ledger is empty"}`);
console.log(`  next version     ${info.nextVersion}`);
console.log(`\n  migrations`);
for (const migration of info.migrations) {
  console.log(`    ${String(migration.id).padStart(3)}  ${migration.name.padEnd(28)} ${migration.appliedAt}`);
}

console.log(`\n  tables`);
for (const [table, { columns, rows }] of Object.entries(info.tables)) {
  console.log(`    ${table.padEnd(16)} ${String(rows).padStart(6)} rows  ${columns.length} cols`);
  console.log(`      ${columns.join(", ")}`);
}
console.log();
