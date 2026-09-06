/**
 * EI-272 spike: measure what a prerendered page actually makes the browser
 * download.
 *
 * Parses the <script src> tags out of a prerendered HTML file, resolves each
 * to its file in .next/static, and reports raw + gzipped bytes. Run it before
 * and after adding a dependency to get an honest delta.
 *
 *   node scripts/spike/measure-page.mjs .next/server/app/index.html
 *
 * Deliberately measures the PRERENDERED html rather than the build log: the
 * question this spike has to answer is what a cold-cache first-time visitor
 * pays, and that is exactly the set of scripts this page references.
 *
 * TRAP, found the hard way: run `npm run build` IMMEDIATELY before measuring.
 * `npm run build:static` prunes `.next/static/chunks` even though it writes to
 * `.next-static` — so measuring `.next` after `npm run verify` (which runs
 * build, then build:static) reports chunks that are simply gone, and a lazily
 * imported library reads as 0 KB. That is a measurement artefact, not a win.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const htmlPath = process.argv[2];
if (!htmlPath || !existsSync(htmlPath)) {
  console.error(`usage: node scripts/spike/measure-page.mjs <prerendered.html>`);
  process.exit(1);
}

const html = readFileSync(htmlPath, "utf8");
const srcs = [...html.matchAll(/src="(\/_next\/[^"]*\.js)"/g)].map((m) => m[1]);
const unique = [...new Set(srcs)];

let raw = 0;
let gz = 0;
const rows = [];

for (const src of unique) {
  // /_next/static/... -> .next/static/...
  const file = join(".next", src.replace(/^\/_next\//, ""));
  if (!existsSync(file)) {
    rows.push({ src, note: "MISSING" });
    continue;
  }
  const buf = readFileSync(file);
  const g = gzipSync(buf, { level: 9 }).length;
  raw += buf.length;
  gz += g;
  rows.push({ src: src.replace("/_next/static/chunks/", ""), raw: buf.length, gz: g });
}

rows.sort((a, b) => (b.gz ?? 0) - (a.gz ?? 0));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

console.log(`\n${htmlPath}`);
console.log(`${unique.length} script(s)\n`);
for (const r of rows) {
  if (r.note) { console.log(`  ${r.note.padEnd(10)} ${r.src}`); continue; }
  console.log(`  ${kb(r.gz).padStart(10)} gz  ${kb(r.raw).padStart(10)} raw  ${r.src}`);
}
console.log(`\n  TOTAL: ${kb(gz)} gzipped, ${kb(raw)} raw`);
console.log(`  HTML:  ${kb(gzipSync(Buffer.from(html), { level: 9 }).length)} gzipped\n`);
