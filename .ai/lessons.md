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

---

## A comment claimed a behaviour that was never implemented

`TRUSTED_ORIGINS` in `src/server/auth.ts` was documented as "also the CORS
allow-list for `/api/sync/*`" — one list "so it can't drift between the two
seams". Only one seam ever used it. `/api/sync/*` built its own
`corsHeaders`/`handleOptions`; `/api/auth/*` handed the request straight to
Better Auth and got nothing, because **`trustedOrigins` is a CSRF and
redirect-target check that emits no CORS headers at all**. So the documented
two-terminal local workflow (`next dev` on :3000 against `npm run preview` on
:8787) could never log in: the preflight 404'd and the browser reported
`TypeError: Failed to fetch` from the `signIn.email` call, pointing at the
login page rather than at the server that refused it.

Two things went wrong and they compound:

The comment described an *intention* — the shared list — as though it were the
mechanism. Nothing enforced it. A second seam was added later and simply did
not opt in, and the comment kept asserting the invariant held. **If a comment
says two call sites share something, the shared thing has to be the code they
both call, not a constant they both could.**

And the symptom surfaced three layers from the cause. `Failed to fetch` is what
a browser says when it declines to send a request; curl on the same endpoint
returned a healthy 401, because curl does not do CORS. **When a request fails
in the browser but succeeds from curl, the difference IS the finding — stop
reading application code and go read the preflight.**

**Rule:** verify a cross-origin path with a real `OPTIONS` carrying `Origin`
and `Access-Control-Request-Method`, not just the `POST`. A 404 on the
preflight is invisible to every server-side test in the repo.

---

## Swapping a dnd-kit sensor silently renames the listener map

Splitting `PointerSensor` into `MouseSensor` + `TouchSensor` (so touch could
long-press instead of relying on `touch-action: none`) changed what
`useSortable()` puts in `listeners`. The map has one entry per bound sensor
activator: `PointerSensor` gives `onPointerDown`, `MouseSensor` gives
`onMouseDown`, `TouchSensor` gives `onTouchStart`.

`todo-card.tsx` and `board-column.tsx` both destructure that map and both cast
it, because dnd-kit types the values as bare `Function` and a `Function` cannot
be assigned to a typed handler prop. The cast asserts the shape rather than
checking it — so `onPointerDown` kept type-checking after the swap, resolved to
`undefined`, and React accepted `onMouseDown={undefined}` without complaint. The
whole-row and whole-header drag would have been dead on arrival, with a green
typecheck and a green test suite, since neither behaviour is unit-testable
without layout.

**Rule:** when changing which sensors a `DndContext` binds, grep the codebase for
every activator name in the same edit. Any `as {...}` over a library's loosely
typed object is a place where a rename cannot fail loudly — treat the cast site
as the thing to re-verify, not the call site.

Adjacent, same shape: `opacity-0` does not remove an element from hit testing.
Moving the card grip out of the flow and hiding it meant its 24×24 `::before`
hit area now sat over the checkbox, invisible and click-eating. Anything hidden
by opacity alone still needs its pointer geometry reasoned about.

---

## tailwind-merge does not know a shorthand conflicts with its per-axis form

`DragGrip` set its 24×24 hit area with `before:-inset-1.5`. Moving the card's grip
out of the flow meant that expansion now covered the checkbox, so `todo-card.tsx`
passed `before:-inset-y-1.5 before:inset-x-0` to keep it vertical-only.

`cn()` merged nothing. tailwind-merge treats `-inset-1.5` and `-inset-x-*` /
`-inset-y-*` as different groups, so **both** survived into the class list, and
which one applied came down to the order Tailwind happened to emit them in. The
failure is invisible twice over: the box is transparent, and the wrong outcome is
just "clicking the grip toggles done sometimes".

Two lessons:

**When overriding a utility from a shared component, check the base uses the same
granularity you are overriding at.** A shorthand in the base cannot be narrowed by
a caller. The fix was in the base — state it per axis (`-inset-x-1.5 -inset-y-1.5`)
so a caller can override one axis and tailwind-merge can actually see the conflict.

**A class-list assertion is a real test when the CSS is load bearing and invisible.**
This one was written as a guard against a future "tidy-up" and it caught the bug it
was written for, on the first run, before any browser did.

**Rule:** assert `not.toContain` on the class you believe you replaced, not just
`toContain` on the replacement. `toContain` alone passes happily while both are
present, which is exactly the broken state.

---

## A `NEXT_PUBLIC_*` in `.env.local` ships to production

`.env.local` carried `NEXT_PUBLIC_AUTH_URL=http://localhost:8787` so `next dev`
(:3000) could sign in against a separately-running preview worker (:8787). That is
a correct dev setup and a production outage: **Next loads `.env.local` in every
environment, and inlines `NEXT_PUBLIC_*` into the client bundle at BUILD time.** So
`npm run deploy` shipped a login page that posted to `http://localhost:8787`, and
sign-in on https://myfaite.app died on a CORS preflight.

Three things worth carrying forward:

**The error blamed the wrong layer.** The console said
`Access-Control-Allow-Origin: 'http://localhost:8787'` is not equal to the supplied
origin — which reads as a server CORS misconfiguration, and sent me looking at
`src/server/cors.ts` and `TRUSTED_ORIGINS` first. The actual bug was a build-time
string substitution in a client chunk, and the responder was the developer's own
local worker. **When a deployed page requests localhost, no amount of server
configuration is the answer; the artefact is wrong.** The tell is in the bundle:
`grep -rl "localhost" .open-next/assets/_next/static/chunks/` named the exact file
the console had already cited.

**`.env.production` cannot fix it.** Next's precedence is
`process.env` > `.env.$(NODE_ENV).local` > `.env.local` > `.env.$(NODE_ENV)` > `.env`,
so `.env.local` outranks `.env.production`. A per-environment file cannot override a
per-machine one. Environment-specific *values* have to go where only that
environment reads them.

**Rule:** a `NEXT_PUBLIC_*` override that is correct for exactly one command belongs
in that command, not in a dotenv file. `NEXT_PUBLIC_AUTH_URL` now lives in the `dev`
script in `package.json` — the same place `NEXT_PUBLIC_AGENTATION=1` already lived,
which was the convention to follow all along. A dotenv file is machine scope; a
script is command scope; build-time inlining means only command scope is safe.

**And back the convention with a mechanism.** `resolveAuthBaseURL()` now discards a
localhost target when the page is served from a real domain, turning the next leak
into a console warning instead of a login outage. Conventions are one edit away from
being broken; the guard is what makes the convention safe to get wrong.

## Playwright key presses need pacing when the app processes them via rAF/React state

Writing `e2e/keyboard-drag.spec.ts` (EI-74), `page.keyboard.press("Space")` then
immediately `press("ArrowUp")` then immediately `press("Space")` looked
reasonable and passed sometimes — 25-75% first-try failure depending on the
run, "fixed" by adding `retries: 2` at first. That was about to ship a test
that only worked because of a retry crutch disguising real flakiness.

The actual bug: dnd-kit's `KeyboardSensor` processes a lift/move/drop through
React state updates and `requestAnimationFrame`, not synchronously. Consecutive
`.press()` calls fire back-to-back with no native browser event to await
between them, so the second key press can land before the first one's state
update has flushed — the drag silently no-ops and order stays unchanged.

**Rule:** when driving a library that commits interaction state via
React/rAF rather than a synchronous DOM write, put an explicit
`waitForTimeout` (150-300ms was enough here) between each logical step of the
interaction — not just after the initial `.focus()`. If a Playwright
interaction is flaky, look for a missing settle-wait between steps before
reaching for `test.describe.configure({ retries })`; retries can mask a race
that a 200ms wait actually fixes, and 24/24 passes across 6 repeats with zero
retries is a much stronger signal than "eventually green with 2 retries."

## Bare substring matching against a name list eats ordinary words

`matchPresetTime` (quick-add.ts, EI-106 P4) matched a trailing word against
reminder preset names with `name.includes(word)`. Looked reasonable, passed
its own tests (which only tried genuine prefixes like "morn"), and shipped —
then a code-review pass against the REAL seeded default names ("Morning",
"Afternoon", "Lunchtime", "Evening", "End of day") found that "on" matches
inside "Afternoon", "mo" inside "Morning", "it" inside "Lunchtime". Typing
"note on" silently became the title "note" plus an unrequested 3pm reminder
— no ambiguity to catch it, since exactly one preset happened to contain
each substring.

**Rule:** when matching free-typed words against a small vocabulary (preset
names, tags, commands) for anything that SILENTLY REWRITES what the user
typed, never use a bare substring/`includes` check — require the word to
equal or prefix one of the target's own whitespace-separated words, and set
a minimum length (3 chars caught "on"/"mo"/"it"/"at"/"in" for free). Bare
substring matching is fine when the result is a SUGGESTION the user picks
from a list (a dropdown, an autocomplete) — there the user sees and can
reject a bad match. It is not fine when the match is applied automatically
with no further confirmation. Test against the real production data (the
actual seeded/shipped values), not just hand-picked examples that happen to
be clean prefixes.

## React's set-state-in-effect lint catches a real anti-pattern, not just a style nit

Wrote `useEffect(() => setNameDraft(preset.name), [preset.name])` to resync
a local text-input draft when the underlying store value changed externally
(another device, undo). Compiles, passes tests, `npm run lint` failed it:
"Calling setState synchronously within an effect can trigger cascading
renders." The failure mode this catches is real, not cosmetic — an effect
runs AFTER paint, so the stale draft value renders for one frame before the
effect fires and corrects it, and if the effect's own setState triggers
something else's effect, they cascade.

**Rule:** for "adjust local state when a prop changes," use React's
documented render-time pattern instead of an effect: keep a
`lastSeenValue` state alongside the derived one, and if the prop disagrees
with `lastSeenValue`, call both setters unconditionally during render (not
inside a callback or effect) —
```ts
const [draft, setDraft] = useState(prop);
const [lastSeen, setLastSeen] = useState(prop);
if (prop !== lastSeen) { setLastSeen(prop); setDraft(prop); }
```
React detects the render-time setState, discards the in-progress render,
and re-renders immediately with the corrected value before ever painting —
no stale frame, no cascade. Reach for this whenever the urge is "sync local
draft state to an external value that can change out from under it."

## A relative `/api/*` path is a silent 404 under `next dev`

EI-83's Places transport used bare relative paths (`fetch("/api/places/autocomplete")`),
copying `src/lib/sync/transport.ts`. Correct in production and under
`npm run preview`, where the Worker serves the page and the API from one
origin. Under `next dev` (:3000) there is **no Worker at all** — every
`/api/*` falls through to Next's 404 handler.

**The symptom pointed away from the cause, twice.** The transport maps 404 to
`PlacesUnavailableError`, and `usePlaceSearch` latches on it (deliberately: a
missing route is permanent, and retrying spends money on a billable proxy). So
the address field in Settings fired *nothing at all* in the network tab — one
doomed request on first keystroke, then silence forever. That reads as a dead
hook or a broken debounce. Only a freshly-mounted component (opening a todo
sheet) showed the single 404 that explained both.

**The fix already existed and I didn't look for it.** `/api/auth/*` has worked
from `next dev` since P2, via `NEXT_PUBLIC_AUTH_URL` in the `dev` script and
`resolveAuthBaseURL()`. I had read that function — it is three lines above the
`.env.local` postmortem in this same file — and still wrote a transport that
couldn't reach the backend, then *documented the limitation* ("smoke-test under
`preview` only") instead of treating it as one. Documenting a papercut is how
it becomes permanent.

**Rule:** any new client→Worker transport routes through `apiUrl()`
(`src/lib/api-origin.ts`), never a bare relative path. Same-origin deployments
get the bare path back, so the common case is unchanged.

**And when two seams need the same decision, move it — don't copy it.** The
localhost guard inside that resolver is itself a postmortem (see the
`.env.local` lesson above). A second copy would have been a second thing to
forget to fix. `auth-client.ts` now re-exports it from `api-origin.ts` so its
existing test keeps pinning one implementation.

**Corollary worth stating out loud:** "it 404s in dev, that's expected" is a
claim to verify, not assume. `curl -i` against the worker separates *route
missing* (404) from *route present, caller unauthenticated* (401) from *route
present, unconfigured* (501) in one command — and that distinction is exactly
what the latch hides in the UI.

---

## More parallelism starved the thing under test (EI-187, 2026-08-18)

`playwright.config.ts` had `workers: process.env.CI ? 2 : undefined` with a
comment justifying the cap. `ubuntu-latest` has 4 vCPUs, so 2 looked like
half the machine sitting idle, and the issue itself suggested measuring 3
and 4. I went to 4. **The first CI run failed 21 of 89 tests.**

Not flakiness — all 24 `overdrive` tests failed, on the first attempt and on
the retry. The trace screenshot showed the seed button still reading
"Seeding…" when the assertion gave up.

**The runner does not only run test workers.** It also runs the `next dev`
server that every worker navigates against, and in dev that server compiles
routes on demand. A worker per core leaves nothing for it. Two things broke
at once: cold `/board` compiles took 7.9s because four workers hit an
uncompiled route simultaneously, and `dev-seed.ts`'s ten *sequential*
`await createTodo()` IndexedDB writes stopped fitting inside `expect`'s 5s
default. 3 workers, leaving the server a core, is green and stable.

**Rule:** when sizing test parallelism, count the processes under test, not
just the test processes. A shared dev server, database, or emulator is a
consumer of the same cores and gets no worker slot of its own.

**Two things this surfaced that were worth more than the worker number:**

- **`webServer.url` is a free warm-up and I had been ignoring it.**
  Playwright polls that URL until it answers and only *then* starts the run.
  Whatever route it names gets compiled during startup, on an idle runner,
  outside every test's timeout. It pointed at `/`, so it warmed the
  marketing page and left `/board` — the route *every* test loads — to be
  compiled by whichever tests reached it first, concurrently, out of their
  own 30s budgets. Point it at the route the suite actually uses.

- **A timeout should be sized by what it is waiting for.** The failing
  assertion was `expect(toast).toBeVisible()` on `expect`'s 5s default. That
  default is calibrated for a *render*. This was waiting for ten sequential
  IndexedDB transactions, each re-running the board's live queries — seconds
  of real work, correctly. "The default timeout" is not a neutral choice; it
  is an assertion that the thing being awaited is cheap.

**And the general one:** the failing run taught me more than the green one
would have. I had a local green run at 4 workers and could have shipped on
it — it only passed because the dev server was already warm and the machine
had 10 cores. Local green on a fast machine is not evidence about a
4-vCPU runner with a cold cache. Push it at real CI before believing it.

**Corollary — test the paths that only run when things go wrong.** The
`e2e-report` job that merges sharded reports is `if: failure()`, so no green
run ever executes it, and it is needed exactly when someone is debugging a
red one. I broke a test on purpose to prove it worked, then force-pushed the
break away. Untested-by-construction paths ship broken and are discovered at
the worst possible moment.

*(That job no longer exists — un-sharding retired it a day later, see the
cost lesson below. The corollary is the durable part: the report upload it
became is still `if: failure()`, and still wants proving the same way.)*

---

## Wall clock and billed minutes are different currencies (EI-187 follow-up, 2026-08-18)

I optimised CI for wall clock, reported it as a cost win, and was wrong.
Sharding the e2e job three ways took it from ~10 min to ~4m30 — and took
billed runner-minutes *up*, 15 → 19 per run, because each shard pays the
fixed ~140s of container pull + `npm ci` + dev-server boot all over again.
On a private repo those minutes are metered. I had even written "~30% more
runner-minutes" in the workflow comment, then summarised it to Rob as
"~60% cheaper per run". The comment was right and the summary was wrong.

**Rule:** when reporting a CI improvement, say which currency. Wall clock is
what a person waits for; billed minutes are what an allowance pays for.
Parallelism almost always trades one for the other, and which one matters is
a product decision, not a technical one — ask.

**What the numbers actually were, and the lever that mattered.** Of 960
billed minutes across 40 runs, **360 were a single hung `apt` step** that ran
to GitHub's 6-hour default on a *docs-only* commit. Not the suite. Not the
sharding. One stall, 18% of a month. The fixes that paid were the boring
ones — `timeout-minutes` so nothing can run to the 6-hour default, a
container with no `apt` step to hang, `paths-ignore` so prose doesn't boot a
browser, and not re-running e2e on `main` for a tree the PR already tested.

**And the multiplier is iteration count, not merges.** Landing EI-187 itself
cost ~125 billed minutes across eight pushes — 6% of the monthly allowance
for one feature. Per-*merge* arithmetic hides that completely. Cost-model a
change against how many times a branch gets pushed, not how many times it
gets merged.

---

## A migration ledger can be empty while every table it creates already exists

Shipping EI-186 meant one new D1 table, so the deploy was
`npm run deploy:with-migrations` — the command the ticket, the PR, and
`docs/SETUP.md` all name. Before running it I asked wrangler what it was about
to do:

```
$ npx wrangler d1 migrations list AUTH_DB --remote
Migrations to be applied:
  0000_amused_ink.sql
  0001_fast_venom.sql
  0002_puzzling_cerebro.sql
```

It wanted to apply **all three**, including the one that creates `user`,
`session`, `account`, and `verification` — tables production had been serving
auth from for weeks. `d1_migrations` was empty: the original schema had been
put there by some other route (`better-auth migrate`, or a hand-run
`d1 execute`), which creates the tables and writes no ledger row.

`0000`'s `CREATE TABLE` statements are unguarded — no `IF NOT EXISTS`, because
drizzle-kit assumes it owns the database. So `deploy:with-migrations` would
have aborted on the first statement, and `email_ingest` — the only migration
that actually needed to run — would never have been created. The command
documented as the safe deploy path was the one that could not work.

Three things this shook out, in ascending order of how long they would have
taken to find:

**Workers Builds deploys on merge; it does not run migrations.** Between
merging the PR and my first `curl`, production was already serving the new code
against a database with no `email_ingest`. `/api/email/address` went 404 → 401
in the ninety seconds I spent reading the ledger. Nothing was user-visible only
because the zone routing wasn't configured yet and one settings panel was the
whole blast radius. **The window between "merge" and "migrate" is real and it
is not yours to schedule** — if CI auto-deploys, the migration is not a step
after the merge, it is a prerequisite to it.

**`0001` had never been applied at all.** It creates `apikey`, and
`apiTokenPlugin` has been live in `auth.ts` the whole time — so every API-key
endpoint in production had been answering off a table that did not exist.
Latent, because nothing ships against them yet. It surfaced only because the
ledger forced a full accounting; no test, no monitor, and no amount of "auth
works fine" would ever have shown it.

**Tables existing is not evidence the migration ran.** Before backfilling
`0000` as applied I diffed prod's actual `sqlite_master` against what `0000`
generates — normalising whitespace, backticks, and comments — and confirmed all
nine objects matched byte-for-byte. That check is the entire difference between
recording a true fact and papering over real drift. Had one column differed,
the honest ledger row would have been a lie and the next migration would have
failed somewhere much less obvious.

**Rule:** never run `migrations apply` against a remote database without first
running `migrations list` and reading what it intends to do — the answer
"everything, from scratch" is common on any database whose schema was
bootstrapped by a different tool than the one now managing it. Before marking
an already-applied migration as applied, **diff the live schema against what
that migration generates** rather than trusting that matching table *names*
mean matching tables. And take a `time-travel info` bookmark first: it costs
one command and is the only thing standing between you and a production auth
database you cannot put back.

---

## I described a third-party config model three times without ever testing it

Finishing EI-186 meant one Cloudflare Email Routing setting. I got its shape
wrong three times running, and each wrong version was more confident and more
expensive than the last:

1. **From a screenshot:** "the catch-all is on the apex, so mail to the
   subdomain matches nothing and the Worker is never invoked." Asserted from a
   cropped rules list that did not show a domain column.
2. **From the API:** confirmed the only catch-all object was tagged
   `zone: myfaite.app`, and concluded the subdomain therefore had none. Then
   **wrote that into `docs/SETUP.md` §3b** as a numbered runbook telling the
   next person to enable a subdomain catch-all and disable the apex one.
3. **From the OpenAPI spec:** noticed `/rules/catch_all` has no subdomain
   parameter, which should have been the tell, and *still* only softened the
   claim rather than testing it.

One email settled it in forty seconds:

```
to:zzztest@in.myfaite.app → {"decision":"unknown-address","addressHash":"…"}
```

There is exactly **one catch-all per zone** and it covers the apex and every
enabled subdomain. The original configuration had been correct the whole time.
My "fix" instructions would have had the user disable the only rule making the
feature work — and in fact they did disable it, mid-diagnosis, on my advice.

Two things went wrong, and the second is the one that matters.

**The evidence was ambiguous and I read it as confirming.** A single catch-all
object tagged with the apex zone is equally consistent with "the subdomain has
none" and "there is only ever one and it covers everything." I picked the first
because it fit the story I already had. The spec detail in (3) — no subdomain
parameter *anywhere* — actively favoured the second reading, and I noted it
without letting it move me.

**I wrote an unverified inference into a runbook.** A hedge in chat costs a
follow-up message. The same hedge committed to `docs/SETUP.md` becomes the
thing the next person follows at 2am, and it survives long after the
conversation that produced it. Docs are where a guess stops being cheap.

**Rule:** for third-party infrastructure, a config model is a *hypothesis*
until an observation distinguishes it from its alternatives — dashboards and
even API reads show you *state*, not *semantics*. Before writing one into
docs, ask "what would I see if the opposite were true?" and go make that
observation. Here it was one email and a `wrangler tail`. And when a spec
lacks the parameter your theory requires, treat that absence as evidence
against the theory, not as an inconvenience to route around.

**Corollary:** when a diagnosis says "the thing you configured is wrong",
weigh that it has been working-as-configured for someone who had no reason to
set it up backwards. Ask for the cheap confirming test *before* recommending
they change production, not after.

## A green test suite can be blind rather than right (EI-196 / EI-197)

Two bugs shipped behind eleven passing assertions, and the pattern is the same
in both: the test could not physically observe the thing it claimed to cover.

1. **`TooltipTrigger render={<Checkbox/>}`** — composing two Base UI
   `useRender` components drops the trigger's pointer handlers. Type-checks,
   renders, keeps every prop, never opens. happy-dom cannot open a Base UI
   tooltip at all, so the component tests were asserting the trigger's
   *props* and calling it coverage.
2. **`handleToggle` hardcoded to `"done"`** — a Complete handler named Toggle.
   Invisible for months because it was unreachable: completing a to-do removed
   it from the board, so there was no done checkbox left to click. A feature
   that made it reachable (the completed view) is what exposed it.

**Two habits that came out of this:**

- **Write the CONTROL case first.** When a probe reported "the tooltip did not
  open", that was ambiguous between a broken app and a harness that cannot
  open any tooltip. It was the harness — Playwright's `locator.hover()` cannot
  open a Base UI tooltip either. Hovering a *known-good* tooltip in the same
  run is what turned a dead end into a diagnosis. Without it I would have
  "fixed" the app against a blind test.
- **Prove the old code fails before trusting the new code's test.** Reverting
  just the changed lines and re-running is cheap, and it is the only thing
  that distinguishes a regression test from a test that happens to pass.

Both are the specific form of `docs/DRAG-AND-DROP.md` §8's caution: say what
was and was not *exercised*, not what passed.

## A Zod field with `.default()` fires on ANY absent key, not just `.parse({})`

Bit three times now, in three different files, always the same shape: build a
schema meant to validate a PARTIAL patch, and Zod invisibly turns "you didn't
mention this field" into "set it to its schema default" — under `.partial()`,
under `.pick()` on a narrower set of keys, whenever the missing key is still
declared with `.default(...)` anywhere in what gets parsed.

- `v1/validate.ts`'s `parseUpdateTodoRequest` — a static `.pick(ALL).partial()`
  expanded `{status: "done"}` into a full-record overwrite (A5, caught
  pre-merge by its own tests).
- `lib/service/todos.ts`'s `buildUpdateTodoEntry` — same shape, independently
  guarded with the identical dynamic-mask fix, in the same ticket.
- `mcp/routes.ts`'s `settingsOrDefault` (the A6 MCP-tools follow-up) —
  `settingsSchema.parse({ownerId})` threw on `updatedAt` instead of silently
  clobbering, only because `updatedAt` happens to be one of the two fields in
  that schema with NO `.default()`. One field away from reproducing A5's bug
  a third time, caught live by a real MCP-client smoke test, not a unit test.

**Rule:** never validate a partial/patch object against a schema built by
`.pick(SOME_FIELDS).partial()` or `.parse({subset})` if ANY field in that
schema carries `.default(...)`. Build the `.pick()` mask FROM the keys
actually present in the input every time —
`Object.fromEntries(Object.keys(input).filter(...).map(...))` — never from a
static, pre-declared field list. Test it by asserting a single-field patch
leaves a second field untouched, not just that valid data round-trips.

**Corollary:** a broad, table-driven test (`e2e/marketing-pages.spec.ts`,
looping every `SITE_PAGES` entry) caught a duplicate-`<h1>` bug the same
session that no unit test would have — a new page's own heading collided
with one a third-party component (Scalar) rendered internally. When you can,
prefer one generic test iterating real data over a hand-written test per
case; it catches integration shape you didn't think to assert.

---

## A defensive header can silently break the feature it protects (EI-242)

Attachment downloads were sent with a blanket
`Content-Disposition: attachment` plus `X-Content-Type-Options: nosniff`.
Both are the textbook answer to "we are serving user-uploaded bytes from our
own origin", and both were wrong to apply uniformly.

**Chrome will not paint an `attachment`-dispositioned response in an `<img>`.**
The request succeeds. The status is 200. The bytes arrive, the right length,
the right `Content-Type`. `img.complete` is `true`. And `naturalWidth` is
`0` — every thumbnail a blank box, with nothing anywhere saying so.

Nothing in the repo could have caught it:

- Unit tests asserted the header string, which was exactly as intended.
- The e2e harness serves Next with no Worker, so it cannot upload at all.
- The network tab shows a clean 200.

It was found by opening the sheet in a real browser against `npm run preview`
and reading `naturalWidth` off the rendered element.

**Rule:** for anything whose output is *rendered* rather than returned —
images, embeds, iframes, downloads — a passing request is not a passing
feature. Assert on the rendered result (`naturalWidth`, computed size, a
screenshot), not on the response. "200 with the right headers" and "the user
can see it" are different claims.

**Corollary, and the sharper half.** The fix was to serve verified raster
images `inline`. The first implementation used `mimeType.startsWith("image/")`
— and the regression test written alongside it failed immediately, because
`image/svg+xml` starts with `image/`. SVG is not allow-listed today, so the
prefix check was harmless *now*; it would have become stored XSS the day
anyone widened `ALLOWED_MIME_TYPES`, in a completely unrelated change, with
no reason to look at this function.

A prefix test over a security-relevant set is a landmine with a delay fuse.
Enumerate the safe values explicitly, so widening the allow-list is a
deliberate edit in two places rather than an accident in one — and write the
test for the case that cannot happen yet, because that test is the tripwire
that makes it stay impossible.

---

## Do not write a security claim you have not measured (EI-243)

The PDF preview was built with two layers of containment: a `sandbox`
attribute on the iframe, and `Content-Security-Policy: sandbox` on the
response. Both were commented at length — "renders in an opaque origin", "no
access to cookies, `localStorage`, or anything belonging to `myfaite.app`",
"belt and braces".

Every word of that was reasoned from documentation. None of it was true.

Measured in Chrome:

- **Any `sandbox` attribute on the iframe renders nothing at all.** Tried
  `""`, `allow-scripts`, and `allow-scripts allow-popups`. All three: 200
  response, correct bytes, a broken-file icon, no console error. Chrome's
  built-in PDF viewer refuses a sandboxed frame outright.
- **The response CSP does not contain that viewer either.** With the header
  set and no iframe attribute, `f.contentDocument`, `f.contentWindow.
  localStorage` and `f.contentWindow.location` were all readable from the
  parent. The frame was fully same-origin.

So the feature had a choice between working and contained, and the comments
described a third state that did not exist. Had it shipped, the next person
to touch it would have read "opaque origin" and reasoned from a false
premise — which is worse than no comment, because a wrong invariant gets
built on.

**Rule:** a comment asserting a security property is a claim, and a claim
needs a measurement. Before writing "cannot access X", open a browser and try
to access X. The probe is usually four lines:

```js
try { f.contentWindow.localStorage; 'READABLE — not contained'; }
catch (e) { 'contained (' + e.name + ')'; }
```

**Rule:** when two mechanisms are described as "belt and braces", check they
are actually independent. Here they were not — the header was inert for this
content type, so removing the attribute removed *all* the containment, not
half of it. Redundancy that has never been tested separately is one
mechanism wearing a disguise.

**On isolating it.** The first diagnosis was wrong: the test PDF was
hand-written without an xref table, so "the file is corrupt" was a live
hypothesis competing with "the sandbox blocks it". Generating a real PDF
(`cupsfilter`) killed that variable, and opening the same URL as a TOP-LEVEL
tab — where it rendered perfectly, with the CSP header applied — proved the
header was fine and the iframe attribute was not. Two variables, two
controls, in that order. Changing both at once would have produced a working
preview and no idea why.

**Related:** the EI-242 entry above, where `Content-Disposition: attachment`
silently stopped `<img>` from painting. Same shape, one ticket apart: a
header chosen for defence, breaking rendering, with a 200 response and
nothing in the console. Assume every such header is load-bearing on the
render path until a browser says otherwise.

---

## `npm run verify` is not the CI gate — the OpenAPI drift check lives only in CI

**2026-08-29, PR #65 (GOOD JOB mode).** Added a boolean to `settingsSchema`,
walked the whole `docs/SCHEMA-CHANGES.md` checklist, ran `npm run verify`
green — typecheck ×2, lint, 2145 tests, `build`, `build:static` — plus the
e2e suite on both CI projects. CI's `verify` job still failed, in 3 minutes,
on a step `npm run verify` does not contain: **OpenAPI drift check**.

`openapi/openapi.json` and `openapi/v1.json` are COMMITTED ARTIFACTS
generated from the Zod schemas by `npm run openapi:generate`. Any change to
`settingsSchema` (or `todoSchema`, or any other schema the public API
exposes) makes them stale, and CI diffs them and fails. Nothing local tells
you.

**Rule:** after touching any Zod schema in `src/lib/schema.ts`, run
`npm run openapi:generate` and commit the result. Treat it as an unwritten
eighth row of the SCHEMA-CHANGES table, alongside `schema:generate`.

**Rule, more general:** `npm run verify` is a convenience script, not a
mirror of `.github/workflows/ci.yml`. Before claiming a change is CI-clean,
read the workflow's step list and check for steps the script omits. Here the
`verify` JOB had six steps and the `verify` SCRIPT had five — the names being
identical is exactly what makes this easy to miss.

---

## A Better Auth account can be seeded with plain SQL, because the hash is portable (EI-249)

The manual local-setup dance — sign up through the app, hunt the verification
link out of the `npm run preview` terminal, then
`UPDATE user SET email_verified = 1` — existed because signing up looked like
the only way to produce a valid password hash. It is not.

Better Auth's default scrypt is exported: `hashPassword` from
`better-auth/crypto` returns `"<saltHex>:<hashHex>"`, and that string is
exactly what the running server's `verifyPassword` accepts. So
`scripts/dev-bootstrap.mjs` writes the `user` row and the `credential`
`account` row straight into local D1 with `wrangler d1 execute --local`, and no
server has to be running at any point. Proved end to end: a purely
SQL-seeded account signs in against a live `wrangler dev` with HTTP 200 and a
real session token, and a wrong password still gets 401 — the hash is genuinely
being checked, not bypassed.

Two details that are easy to get wrong. The password lives on
**`account.password`**, not on `user`, keyed by `provider_id = 'credential'`
with `account_id` equal to the user id — there is no password column on `user`
at all. And SQL goes through `--file`, not `--command`: an interpolated hash
and email would otherwise have to survive both the shell and wrangler's own
parsing.

**Rule:** before building a workflow around "sign up through the UI to get a
valid X", check whether the library exports the function that produces X.
Better Auth exports its hashing, its JWT verification, and its session logic;
treating the HTTP endpoint as the only door adds a running server to the
dependency list of things that should not need one.

**Corollary:** a seeding script that needs no server is testable in a fresh
worktree in seconds, which is the whole reason this one is idempotent — re-run
it and it re-verifies the account and rewrites the credential row, so "I forgot
the dev password" stops being a debugging session.

---

## Two `concurrently` scripts that each own a companion process cannot just run side by side (EI-249)

`npm run dev` and `npm run preview` each independently start an
`agentation-mcp` companion via `concurrently -k`. Naively running both at once
— two terminals is fine, that's the documented workflow, but a naive combined
script that just did `concurrently "npm:dev" "npm:preview"` — starts that
companion twice, and the second instance fails to bind its fixed port.

`dev:full` avoids it by not composing the two existing scripts at all: it lists
the three *underlying* commands directly (`agentation`, `opennextjs-cloudflare
preview`, `next dev`) in one `concurrently -k` call, so the shared process runs
once. Verified by checking the port bound exactly once and that no
`EADDRINUSE` appeared in the log.

**Rule:** before composing two scripts that each wrap `concurrently` (or any
supervisor) into a bigger one, check what each one starts as a side effect —
not just its named purpose. The collision is never in the process you're
thinking about; it's in the thing running alongside it that both scripts start
identically.

---

## A module the Worker also compiles cannot touch `window` — even indirectly (EI-147)

`src/lib/desktop/version.ts` was written as the shared client+server module
(the `wire.ts` pattern: one shape, so the two halves cannot drift). It also
held the `fetch` helper, which called `apiUrl()` — and `apiUrl()` reads
`window.location.hostname`.

Nothing failed at runtime. `tsc --noEmit` passed. The second half of
`npm run typecheck` — `tsc -p tsconfig.worker.json` — failed with
`Cannot find name 'window'` pointing at **`src/lib/api-origin.ts`**, a file
that had not been edited and is correct as written. That config compiles
`src/server/**` with `"types": ["@cloudflare/workers-types"]` and `lib:
["esnext"]`, so importing one server-side test into a chain that ends at a DOM
global drags an innocent file into a program that has no DOM.

Fixed by moving the `fetch` to its only caller
(`src/components/desktop/use-desktop-update.ts`) and leaving the shared module
pure — which is what `wire.ts` already does, and the reason it does it.

**Rule:** a module under `src/lib` that `src/server` imports must be pure data
and pure functions. No `window`, no `document`, no `fetch` wrapper, and no
import that reaches one transitively. Put the I/O beside its caller.

**Corollary for reading the error:** when the worker typecheck names a file
your diff never touched, do not start debugging that file. Ask what new import
edge pulled it into that program.

---

## Better Auth's api-key plugin: `defaultExpiresIn` is seconds, `min`/`maxExpiresIn` beside it are days (EI-260)

`auth-tokens.ts` set `keyExpiration.defaultExpiresIn: 1000 * 60 * 60 * 24 * 90`
— 90 days *in milliseconds*, matching the unit every other duration in this
codebase uses. The plugin reads that specific field as **seconds**
(`getDate(defaultExpiresIn, "sec")`), so every key ever issued expired around
the year 2273. `maxExpiresIn: 365` sat right next to it and caught nothing,
because that check only runs against a *caller-supplied* `expiresIn` — the
default bypasses it entirely.

**Rule:** when a library option sits next to sibling options that share a
name-root and a unit, do not assume it shares their unit too. Grep the
library's own source for how the field is actually consumed
(`getDate(x, "sec")` vs `"ms"`) rather than pattern-matching off neighboring
fields, especially for anything to do with "default" values, which are far
less likely to be exercised by the library's own tests than an explicit
caller-supplied value.

## A multi-config Better Auth plugin can make its own CLI propose an unwanted migration (EI-259)

Restructuring `apiTokenPlugin`'s single options object into an array of two
named configurations (to let a client pick a permission set by `configId`) is
purely additive — no new column is needed, since `config_id` already exists
with a `'default'` fallback. But `npm run auth:schema` still proposed a real
migration: with more than one configuration, the plugin's schema generator
can no longer read one shared `rateLimit` to seed the `apikey` table's SQL
column DEFAULTs, and silently falls back to its own hardcoded values (10
req/24h instead of this repo's 120 req/60s).

Traced it into the plugin's `createApiKey` endpoint before accepting or
rejecting it: every real insert writes `rateLimitMax`/`rateLimitTimeWindow`
explicitly from the resolved config's own `rateLimit`, so the column-level
default is never actually read by the app — the proposed migration was inert,
but also not a change anyone asked for. Reverted the generated schema and
migration files rather than commit a migration whose only effect was
replacing an unused default with a different unused default.

**Rule:** after any change to a Better Auth plugin's option shape (not just
adding a field — restructuring one into an array counts), run
`npm run auth:schema` and read the diff before assuming "no new column" means
"no migration." If a migration appears, trace whether the changed value is
actually read at the call site that matters (here: the insert, not the
column's static DEFAULT) before deciding whether to keep it.
