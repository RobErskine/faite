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
node scripts/email-smoke/send.mjs <localpart> --count 55       # the 51st must reject
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

## What the local endpoint tells you (wrangler 4.149+)

**The HTTP status is the verdict.** Since the wrangler 4.149 upgrade (EI-358),
a message the handler rejected with `setReject()` answers
**`400 Worker rejected email with the following reason: …`**, and an accepted
one answers `200 Worker successfully processed email`. Older wranglers
answered 200 for both, which is why this script still prints the status and
still points at the `[faite] email-ingest {"decision":…}` log line. The
automated version of this smoke test is `e2e/server/email-ingest.spec.ts`
(EI-361), which asserts on that status.

**The local size limit is 25 MiB now, not 1 MiB.** Older wranglers refused
any body over 1 MiB before it reached the Worker; 4.149 allows up to the
25 MiB production limit, so the 10 MiB guard in `ingest.ts` is reachable
locally. `--huge` still sends ~900 KB (it was sized for the old limit), which
proves a large message parses and gets its description capped. Exercising the
guard itself needs a body over 10 MiB — not yet scripted.

## What to check afterwards

1. The to-do appears in **Backlog** on an already-open board, **live, with no
   reload**. That is the real assertion: it proves the write went through
   `UserDurableObject.push()` rather than a side-channel table write, because
   only `push()` fires the P4 broadcast.
2. The to-do sheet shows a **"From email · sender@…"** badge.
3. `wrangler dev`'s log contains **neither the subject nor the body** — grep
   for both. See `docs/EMAIL-INGEST.md` §Privacy, invariant 3.
