# Email ingest smoke harness (EI-186)

Drives the Worker's `email()` handler with no real mail and no DNS.

## Setup

```bash
npx opennextjs-cloudflare build     # `.open-next/worker.js` must exist
npx wrangler dev                    # serves the handler at :8787
```

Then get a local part: sign in at `npm run dev`, open **Settings → Email
capture**, create the address, and take the part before the `@`.

## Run

```bash
node scripts/email-smoke/send.mjs <localpart>
node scripts/email-smoke/send.mjs <localpart> --count 3        # distinct positions, in order
node scripts/email-smoke/send.mjs <localpart> --html           # no text/plain part
node scripts/email-smoke/send.mjs <localpart> --big            # exercises the 16 KB description cap
node scripts/email-smoke/send.mjs <localpart> --huge           # >10 MiB, rejected before parsing
node scripts/email-smoke/send.mjs <localpart> --count 35       # the 31st must reject
node scripts/email-smoke/send.mjs nosuchaddress                # unknown local part
node scripts/email-smoke/send.mjs <localpart> --rcpt '<localpart>+family@in.myfaite.app'
```

Equivalent one-liner, if you'd rather not use the script:

```bash
curl -X POST 'http://localhost:8787/cdn-cgi/handler/email' \
  --url-query 'from=rob@example.com' \
  --url-query 'to=<localpart>@in.myfaite.app' \
  --data-raw $'From: "Rob" <rob@example.com>\nMessage-ID: <t1>\nSubject: Buy milk\n\nfrom the good place'
```

**`Message-ID` is required** — without it the local handler rejects the
message, and the error does not mention the missing header.

## Two things the local endpoint will not tell you

**HTTP 200 does not mean "accepted."** The endpoint reports whether the
handler *ran*; `setReject()` is a normal return, not an exception, so a
rejected message still answers `200 Worker successfully processed email`. The
verdict is the `[faite] email-ingest {"decision":…}` line in the `wrangler dev`
output — that is what the script tells you to grep for.

**The 10 MiB size guard is not reachable locally.** `wrangler dev` refuses any
body over **1 MiB** with its own 400 (`exceeds the lower 1Mib limit for testing
locally`), so the request never reaches the Worker. `--huge` sends ~900 KB,
which proves a large message parses and gets its description capped; the guard
in `ingest.ts` can only be exercised against a real deploy.

## What to check afterwards

1. The to-do appears in **Backlog** on an already-open board, **live, with no
   reload**. That is the real assertion: it proves the write went through
   `UserDurableObject.push()` rather than a side-channel table write, because
   only `push()` fires the P4 broadcast.
2. The to-do sheet shows a **"From email · sender@…"** badge.
3. `wrangler dev`'s log contains **neither the subject nor the body** — grep
   for both. See `docs/EMAIL-INGEST.md` §Privacy, invariant 3.
