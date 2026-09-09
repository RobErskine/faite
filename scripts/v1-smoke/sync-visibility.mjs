import { readFileSync } from "node:fs";
const PORT = process.env.FAITE_SMOKE_PORT ?? "8790";
const BASE = `http://localhost:${PORT}`;
const KEY = readFileSync(process.env.FAITE_SMOKE_KEY ?? "/tmp/faite-verify/key.txt", "utf8").trim();
const cookies = readFileSync(process.env.FAITE_SMOKE_COOKIES ?? "/tmp/faite-verify/cookies.txt", "utf8")
  .split("\n").filter((l) => l.trim() && (!l.startsWith("#") || l.startsWith("#HttpOnly_")))
  .map((l) => { const p = l.split("\t"); return `${p[5]}=${p[6]}`; }).join("; ");

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; console.log(`  ❌ ${n} ${d}`); }
};

const pull = async (since) => {
  const res = await fetch(`${BASE}/api/sync/pull?since=${since}&limit=500`, {
    headers: { Cookie: cookies, Origin: "http://localhost:8787" },
  });
  return res.json();
};

console.log("\n── docs/API.md: 'a REST write is a push, not a database write' ──");

const before = await pull(0);
const cursorBefore = before.cursor ?? 0;

// A REST write through the API key.
const created = await fetch(`${BASE}/api/v1/todos`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Sync visibility probe" }),
}).then((r) => r.json());

// A sync client that was already caught up asks "what changed since?"
const delta = await pull(cursorBefore);
const found = JSON.stringify(delta).includes("Sync visibility probe");

check("the version cursor advanced", (delta.cursor ?? 0) > cursorBefore,
  `${cursorBefore} -> ${delta.cursor}`);
check("a caught-up device PULLS the REST write", found,
  "the write allocated no version — it would be invisible to every device");

// The inverse: a DELETE must also be pullable, or the row never disappears.
const cursorMid = delta.cursor;
await fetch(`${BASE}/api/v1/todos/${created.id}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${KEY}` },
});
const afterDelete = await pull(cursorMid);
check("the DELETE is pullable too", (afterDelete.cursor ?? 0) > cursorMid,
  `${cursorMid} -> ${afterDelete.cursor}`);
check("the tombstone carries deletedAt", JSON.stringify(afterDelete).includes("deletedAt"));

console.log("\n── scope gating with a REAL read-only key ──");
const roKey = await fetch(`${BASE}/api/auth/api-key/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookies, Origin: "http://localhost:8787" },
  body: JSON.stringify({ name: "Verify RO" }),
}).then((r) => r.json());

const roRead = await fetch(`${BASE}/api/v1/todos`, {
  headers: { Authorization: `Bearer ${roKey.key}` },
});
check("read-only key CAN read", roRead.status === 200, `got ${roRead.status}`);

for (const [method, path, body] of [
  ["POST", "/api/v1/todos", { title: "nope" }],
  ["POST", "/api/v1/lists", { name: "nope" }],
  ["DELETE", "/api/v1/todos/anything", undefined],
  ["PUT", "/api/v1/day-notes/2026-09-08", { body: "nope" }],
]) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${roKey.key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  check(`read-only key CANNOT ${method} ${path} → 403`, res.status === 403, `got ${res.status}`);
}

console.log("\n── CORS preflight (EI-307) ──");
const pre = await fetch(`${BASE}/api/v1/todos`, {
  method: "OPTIONS",
  headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PATCH" },
});
const allow = pre.headers.get("access-control-allow-methods") ?? "";
check("preflight advertises PATCH and DELETE", allow.includes("PATCH") && allow.includes("DELETE"), allow);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
