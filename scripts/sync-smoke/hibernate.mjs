// The single riskiest path in P4: does a socket still work after the Durable
// Object has actually hibernated?
//
// Eviction for an idle DO is a 70-140s window, so a fast "open two tabs and
// edit" test proves broadcast and proves NOTHING about hibernation. When the
// object wakes, the constructor re-runs and every in-memory field is gone —
// only `serializeAttachment` survives. If that contract is broken, the first
// message after a real idle period fails to resolve `userId` and the socket
// is dead in a way no unit test can see.
import WebSocket from "ws";
import { BASE, WS_URL, hlc, loadCookie } from "./harness.mjs";

const IDLE_MS = Number(process.argv[2] ?? 170_000);

const cookie = loadCookie();

const ws = new WebSocket(WS_URL, {
  headers: { Cookie: cookie, Origin: BASE },
});

function rpc(message, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${message.id}`)), timeoutMs);
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

const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`);

ws.on("close", (code, reason) => log(`socket CLOSED code=${code} reason=${reason}`));
ws.on("error", (err) => log(`socket ERROR ${err.message}`));

ws.on("open", async () => {
  try {
    log("open; priming with a push so there is state to read back later");
    const primed = await rpc({
      id: "h1", type: "push",
      payload: { protocol: 1, entries: [{
        id: "hib-outbox-1", kind: "list", entityId: "list-hibernate-1",
        patch: { name: "Pre-Hibernation", position: "a1", tabId: null, isBacklog: false },
        hlc: hlc(Date.now(), "hibernate-node"),
      }] },
    });
    if (primed.type !== "push-response" || !primed.payload.acked.includes("hib-outbox-1")) {
      log(`FAIL: priming push did not ack: ${JSON.stringify(primed)}`);
      process.exit(1);
    }
    log(`primed at version ${primed.payload.highestVersion}`);

    log(`idling ${Math.round(IDLE_MS / 1000)}s (eviction window is 70-140s) — NOT sending anything...`);
    await new Promise((r) => setTimeout(r, IDLE_MS));

    if (ws.readyState !== WebSocket.OPEN) {
      log(`FAIL: socket was not OPEN after idle (readyState=${ws.readyState})`);
      process.exit(1);
    }
    log("socket still OPEN after the idle window (runtime ping/pong kept it alive without waking the DO)");

    log("sending a pull — this is the post-hibernation wake-up");
    const pulled = await rpc({ id: "h2", type: "pull", payload: { cursor: 0, limit: 100 } });
    if (pulled.type !== "pull-response") {
      log(`FAIL: post-hibernation pull did not return a pull-response: ${JSON.stringify(pulled)}`);
      process.exit(1);
    }
    const found = JSON.stringify(pulled.payload.changes).includes("Pre-Hibernation");
    log(`post-hibernation pull OK; pre-hibernation row present=${found}`);

    log("sending a push — this exercises deserializeAttachment()'s userId, which owner_id depends on");
    const pushed = await rpc({
      id: "h3", type: "push",
      payload: { protocol: 1, entries: [{
        id: "hib-outbox-2", kind: "list", entityId: "list-hibernate-2",
        patch: { name: "Post-Hibernation", position: "a2", tabId: null, isBacklog: false },
        hlc: hlc(Date.now(), "hibernate-node"),
      }] },
    });
    const ok = pushed.type === "push-response"
      && pushed.payload.acked.includes("hib-outbox-2")
      && pushed.payload.highestVersion > 0;
    log(`post-hibernation push ${ok ? "OK" : "FAILED"}: ${JSON.stringify(pushed.payload ?? pushed)}`);

    // owner_id on that insert can ONLY have come from the attachment.
    const verify = await rpc({ id: "h4", type: "pull", payload: { cursor: 0, limit: 100 } });
    const both = JSON.stringify(verify.payload.changes);
    const sawBoth = both.includes("Pre-Hibernation") && both.includes("Post-Hibernation");
    log(`both rows visible after hibernation: ${sawBoth}`);

    ws.close();
    console.log(ok && found && sawBoth ? "\nHIBERNATION TEST PASSED\n" : "\nHIBERNATION TEST FAILED\n");
    process.exit(ok && found && sawBoth ? 0 : 1);
  } catch (err) {
    log(`HARNESS ERROR ${err.message}`);
    process.exit(2);
  }
});
