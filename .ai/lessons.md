# Lessons

## Verify deploys with a real request, not the deploy output

`wrangler deploy` reported success and printed both bindings, but the first
`curl` returned 404 with `error code: 1042`. That looked like a worker-fetch
loop. It was propagation lag — the same URL returned 200 moments later.

**Rule:** after deploying, poll the URL before concluding anything is broken,
and re-test once before chasing a root cause. Equally: never report a deploy as
working on the strength of the deploy command's own output.

## Don't grep for content you assumed was there

Checked the deployed page for "Get started by editing" and got 0 matches, which
briefly read as a broken render. The page was fine; the Next 16 scaffold's copy
simply differs. The header/CSS/hydration chunks were the real evidence.

**Rule:** when verifying a rendered page, assert on structural markers
(doctype, stylesheet links, hydration chunks) rather than guessed copy.

## Re-survey before editing when other work may be in flight

Mid-session, `schema.ts`, `app-header.tsx`, and several new files
(`profile.ts`, `theme.ts`, `user-avatar.tsx`) had all changed since the
plan-mode read — a profile/avatar/theme feature was being built concurrently
in the same working tree. Editing `app-header.tsx` from the stale read would
have clobbered that work.

**Rule:** before editing a file in a long session, especially one touched by
plan-mode exploration much earlier, re-read it if there's any chance of
concurrent edits (system reminders noting a file "modified by the user" are
the tell). Cheap insurance against expensive collisions.

## A generated config file can leak scope into an unrelated tsconfig

`wrangler types` emitted `cloudflare-env.d.ts` at the repo root with a
`typeof import(...)` reference to the Workers-only entry point. Because it
matched the main tsconfig's broad `**/*.ts` include glob, it pulled
Workers-runtime code (and its unresolvable `open-next/worker` import) into
the Next app's typecheck — despite that code's own directory being correctly
excluded.

**Rule:** when a code generator drops a file at the project root, check what
it *references*, not just where it lives — a `.d.ts` two directories away from
an excluded folder can still reach into it via a type-only import and widen
what "excluded" actually excludes.

## Read the warnings *after* a successful deploy, not just the error path

Adding `routes` to `wrangler.jsonc` silently flipped two unrelated defaults
off: `workers_dev` (so the old `*.workers.dev` URL began 404ing immediately)
and `preview_urls` (which would have broken per-branch preview deploys later,
at a moment with no obvious connection to this change). Both were disclosed
only in warnings printed *below* the "Deployed / Current Version ID" success
lines, where a skim stops.

**Rule:** on any deploy that changed configuration, read to the very bottom of
the output. Success lines are not the end of the message, and Cloudflare's
"because X is not in your config, it will be disabled by default" notices are
the kind that surface as a mystery bug weeks later.

## Retry a just-provisioned cloud service once before diagnosing it

`wrangler email sending send` failed with
`email.sending.error.email.sending_disabled [code: 10203]` about 30 seconds
after `wrangler email sending enable` reported success — and succeeded on a
plain retry with nothing changed. The domain was onboarded; the account-level
quota simply had not propagated. Worse, `wrangler email sending dns get`
happily listed all the DNS records throughout, which reads as "ready."

**Rule:** the same lesson as the post-deploy 404 above, generalized — when a
resource was provisioned seconds ago, retry once before believing an error.
And prefer a state endpoint over an output listing when checking readiness:
`GET /accounts/{id}/email/sending/limits` returning a real quota rather than
`null` was the honest signal.

## A shared module must have zero DOM-only bindings anywhere in the file

`src/server/sync/apply-patch.ts` (Workers code) imported only `compareHlc`
from `src/lib/sync/hlc.ts`, but `tsc -p tsconfig.worker.json` still failed on
`localStorage`, which lived in a *different* function in that same file
(`getNodeId`). `tsc` type-checks a whole imported file under the importing
project's `lib` config, not just the specific bindings actually used — so one
DOM-only reference anywhere in a module poisons it for every importer with a
DOM-less `lib`.

**Rule:** before sharing a "pure" module between client and Workers code,
grep the whole file for globals the Workers `lib` config won't have
(`localStorage`, `window`, `document`, etc.), not just the exports the new
importer needs. If any exist, split the file — pure logic in one module,
environment-touching accessors in a sibling that re-exports the pure module's
surface, same pattern as `hlc-core.ts` / `hlc.ts` here.

## `wrangler deploy --dry-run` catches what `tsc` and `next build` can't

Neither `npm run build` nor `build:static` actually bundles the Workers
entry (`src/server/worker.ts`) through wrangler's esbuild — they're pure
Next builds and never touch `drizzle-orm/durable-sqlite`-style
Workers-runtime imports. `tsc -p tsconfig.worker.json` only checks *types*,
not whether the bundler can actually resolve everything. A `--dry-run` deploy
doesn't publish or touch live infra, so it's safe to run any time, and it's
the only step in this repo's verification list that actually proves a new
`src/server` module bundles.

**Rule:** after any change under `src/server` that adds a new import (not
just edits existing ones), run `npx wrangler deploy --dry-run` once before
calling the change verified — it's free and it's the only check that exercises
the real bundler.

## A production-only guard that local dev can't satisfy is a deadlock

`requireEmailVerification` was written as a hardcoded `true`. Production was
fine — real mail delivers. Local `wrangler dev` was not: the `send_email`
binding doesn't actually send without `"remote": true`, so a local signup
created an unverified user, sign-in returned a bare **403**, and there was no
way to reach the verification link to escape. The only visible symptom was
`POST /api/auth/sign-in/email 403` — nothing naming email or verification.

Two compounding mistakes. The flag was a module constant when everything
around it (`baseURL`, one line below) already branched on `env.NEXTJS_ENV`.
And `sendEmail` swallowed exactly one error code (`E_SENDER_NOT_VERIFIED`)
while rethrowing every other, so the local binding's failure mode wasn't
covered by the fallback that existed precisely for "can't send right now".

**Rule:** when adding a guard that depends on an external service succeeding,
ask what happens in an environment where that service is stubbed or absent. If
the answer is "the user is stuck with no recovery path", derive the guard from
the environment rather than hardcoding it — and make the service wrapper
degrade in dev instead of throwing. Neighbouring code already branching on
environment is a strong hint the new flag should too.

## "Sortable" isn't one order — verify the direction with a test, not a comment

Three places in this repo (`mutate.ts`'s doc comment, `docs/SYNC.md`,
`.ai/todo.md`'s own P3 review) asserted that legacy `new Date().toISOString()`
outbox stamps "sort before any real HLC" and are therefore harmless. They
sort *after* — `"2026-…"[0]` is `'2'` (0x32), a real HLC's leading hex digit
is `'0'` (0x30) at any epoch before the year 10889, and the merge's
`compareHlc` is plain string comparison. So a legacy stamp wins every
last-writer-wins comparison it's ever compared in, forever, and the claim
that this was "harmless because nothing has drained the outbox yet" was true
only by accident — `adopt-owner.ts` was still producing new legacy stamps on
every first sign-in, so the first real drain would have poisoned an account's
server-side field clocks permanently and unrepairably.

Both the fixed-width-hex HLC encoding and an ISO-8601 string are individually
"lexicographically sortable" — that property says nothing about whether they
sort *against each other* in the direction someone assumed. Nobody had run
`"2026-..." < "019f..."` in a REPL; the comment was written from intuition
("newer-looking things sort... after? before?") and then copied into two more
files without being re-derived.

**Rule:** a claim about lexicographic (or any) ordering between two encodings
is a one-line, ten-second thing to verify in a REPL or a test — do it before
writing the comment, and encode the verified direction as a regression test
(`hlc.test.ts`'s `compareHlc(iso, realHlc) > 0` case here), not just prose.
Prose drifts silently across copies; a red test doesn't.

## A sentinel's "always loses" needs the comparison to implement it, not just a favorable sort position

Same session as the lesson above, different failure shape — worth keeping
separate because the fix for one would not have caught the other.

I added `FLOOR_HLC`, a sentinel clock for server-synthesized placeholder
values, documented as sorting below every real HLC — verified true, this
time, unlike the ISO-stamp mistake above. But `mergeRecord`'s comparison was
`localHlc === null || compareHlc(remote.hlc, localHlc) > 0` — an early-exit
short-circuit that, when there's no pending local entry for a field, applies
the remote value *without ever calling `compareHlc` at all*. `FLOOR_HLC`'s
correct sort position was never consulted, because the code path that was
supposed to consult it doesn't run when the left-hand side of `||` is
already true. A live two-browser test caught it within a session: signing in
on a second device renamed every list to "Untitled" and then, via an
unrelated hard-delete elsewhere, deleted half of them.

The general shape: **a sentinel value's safety property ("this always
loses", "this is always caught", "this always wins") is a claim about a
comparison *function's output*, not about the value in isolation.** Proving
the value sorts correctly in a standalone check (what I actually did for
`FLOOR_HLC`, and what would have caught the ISO-stamp bug too) is necessary
but not sufficient — it doesn't prove every call site that's supposed to
compare against it actually reaches the comparison. A short-circuit,
an early return, a cached/memoized branch, a `??` fallback: any of these can
route around the comparison entirely for exactly the input the sentinel
depends on, and a sort-order check alone can't see that.

**Rule:** when introducing a sentinel with a documented ordering guarantee,
write the regression test at the level of the function that's supposed to
enforce it (`mergeRecord`, not `compareHlc`), with the exact adversarial
setup the guarantee needs to survive — here, "local already holds a real
value, no pending entry, remote is the sentinel." Trace every early-exit
branch between the caller and the comparison and ask whether the sentinel
can reach each one. `merge.test.ts` had eleven tests and zero of them
constructed this state, because all eleven predated the sentinel that made
it dangerous — a sentinel added later needs its own pass through the
existing decision tree, not just its own new test file.

---

## A protocol that bypasses CORS bypasses every guard you built on CORS

Adding `/api/sync/ws` next to the existing `/api/sync/push` and
`/api/sync/pull` looked like adding a fourth branch to a router that already
had auth handled: the session check runs before the branch, so the upgrade
inherits it, and `corsHeaders` was already there for cross-origin.

That reasoning is wrong in a way that is invisible from the code. **A
WebSocket handshake is not subject to CORS at all.** The browser sends it
with cookies attached and no preflight, and `Access-Control-Allow-Origin`
does not gate whether the connection is established — it isn't consulted.
On `/api/sync/push` the `Origin` check is effectively decoration, because
CORS already stops a cross-site `fetch` from reading the response. On
`/api/sync/ws` the identical-looking code is the *only* thing between
evil.com and a signed-in user's entire board: any page could have opened a
socket to the DO and pushed and pulled at will.

Nothing in the repo did this job already, precisely *because* every prior
sync request went through `fetch`. The guard didn't exist because it had
never needed to.

The second half of the lesson is what "correct" turned out to mean. The
obvious implementation — reject anything not on `TRUSTED_ORIGINS` — would
have shipped and then silently failed on every branch preview, because
previews live at `*-faite.bfmw-dev.workers.dev` and are deliberately absent
from that list (`createAuth` derives `baseURL` from the request origin
instead). HTTP sync would keep working while the socket 403'd, which reads
as "hibernation is broken", not "the origin check is too strict" — a bug you
would chase in entirely the wrong file. The check has to accept
**same-origin OR the allow-list**.

**Rule:** when adding a protocol alongside an existing one, do not assume the
guards on the existing one apply. Ask specifically which of them are enforced
by the *browser* rather than by your code — CORS, SameSite, preflight,
mixed-content — and check whether the new protocol is subject to each. Then
check the new guard against every deployment target you actually have
(production, branch preview, localhost, `next dev`), not just the one in
front of you.

---

## "It works" and "it works after the platform reclaims it" are different tests

The riskiest thing in the WebSocket work was never the message handling — it
was whether a socket still functions after the Durable Object hibernates,
because on wake the constructor re-runs and every in-memory field is gone.
Only `serializeAttachment` survives, and `userId` lives there.

The natural test is "open two tabs, edit in one, watch the other". It passes
in about a second and proves the broadcast path. It proves **nothing** about
hibernation, because idle eviction is a **70–140 second window** — the object
was never reclaimed, so the constructor never re-ran, so the attachment was
never actually deserialized from anywhere. A test that completes in 1s
structurally cannot observe a 70s state transition.

What works: idle >150s untouched, then push. `owner_id` on that insert can
only have come from `deserializeAttachment()`. It takes three minutes of
wall-clock and is the only test in the repo that can see this contract break.

The same shape applies to anything with a platform-managed lifecycle —
hibernation, eviction, cold starts, connection pool recycling, token refresh,
cache TTLs. The dangerous window is always the one longer than your test.

**Rule:** when a platform reclaims something on a timer, look up the actual
timer and make the test outlast it, even if that makes the test slow. Write
the wait down in the test itself with the number and its source, so nobody
"optimizes" it back to 5 seconds. And assert on something that could *only*
have come through the restored state — not merely that the call succeeded.

---

## Two smaller ones, both from the same session

**A query whose `?` count comes from an array length is a latent limit bug.**
`readFieldClocksBulk` built one `IN (?, …)` over the union of six kinds'
pages — up to 600 bound parameters against SQLite's documented ceiling of
100. It had never fired because the account is small, and it would have
fired first on a `since=0` catch-up pull: the largest, least recoverable
request the system makes, and the one the reconnect path depends on. Grep for
`.map(() => "?")` after any change to how rows are batched.

**curl writes httpOnly cookies with a literal `#HttpOnly_` prefix** on the
domain field of its cookie jar. Filtering out lines starting with `#` — the
obvious way to skip comments — drops exactly the session cookie you need, and
every request then 401s. Fifteen minutes lost to what looked like an auth
bug in the code under test rather than a parsing bug in the test harness.
When a brand-new harness fails its very first auth check, suspect the harness
before the server.
