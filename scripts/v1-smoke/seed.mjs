import { readFileSync } from "node:fs";
const PORT = process.env.FAITE_SMOKE_PORT ?? "8790";
const BASE = `http://localhost:${PORT}`;
const cookies = readFileSync(process.env.FAITE_SMOKE_COOKIES ?? "/tmp/faite-verify/cookies.txt", "utf8")
  // `#HttpOnly_` lines are real cookies, not comments — the session token is
  // one, so filtering every `#` line drops exactly the cookie that matters.
  .split("\n").filter((l) => l.trim() && (!l.startsWith("#") || l.startsWith("#HttpOnly_")))
  .map((l) => { const p = l.split("\t"); return `${p[5]}=${p[6]}`; }).join("; ");

let counter = 0;
const hlc = () =>
  `${Date.now().toString(16).padStart(12, "0")}:${(counter++).toString(16).padStart(4, "0")}:verify`;

const iso = (d) => new Date(d).toISOString();
const NOW = iso(Date.now());
const base = (id) => ({ id, createdAt: NOW, updatedAt: NOW, deletedAt: null });

const TAB = "11111111-1111-7111-8111-111111111111";
const BACKLOG = "22222222-2222-7222-8222-222222222222";
const ERRANDS = "33333333-3333-7333-8333-333333333333";
const OLD_TODO = "44444444-4444-7444-8444-444444444444";
const ERR_TODO = "55555555-5555-7555-8555-555555555555";

const deco = { color: null, emoji: null, iconUrl: null };
const long_ago = iso(Date.now() - 60 * 24 * 3600 * 1000).slice(0, 10);

const entry = (kind, entityId, patch) => ({ id: crypto.randomUUID(), kind, entityId, patch, hlc: hlc() });

const entries = [
  entry("tab", TAB, { ...base(TAB), ...deco, name: "Personal", description: null, isDefault: true, archivedAt: null, position: "a0" }),
  entry("list", BACKLOG, { ...base(BACKLOG), ...deco, name: "Backlog", isBacklog: true, archivedAt: null, archivedWithTabId: null, position: "a0", tabId: null, defaultReminderPresetId: null, description: null }),
  entry("list", ERRANDS, { ...base(ERRANDS), ...deco, name: "Errands", isBacklog: false, archivedAt: null, archivedWithTabId: null, position: "a1", tabId: TAB, defaultReminderPresetId: null, description: "Things to pick up" }),
  entry("todo", OLD_TODO, { ...base(OLD_TODO), title: "Overdue thing", description: null, status: "open", priority: null, scheduledDate: long_ago, scheduledAt: null, deadline: null, listId: null, projectId: null, labelIds: [], location: null, placeId: null, parentId: null, position: "a0", recurrenceRule: null, recurrenceParentId: null, completedAt: null, reminderTime: null, source: null }),
  entry("todo", ERR_TODO, { ...base(ERR_TODO), title: "Buy milk", description: null, status: "open", priority: null, scheduledDate: null, scheduledAt: null, deadline: null, listId: ERRANDS, projectId: null, labelIds: [], location: null, placeId: null, parentId: null, position: "a1", recurrenceRule: null, recurrenceParentId: null, completedAt: null, reminderTime: null, source: null }),
];

const res = await fetch(`${BASE}/api/sync/push`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookies, Origin: "http://localhost:8787" },
  body: JSON.stringify({ protocol: 1, entries }),
});
const body = await res.json();
console.log("seed status:", res.status);
console.log("acked:", body.acked?.length, "rejected:", JSON.stringify(body.rejected ?? []));
console.log(JSON.stringify({ TAB, BACKLOG, ERRANDS, OLD_TODO, ERR_TODO }));
