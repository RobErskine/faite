// Phase 4: does a write on one connection wake the others, and only the
// others? Two sockets stand in for two devices.
import WebSocket from "ws";
import { BASE, WS_URL, hlc, loadCookie } from "./harness.mjs";

const cookie = loadCookie();

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} ${detail}`); }
};

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: { Cookie: cookie, Origin: BASE },
    });
    ws.changed = [];           // every unsolicited `changed` this socket saw
    ws.label = label;
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "changed") ws.changed.push(msg);
    });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws.on("unexpected-response", (_q, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

function rpc(ws, message, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rpc timeout ${message.id}`)), timeoutMs);
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== message.id) return;
      ws.off("message", onMessage);
      clearTimeout(timer);
      resolve(msg);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify(message));
  });
}

const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const a = await open("A");
  const b = await open("B");
  const c = await open("C");
  check("three sockets connected", [a, b, c].every((s) => s.readyState === WebSocket.OPEN));

  console.log("\n--- a write on A reaches B and C, but not A ---");
  const pushed = await rpc(a, {
    id: "b1", type: "push",
    payload: { protocol: 1, entries: [{
      id: "bcast-1", kind: "list", entityId: "list-bcast-1",
      patch: { name: "Broadcast Test", position: "b0", tabId: null, isBacklog: false },
      hlc: hlc(Date.now()),
    }] },
  });
  const version = pushed.payload.highestVersion;
  check("push allocated a version", version > 0, JSON.stringify(pushed.payload));
  await settle();

  check("B was notified", b.changed.length === 1, JSON.stringify(b.changed));
  check("C was notified", c.changed.length === 1, JSON.stringify(c.changed));
  check("the pusher A was NOT notified about its own write", a.changed.length === 0, JSON.stringify(a.changed));
  check("the notification carries the version that caused it",
    b.changed[0]?.version === version, `${b.changed[0]?.version} vs ${version}`);

  console.log("\n--- a no-op push must not wake anybody ---");
  b.changed.length = 0; c.changed.length = 0; a.changed.length = 0;
  // Byte-identical re-push: every field loses the LWW comparison, so no
  // version is allocated and there is genuinely nothing to tell anyone.
  const dup = await rpc(a, {
    id: "b2", type: "push",
    payload: { protocol: 1, entries: [{
      id: "bcast-1-again", kind: "list", entityId: "list-bcast-1",
      patch: { name: "Broadcast Test", position: "b0", tabId: null, isBacklog: false },
      hlc: hlc(1),  // ancient clock: loses every field
    }] },
  });
  await settle();
  check("duplicate push allocated no version", dup.payload.highestVersion === 0, JSON.stringify(dup.payload));
  check("no broadcast for a write that changed nothing",
    b.changed.length === 0 && c.changed.length === 0, JSON.stringify({ b: b.changed, c: c.changed }));

  console.log("\n--- an HTTP push still wakes every socket ---");
  // Required, not incidental: a device on the polling fallback must be able
  // to wake a device on a socket.
  b.changed.length = 0; c.changed.length = 0; a.changed.length = 0;
  const httpRes = await fetch(BASE + "/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ protocol: 1, entries: [{
      id: "http-bcast-1", kind: "list", entityId: "list-http-bcast",
      patch: { name: "From HTTP", position: "c0", tabId: null, isBacklog: false },
      hlc: hlc(Date.now() + 5000),
    }] }),
  });
  const httpBody = await httpRes.json();
  await settle();
  check("HTTP push succeeded", httpRes.status === 200 && httpBody.highestVersion > 0, JSON.stringify(httpBody));
  check("all three sockets notified by an HTTP push (no origin socket to exclude)",
    a.changed.length === 1 && b.changed.length === 1 && c.changed.length === 1,
    JSON.stringify({ a: a.changed.length, b: b.changed.length, c: c.changed.length }));

  console.log("\n--- a dead socket must not break the broadcast for live ones ---");
  a.changed.length = 0; b.changed.length = 0;
  c.terminate();               // abrupt close, no close frame
  await settle(300);
  const afterDeath = await rpc(a, {
    id: "b3", type: "push",
    payload: { protocol: 1, entries: [{
      id: "bcast-2", kind: "list", entityId: "list-bcast-2",
      patch: { name: "After Death", position: "d0", tabId: null, isBacklog: false },
      hlc: hlc(Date.now() + 10_000),
    }] },
  });
  await settle();
  check("push still succeeds with a dead peer attached",
    afterDeath.type === "push-response" && afterDeath.payload.acked.includes("bcast-2"),
    JSON.stringify(afterDeath));
  check("the surviving socket B was still notified", b.changed.length === 1, JSON.stringify(b.changed));

  a.close(); b.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error("HARNESS ERROR", err); process.exit(2); });
