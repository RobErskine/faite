// EI-186 email ingest smoke harness — drives `email()` with no real mail.
//
// `wrangler dev` exposes the email handler at `/cdn-cgi/handler/email`. That
// endpoint is the only way to exercise this path locally:
// `@cloudflare/vitest-pool-workers` is banned in this repo (see docs/SYNC.md),
// and the alternative — sending real mail to a live deploy — is not a loop you
// can iterate in.
//
// Usage:
//   node scripts/email-smoke/send.mjs <localpart>
//   node scripts/email-smoke/send.mjs <localpart> --subject "Buy milk" --body "from the good place"
//   node scripts/email-smoke/send.mjs <localpart> --html      # html-only, no text part
//   node scripts/email-smoke/send.mjs <localpart> --big       # ~400 KB body, exercises the 16 KB cap
//   node scripts/email-smoke/send.mjs <localpart> --huge      # oversize (see the note below)
//   node scripts/email-smoke/send.mjs <localpart> --count 3   # ordering: three in a row
//   node scripts/email-smoke/send.mjs <localpart> --count 55  # rate cap: the 51st must reject
//
// The local port defaults to 8787; override with FAITE_SMOKE_PORT.
// The domain defaults to in.myfaite.app; override with FAITE_INGEST_DOMAIN.

const PORT = process.env.FAITE_SMOKE_PORT ?? "8787";
const DOMAIN = process.env.FAITE_INGEST_DOMAIN ?? "in.myfaite.app";
const ENDPOINT = `http://localhost:${PORT}/cdn-cgi/handler/email`;

const argv = process.argv.slice(2);
const localPart = argv[0];
if (!localPart || localPart.startsWith("--")) {
  console.error("usage: node scripts/email-smoke/send.mjs <localpart> [options]");
  console.error("       (get the local part from Settings → Email capture)");
  process.exit(2);
}

function flag(name) {
  return argv.includes(`--${name}`);
}
function option(name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
}

const from = option("from", "rob@example.com");
const subject = option("subject", "Buy milk");
const count = Number(option("count", "1"));

function bodyFor(index) {
  // NOT 11 MiB. `wrangler dev`'s handler endpoint refuses anything over
  // **1 MiB** with its own 400 ("exceeds the lower 1Mib limit for testing
  // locally") — the request never reaches the Worker, so the production
  // 10 MiB guard in `ingest.ts` is NOT reachable from here. This size proves
  // a large message parses; the guard itself is production-only.
  if (flag("huge")) return "x".repeat(900 * 1024);
  if (flag("big")) return "lorem ipsum dolor sit amet ".repeat(16_000);
  const base = option("body", "from the good place");
  return count > 1 ? `${base} (${index + 1} of ${count})` : base;
}

/** RFC 5322. `Message-ID` is REQUIRED — the local handler rejects a message
 * without one, with an error that does not name the missing header. */
function mime(index) {
  const body = bodyFor(index);
  const messageId = `<smoke-${Date.now()}-${index}@example.com>`;
  const headers = [
    `From: "Rob" <${from}>`,
    `To: ${localPart}@${DOMAIN}`,
    `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${count > 1 ? `${subject} ${index + 1}` : subject}`,
  ];
  if (flag("html")) {
    headers.push("Content-Type: text/html; charset=utf-8");
    return `${headers.join("\n")}\n\n<html><body><p>${body}</p></body></html>`;
  }
  headers.push("Content-Type: text/plain; charset=utf-8");
  return `${headers.join("\n")}\n\n${body}`;
}

async function send(index) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("from", from);
  // The ENVELOPE recipient — this is what `splitRecipient` reads, and it is
  // what a `+tag` has to be attached to (the `To:` header is not consulted).
  url.searchParams.set("to", option("rcpt", `${localPart}@${DOMAIN}`));

  const response = await fetch(url, { method: "POST", body: mime(index) });
  const text = await response.text();
  // **200 here does NOT mean the message was accepted.** The local endpoint
  // reports whether the HANDLER RAN, and `setReject()` is not an exception —
  // a rejected message still returns "Worker successfully processed email".
  // The real verdict is the `[faite] email-ingest {"decision":…}` line in the
  // `wrangler dev` output.
  console.log(`  ${String(index + 1).padStart(3)} HTTP ${response.status} ${text.trim().slice(0, 120)}`);
  return response.ok;
}

console.log(`\nsending ${count} message(s) to ${localPart}@${DOMAIN} via ${ENDPOINT}\n`);
let accepted = 0;
for (let i = 0; i < count; i++) {
  // Serial, not Promise.all: the rate window is a read-modify-write on one D1
  // row, so concurrent sends would race it and the 51st-rejects assertion
  // would be flaky for reasons that have nothing to do with the cap.
  if (await send(i)) accepted++;
}
console.log(`\n${accepted}/${count} reached the handler (this says nothing about accept vs reject).`);
console.log("\nThe verdict is in `wrangler dev`'s log:");
console.log("  grep 'email-ingest' — one line per message, with its decision\n");
console.log("Then check the board (npm run dev, signed in as that user):");
console.log("  - the to-do is in Backlog, live, with no reload  → it went through push()");
console.log("  - the sheet shows a 'From email · …' badge       → source blob round-tripped");
console.log("  - `wrangler dev`'s log has no subject or body    → privacy invariant 3\n");
