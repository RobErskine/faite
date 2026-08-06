// P4/EI-49 WebSocket smoke test — drives the DO's socket path with no client
// code. Run against an isolated `wrangler dev` (port 8790).
import WebSocket from "ws";
import { BASE, WS_URL, hlc, loadCookie } from "./harness.mjs";


// Netscape cookie jar -> Cookie header
const cookie = loadCookie();

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} ${detail}`); }
}

function connect({ origin = BASE, withCookie = true } = {}) {
  const headers = {};
  if (withCookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return new WebSocket(WS_URL, { headers });
}

/** Opens a socket, resolves on open, rejects with the HTTP status otherwise. */
function open(opts) {
  return new Promise((resolve, reject) => {
    const ws = connect(opts);
    const timer = setTimeout(() => reject(new Error("open timeout")), 10_000);
    ws.on("open", () => { clearTimeout(timer); resolve(ws); });
    ws.on("unexpected-response", (_req, res) => { clearTimeout(timer); reject(new Error(`HTTP ${res.statusCode}`)); });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Sends a framed request and waits for the reply with the matching id. */
function rpc(ws, message, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rpc timeout for ${message.type}`)), timeoutMs);
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== message.id) return; // ignore unsolicited `changed`
      ws.off("message", onMessage);
      clearTimeout(timer);
      resolve(msg);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify(message));
  });
}


async function main() {
  console.log("\n--- handshake guards ---");

  // 1. no cookie -> 401
  await open({ withCookie: false }).then(
    (ws) => { check("unauthenticated upgrade is rejected", false, "connected anyway!"); ws.close(); },
    (err) => check("unauthenticated upgrade is rejected", /401/.test(err.message), err.message),
  );

  // 2. hostile origin -> 403
  await open({ origin: "https://evil.com" }).then(
    (ws) => { check("hostile Origin is rejected (CSWSH)", false, "connected anyway!"); ws.close(); },
    (err) => check("hostile Origin is rejected (CSWSH)", /403/.test(err.message), err.message),
  );

  // 3. no Upgrade header -> 426
  const noUpgrade = await fetch(BASE + "/api/sync/ws", { headers: { Cookie: cookie } });
  check("plain GET on /api/sync/ws returns 426", noUpgrade.status === 426, `got ${noUpgrade.status}`);

  // 4. absent Origin is allowed (non-browser client)
  await open({ origin: null }).then(
    (ws) => { check("absent Origin is allowed (non-browser client)", true); ws.close(); },
    (err) => check("absent Origin is allowed (non-browser client)", false, err.message),
  );

  console.log("\n--- framed round trips ---");
  const ws = await open();
  check("authenticated same-origin upgrade succeeds", ws.readyState === WebSocket.OPEN);

  // pull on an empty account
  const pull0 = await rpc(ws, { id: "r1", type: "pull", payload: { cursor: 0, limit: 100 } });
  check("pull returns a pull-response", pull0.type === "pull-response", JSON.stringify(pull0));
  check("pull payload matches the HTTP shape", pull0.payload?.protocol === 1 && Array.isArray(pull0.payload?.changes));

  // push a real row
  const push1 = await rpc(ws, {
    id: "r2",
    type: "push",
    payload: {
      protocol: 1,
      entries: [{
        id: "outbox-1", kind: "list", entityId: "list-smoke-1",
        patch: { name: "Smoke List", position: "a0", tabId: null, isBacklog: false },
        hlc: hlc(Date.now()),
      }],
    },
  });
  check("push returns a push-response", push1.type === "push-response", JSON.stringify(push1));
  check("push acked the entry", push1.payload?.acked?.includes("outbox-1"), JSON.stringify(push1.payload));
  check("push allocated a version", push1.payload?.highestVersion > 0, JSON.stringify(push1.payload));

  // pull it back
  const pull1 = await rpc(ws, { id: "r3", type: "pull", payload: { cursor: 0, limit: 100 } });
  const names = (pull1.payload?.changes ?? []).flatMap((c) => Object.entries(c.patch));
  check("pull returns the pushed row", JSON.stringify(names).includes("Smoke List"), JSON.stringify(pull1.payload));

  console.log("\n--- validation shared with the HTTP route ---");

  const badProto = await rpc(ws, { id: "r4", type: "push", payload: { protocol: 99, entries: [] } });
  check("wrong protocol version -> error", badProto.type === "error", JSON.stringify(badProto));

  const badCursor = await rpc(ws, { id: "r5", type: "pull", payload: { cursor: -1, limit: 10 } });
  check("negative cursor -> error", badCursor.type === "error", JSON.stringify(badCursor));

  const hugeLimit = await rpc(ws, { id: "r6", type: "pull", payload: { cursor: 0, limit: 999999999 } });
  check("absurd limit is clamped, not fatal", hugeLimit.type === "pull-response", JSON.stringify(hugeLimit));

  const tooMany = await rpc(ws, {
    id: "r7", type: "push",
    payload: { protocol: 1, entries: Array.from({ length: 501 }, (_, i) => ({
      id: `o-${i}`, kind: "todo", entityId: `t-${i}`, patch: { title: "x" }, hlc: hlc(Date.now() + i),
    })) },
  });
  check("batch over MAX_PUSH_ENTRIES -> error", tooMany.type === "error", JSON.stringify(tooMany));

  console.log("\n--- hostile frames must not kill the object ---");
  for (const junk of ["", "{", "not json", "null", "[]", JSON.stringify({ id: "x", type: "wipe", payload: {} })]) {
    ws.send(junk);
  }
  ws.send(Buffer.from([0xde, 0xad, 0xbe, 0xef])); // binary frame
  await new Promise((r) => setTimeout(r, 500));
  check("socket survived a barrage of malformed frames", ws.readyState === WebSocket.OPEN);
  const afterJunk = await rpc(ws, { id: "r8", type: "pull", payload: { cursor: 0, limit: 10 } });
  check("still serves requests after malformed frames", afterJunk.type === "pull-response", JSON.stringify(afterJunk));

  // A second socket must be unaffected by the first one's abuse.
  const ws2 = await open();
  const onWs2 = await rpc(ws2, { id: "s1", type: "pull", payload: { cursor: 0, limit: 10 } });
  check("a second socket is unaffected", onWs2.type === "pull-response", JSON.stringify(onWs2));
  ws2.close();

  ws.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error("HARNESS ERROR", err); process.exit(2); });
