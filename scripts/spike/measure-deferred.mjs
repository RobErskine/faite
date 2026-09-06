/**
 * EI-272 spike. Finds the chunks a page loads LAZILY - the ones the HTML does
 * not reference, which arrive later via next/dynamic.
 *
 * The initial-payload number is only half the honest answer. This is the other
 * half: what the browser fetches once the WebGL gate passes, and therefore
 * what a mobile user pays in data and battery even though they never paid for
 * it in LCP.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CHUNKS = ".next/static/chunks";
const html = readFileSync(process.argv[2] ?? ".next/server/app/index.html", "utf8");
const eager = new Set(
  [...html.matchAll(/src="\/_next\/static\/chunks\/([^"]*\.js)"/g)].map((m) => m[1]),
);

// A chunk is "ours" if it names three.js internals. Cheap, and it answers the
// acceptance criterion directly: is three.js in this build, and where.
const NEEDLE = /WebGLRenderer|BufferGeometry|THREE\.|Object3D/;

const rows = [];
for (const f of readdirSync(CHUNKS)) {
  if (!f.endsWith(".js")) continue;
  const buf = readFileSync(join(CHUNKS, f));
  const text = buf.toString("utf8");
  if (!NEEDLE.test(text)) continue;
  rows.push({
    f,
    eager: eager.has(f),
    raw: buf.length,
    gz: gzipSync(buf, { level: 9 }).length,
  });
}
rows.sort((a, b) => b.gz - a.gz);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let lazyGz = 0, lazyRaw = 0, eagerGz = 0;

console.log(`\nChunks containing three.js:\n`);
for (const r of rows) {
  console.log(
    `  ${r.eager ? "EAGER" : "lazy "}  ${kb(r.gz).padStart(10)} gz  ${kb(r.raw).padStart(10)} raw  ${r.f}`,
  );
  if (r.eager) eagerGz += r.gz;
  else { lazyGz += r.gz; lazyRaw += r.raw; }
}
console.log(`\n  Lazy  (paid after paint): ${kb(lazyGz)} gz / ${kb(lazyRaw)} raw`);
console.log(`  EAGER (paid before paint): ${kb(eagerGz)} gz  <-- must be 0.0 KB\n`);
