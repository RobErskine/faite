import { readFileSync } from "node:fs";
const PORT = process.env.FAITE_SMOKE_PORT ?? "8790";
const BASE = `http://localhost:${PORT}/api/v1`;
const KEY = readFileSync(process.env.FAITE_SMOKE_KEY ?? "/tmp/faite-verify/key.txt", "utf8").trim();
const BACKLOG = "22222222-2222-7222-8222-222222222222";
const TAB = "11111111-1111-7111-8111-111111111111";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 204 */ }
  return { status: res.status, body: json };
}

console.log("\n── A17: derived reads ──");
const overflow = await call("GET", "/overflow");
check("GET /overflow 200", overflow.status === 200, `got ${overflow.status}`);
check("overflow contains the overdue to-do", overflow.body?.some((t) => t.title === "Overdue thing"));
check("overflow excludes the unscheduled one", !overflow.body?.some((t) => t.title === "Buy milk"));
check("no `version` leaked", overflow.body?.every((t) => !("version" in t)));

const backlog = await call("GET", "/backlog");
check("GET /backlog 200", backlog.status === 200);

const profile = await call("GET", "/profile");
check("GET /profile 200", profile.status === 200);
check("profile has Faite Loop config", profile.body?.overflowAfterDays !== undefined);
check("profile hides device-local prefs",
  !("backlogWidth" in (profile.body ?? {})) && !("splitRatio" in (profile.body ?? {})));

console.log("\n── A16: day notes ──");
const DATE = "2026-09-08";
const empty = await call("GET", `/day-notes/${DATE}`);
check("GET a day with no note → 200 empty body", empty.status === 200 && empty.body?.body === "");

const noop = await call("PUT", `/day-notes/${DATE}`, { body: "" });
check("PUT empty on an empty day is a no-op", noop.status === 200 && noop.body?.body === "");
const afterNoop = await call("GET", "/day-notes");
check("...and wrote no row", !afterNoop.body?.some((n) => n.date === DATE));

const wrote = await call("PUT", `/day-notes/${DATE}`, { body: "# Standup notes" });
check("PUT writes Markdown", wrote.status === 200 && wrote.body?.body === "# Standup notes");
check("id is derived from the date", wrote.body?.id === `daynote:${DATE}`);
const range = await call("GET", `/day-notes?from=${DATE}&to=${DATE}`);
check("range read finds it", range.body?.length === 1);
const cleared = await call("PUT", `/day-notes/${DATE}`, { body: "" });
check("PUT empty clears it", cleared.status === 200 && cleared.body?.body === "");
const afterClear = await call("GET", "/day-notes");
check("cleared note is excluded from the range read",
  !afterClear.body?.some((n) => n.date === DATE));
check("no DELETE route", (await call("DELETE", `/day-notes/${DATE}`)).status === 404);
check("bad date → 400", (await call("GET", "/day-notes/nope")).status === 400);

console.log("\n── A14: lists ──");
const created = await call("POST", "/lists", { name: "Verify List", description: "temp" });
check("POST /lists 201", created.status === 201, `got ${created.status}`);
check("position server-resolved", typeof created.body?.position === "string");
check("tabId defaulted to the default tab", created.body?.tabId === TAB);
const NEW_LIST = created.body?.id;

const renamed = await call("PATCH", `/lists/${NEW_LIST}`, { name: "Renamed" });
check("PATCH renames", renamed.body?.name === "Renamed");
check("REGRESSION: rename did NOT clear description", renamed.body?.description === "temp");
check("REGRESSION: rename did NOT set isBacklog", renamed.body?.isBacklog === false);
check("REGRESSION: rename did NOT clear tabId", renamed.body?.tabId === TAB);

check("DELETE Backlog → 409", (await call("DELETE", `/lists/${BACKLOG}`)).status === 409);

// Move the seeded todo into the new list, then delete it and check the rehome.
await call("PATCH", "/todos/55555555-5555-7555-8555-555555555555", { listId: NEW_LIST });
const del = await call("DELETE", `/lists/${NEW_LIST}`);
check("DELETE a populated list → 204", del.status === 204, `got ${del.status}`);
const rehomed = await call("GET", "/todos/55555555-5555-7555-8555-555555555555");
check("its to-do was rehomed to Backlog", rehomed.body?.listId === BACKLOG,
  `listId=${rehomed.body?.listId}`);
check("the list is gone from GET /lists",
  !(await call("GET", "/lists")).body?.some((l) => l.id === NEW_LIST));

console.log("\n── A15: labels & tabs ──");
const label = await call("POST", "/labels", { name: "Urgent", color: "red" });
check("POST /labels 201", label.status === 201);
const LABEL = label.body?.id;
await call("PATCH", `/todos/${"55555555-5555-7555-8555-555555555555"}`, { labelIds: [LABEL] });
const delLabel = await call("DELETE", `/labels/${LABEL}`);
check("DELETE /labels 204", delLabel.status === 204);
const stripped = await call("GET", "/todos/55555555-5555-7555-8555-555555555555");
check("label was stripped from the to-do", !(stripped.body?.labelIds ?? []).includes(LABEL),
  JSON.stringify(stripped.body?.labelIds));

const tab = await call("POST", "/tabs", { name: "Work", isDefault: true });
check("POST /tabs 201", tab.status === 201);
check("client-supplied isDefault ignored", tab.body?.isDefault === false);
check("DELETE default tab → 409", (await call("DELETE", `/tabs/${TAB}`)).status === 409);
check("DELETE a normal tab → 204", (await call("DELETE", `/tabs/${tab.body?.id}`)).status === 204);

console.log("\n── A13: todo filters & delete ──");
const filtered = await call("GET", "/todos?status=open&limit=1");
check("filters + limit work", filtered.status === 200 && filtered.body?.length === 1);
check("no implicit page size", (await call("GET", "/todos")).body?.length >= 2);
check("bad filter → 400", (await call("GET", "/todos?status=nope")).status === 400);

console.log("\n── scope enforcement ──");
const roRes = await fetch(`${BASE}/todos`, { headers: { Authorization: "Bearer faite_bogus" } });
check("a bogus key → 401", roRes.status === 401);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
