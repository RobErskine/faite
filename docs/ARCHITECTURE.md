# Faite — Architecture

Reference document. Captures decisions and their rationale, so the *why* is
recoverable later without re-deriving it.

**Faite** ("done" in French) is a weekly-planner todo app. The double meaning is
the point: you control your fate by getting things done.

Status at time of writing: **P0 through P4 shipped.** Live at
https://myfaite.app — custom domain, D1, Cloudflare Email Sending, and
GitHub/Google OAuth all wired and verified against production. Deploys run
from Workers Builds on push to `main`.

**P2 is fully verified against production**, not just deployed: GitHub, Google,
and email/password sign-in all confirmed by inspecting D1, and the
signup → email → verify → sign-in loop confirmed end to end (verified user row,
token consumed, session issued). Email verification is required in production
and off in local dev — see "P2 is live" in §7.

**P3 is done, including transport:** the sync semantics (HLC, field-level LWW,
DO storage schema) *and* the authenticated `/api/sync/*` push/pull RPC and
outbox-drain pull loop are built, tested, and verified on two real browsers.
**P4 is shipped and live:** WebSocket push with hibernation replaced the
polling transport, unchanged semantics. Start at `docs/SYNC.md`, not here.

---

## 1. The core idea

The UI is two horizontal halves, and dragging between them is the whole app.

- **Calendar half (top)** — one column per day, plus an **Overflow** column.
  A day-count toggle shows 1, 3, 5, or 7 days.
- **Planning half (bottom)** — one column per **list**. "Backlog" is leftmost
  and undeletable.

Items are captured into lists, then dragged up onto a day to commit to doing
them. Missed items roll forward, and after a few rolls fall into Overflow — if
something has been put off that long, it probably was not important.

---

## 2. Decisions that shaped everything else

### 2.1 Lists are columns; labels are not

The original spec had the bottom columns be *labels*, while also defining labels
as multi-assign. Those cannot both be true. A todo with three labels would
render in three columns at once, need three sort positions, and dragging it
between columns would have no coherent meaning (remove label A, add B? which?).

Split into three concepts:

| Concept | Assignment | Role |
|---|---|---|
| **List** | single | **is** a column in the planning half |
| **Label** | multiple | filter and chip only, never a column |
| **Project** | single | cross-cutting grouping ("Bathroom Reno 2026") |

This also matches the reference UI, whose bottom columns are Brain Dump /
Grocery List / To Buy / To Read — lists, not labels.

### 2.2 Overflow is derived, never stored

The tempting implementation is a nightly job that pushes `scheduledDate`
forward. That approach:

- needs a cron, so it cannot run offline
- destroys the user's original intent (the date they actually chose)
- corrupts recurrence, which needs the template date intact
- cannot be undone
- makes two devices disagree if one was asleep

Instead `deriveColumn()` computes placement from stored data plus the clock. No
jobs, works offline, survives undo, and every device independently arrives at
the same answer — which matters enormously once sync exists.

### 2.3 Dates are civil dates, not timestamps

`scheduledDate` and `deadline` are `"YYYY-MM-DD"` strings.

A todo on "Aug 4" means *that calendar day in the user's timezone*, not an
instant. Storing an instant forces UTC-offset math on every render and produces
off-by-one-day bugs across DST boundaries and travel. Civil dates make the day
boundary explicit and the arithmetic trivial.

This makes `user.timezone` load-bearing — the overflow rule counts days, so the
day boundary must be the user's. The original spec omitted it.

### 2.4 The client renders only from a local store

The UI reads exclusively from IndexedDB. The server is a sync peer, never a
render dependency. Consequences, all of them wanted:

- **Offline works by construction**, not as a bolted-on mode.
- **The app feels instant** — no request is ever on the interaction path, so
  there is nothing to debounce and no optimistic-update reconciliation.
- **Capacitor becomes nearly free** at P7: the app is already client-only.

The cost is that Server Components cannot fetch board data. That is fine — the
board route is `ssr: false` by design.

### 2.5 Every write goes through `mutate()`, from day one

`mutate()` writes the record *and* appends a field-level patch to an outbox, in
a single transaction. Nothing drains the outbox until P3.

Building this before there was a server is the single decision that makes sync
an *attachment* rather than a rewrite. Retrofitting change-tracking into an app
that never had it means touching every mutation site.

The shared transaction matters too: if the record write succeeded and the
outbox write failed, the local store would be silently ahead of the change log
and that edit would never sync.

**"Every write" was aspirational until a P3 data-loss incident made it literal.**
`seedIfEmpty()`/`ensureDefaultTab()` wrote their rows with raw Dexie `put()`
calls, bypassing this entirely — those rows had no outbox entry, so their
first-ever sync write was a *later*, partial patch that the server synthesized
placeholder values for, and a merge bug let those placeholders overwrite real
data (see `docs/SYNC.md`'s "Known traps"). Fixed with `seedWrite()`, a seed-
specific sibling of `mutate()` that still writes an outbox entry, just at a
sentinel clock (`SEED_HLC`) instead of a real one. `resetLocalDataForNewOwner`
(account-switch wipe) is now the only deliberate exception — everything that
creates or changes a row a person can see goes through `mutate()`/`create()`/
`seedWrite()`.

### 2.6 Field-level LWW, not CRDTs

Todo records are small scalar fields. Yjs/Automerge would be overkill, harder to
debug, and much harder to expose over a documented REST API (a stated project
goal). Field-level last-writer-wins keyed by a Hybrid Logical Clock is
sufficient: two devices editing *different* fields of one todo must both
survive, which is what field-level granularity buys.

### 2.7 Ordering by fractional index

Each record holds a `position` string that sorts lexicographically. A reorder
writes **one field on one record**, not a renumbering of every sibling.

The real payoff is at sync time: two devices reordering the same list offline
generate different keys rather than fighting over the same integers, so the
merge stays a plain field-level LWW with no special-casing for order.

### 2.8 Soft deletes only

A hard delete leaves nothing to tell the other device the row is gone, so it
would resurrect on the next pull. Tombstones (`deletedAt`) survive the merge.

This held for user-facing deletes from day one, but a second, *internal*
hard delete existed until a P3 data-loss incident forced its removal:
`repairDuplicateLists()` ran on every boot and hard-deleted any two live
lists sharing a name — a legitimate state (e.g. two lists both named
"Groceries" on different tabs), not just the seeding race it was written
for — with no tombstone and no outbox entry. Once a sync peer existed, the
deletion never reached it, so the next pull resurrected the "duplicate" and
the next boot deleted it again. It's gone now; nothing in this codebase
hard-deletes a domain row anymore except the deliberate, sanctioned
`resetLocalDataForNewOwner()` account-switch wipe. If a future "cleanup"
routine wants to run on every boot and remove rows outside `mutate()`,
that's the shape of the thing that already went wrong once.

**Archiving is a separate axis, not a softer delete.** A list carries
`archivedAt` alongside `deletedAt`, and the two mean different things:

|              | the list        | its to-dos                  |
| ------------ | --------------- | --------------------------- |
| `deletedAt`  | tombstoned      | rehomed to Backlog          |
| `archivedAt` | hidden, intact  | hidden with it, `listId` untouched |

Keeping the to-dos attached is what makes restoring return a full column, and
what makes the item count in the archive true. It costs one rule elsewhere:
`buildBoard` sends a to-do whose list is missing to Backlog, so archived lists'
to-dos must be filtered out *before* it (`Board`'s `visibleTodos`) or they
would land there anyway.

Both fields are nullable and were added after rows already existed, so filters
test truthiness — a row written by an earlier version reads back `undefined`,
not `null`.

### 2.8b Tabs partition the planning half only

A tab groups list columns. `List.tabId` points at one; switching tabs swaps
which columns the planning half renders.

Two things deliberately do **not** belong to a tab:

- **The calendar half.** A to-do scheduled to Thursday is on Thursday whatever
  tab is open. Scheduling is a decision about time, and tabs are a decision
  about filing.
- **Backlog.** It carries `tabId: null` and is pinned into every tab, holding
  the same to-dos in each. This is load-bearing, not cosmetic: `buildBoard`
  routes a to-do whose list is missing to `the Backlog column, or the first
  one`, so a tab without Backlog would quietly collect other tabs' orphans in
  whichever column sorted first. `null` therefore means "pinned everywhere",
  and Backlog is the only row allowed to hold it — `ensureDefaultTab` backfills
  every other list onto the default tab on boot.

That split is why tab filtering could **not** reuse the archived-list filter in
§2.8. Archiving removes a list from both halves, so filtering `visibleTodos`
upstream is correct there. Tab membership must not reach the calendar, so
`buildBoard` takes a `hiddenListIds` set instead and consults it *after* the
calendar branch has already returned. Filtering tabs upstream would have
emptied Thursday every time you switched tabs.

**A new tab is born with one list**, named `{tab name} List`. A tab with no
lists renders an empty track whose only way forward is the create-list slot at
the far left — usable, but a dead end on first sight. `createTab` therefore
returns both ids, and `createTabWithUndo` folds them into a single undo entry
that tombstones the list before the tab, so undoing a create never strands an
orphan column on the default tab.

**Archiving a tab takes its lists with it.** Each live list is marked with
`archivedWithTabId`, and that marker is what lets `unarchiveTab` restore
exactly the group that left while a list filed on its own stays filed.

The group is **recorded, not inferred**, and that distinction was paid for.
The first implementation gave the tab and its lists one shared `archivedAt` and
matched on it — equivalent-looking, one field cheaper, and wrong: `now()` has
millisecond resolution, so archiving a list and then archiving its tab lands
both on the same instant and makes them indistinguishable. Restoring the tab
dragged back a list the user had deliberately filed separately. A test pins the
collision. The lists still share the tab's `archivedAt` so the archive can list
them together, but that timestamp is presentation only — identity lives in the
marker.

The **default tab** ("My Lists", `isDefault`) cannot be archived or deleted,
for the same reason Backlog cannot: it is the guaranteed destination that
`deleteTab` rehomes lists to. Renaming and recoloring it are fine.

### 2.8c Changing a field is a seven-file operation — see `docs/SCHEMA-CHANGES.md`

An entity's fields are declared in four places (`lib/schema.ts`,
`store/db.ts`, `server/db/user-schema.ts`, `server/db/bootstrap.ts`) and
derived in three more (`server/db/migrations.ts`, `server/sync/columns.ts`,
`lib/sync/wire.ts`). Most mismatches do not produce a type error.

The one that matters: **`bootstrap.ts` cannot deliver a new column to an
account that already exists**, because `CREATE TABLE IF NOT EXISTS` is a no-op
on an existing table. The column then appears in `COLUMNS_BY_KIND`, passes
`sanitizePatch`, and gets named in SQL — so the first push carrying it throws
`no such column` inside `push()`'s transaction and **pushes fail permanently
for that account while pulls keep working**. `src/server/db/migrations.ts` is
the ledgered `ALTER` path that fixes this, and it is not optional.

**`src/server/db/schema-parity.test.ts` now enforces all of this
mechanically** — it replays the migration ledger and asserts the result equals
what `user-schema.ts` declares, so a missing migration is a red test rather
than a permanently broken account. `npm run schema:check` is the fast loop, and
`docs/SCHEMA-OPS.md` is the procedure for both outcomes.

### 2.8e References between entities are advisory

`listId`, `projectId`, `tabId`, `archivedWithTabId`, `labelIds[]`, `parentId`,
`recurrenceParentId` — none of these are enforced by a foreign key, in SQLite
or in Dexie, and none ever will be.

**A dangling id is a legal, expected state, not corruption.** Two devices, one
deletes a list while the other assigns a to-do to it: field-level LWW (§2.6)
resolves each field independently and has no notion of a cross-row invariant,
so it cannot prevent that pairing and was never meant to. Adding FKs would
turn an ordinary offline edit into a write that fails on sync.

So the rule is at the read end, not the write end:

1. **Resolve through one helper**, which returns `undefined` for an id that is
   missing, soft-deleted, or archived.
2. **Render a neutral fallback.** Never crash, never invent a name.
3. **Never a boot-time pass that deletes rows** to "clean up" dangling
   references. That is precisely the shape of `repairDuplicateLists` (§2.8),
   which cost real data.

Two classes of reference, and the difference is a design decision to make
deliberately when adding one:

|  | cleared when the target dies | example |
| --- | --- | --- |
| **live** | yes — `deleteList` rehomes to Backlog, `deleteProject` nulls it | `listId`, `projectId` |
| **provenance** | no — it deliberately outlives the target | `archivedWithTabId` |

A provenance reference is *supposed* to point at something gone; that is its
job. Getting the class wrong is not a bug you find later — it is a data model
that quietly means the wrong thing.

### 2.9 Per-user Durable Object as the sync backend (P3)

Chosen over a shared D1 because it gives, for free: a monotonic per-user
changelog (drives `since=version` pulls), single-writer serialization, and
WebSocket hibernation for live push at P4. D1 holds only auth tables, which
need a conventional SQL adapter.

Verified available on the account — an existing worker already runs a DO with
`useSqlite: true`, so no plan upgrade is required.

### 2.10 Sharing hooks now, sharing later

Faite is solo-user through v1, but sharing labels is a likely direction. Three
things are cheap now and painful to retrofit, so they are already in place:

1. **UUIDv7 ids everywhere** — never per-user autoincrement, so records can
   cross Durable Objects without collision.
2. **`ownerId` on every row.**
3. The sync layer is designed to subscribe to **N sources**, not a hardcoded one.

No sharing UI, permission model, or cross-DO reads exist.

### 2.11 Undo is a forward mutation

An undo entry is **data** — a list of `{kind, entityId, patch}` steps — not a
closure. Every reversible action happens to be expressible that way, so a
closure would buy nothing and cost testability plus the risk of capturing an
object a later edit has made stale.

The payoff lands on §2.5 and §2.6. Replaying an entry goes through `mutate()`,
so it gets a fresh `updatedAt`/`hlc` and joins the outbox as an ordinary edit.
**Sync never has to know undo exists** — no revert opcode, no inverse-patch
protocol, no special case in the merge.

Three rules make it safe without an invalidation pass:

1. An inverse writes **only the keys the forward patch touched**, so a later
   edit to a different field of the same record survives.
2. ⌘Z is strict **LIFO**, so a later edit to the *same* field has already been
   reversed by its own newer entry before the older one is reached.
3. Recording happens at **call sites**, not inside `mutate()`. Auto-recording
   would push a read-before-write into the write path, would record the undo's
   own `mutate()` call, and would split a compound operation like `deleteList`
   into N+1 entries — so one ⌘Z would undo only its last step.

Consequence worth knowing: undoing out of order (via a toast's Undo rather than
⌘Z) reverses only that action's fields, which is the same field-level
last-writer-wins §2.6 already commits to.

History is in-memory only. A delete followed by a reload is permanent.

Redo is not built. `⇧⌘Z` is deliberately left unbound rather than swallowed, so
adding it is not a change in behaviour.

### 2.12 Auth lives in the Worker, not a Next route (P2)

> For the file map, request flow, and operational recipes, see
> `docs/AUTH.md`. This section and §2.13 carry the reasoning; AUTH.md
> deliberately does not repeat it.

The obvious place for Better Auth is `app/api/auth/[...all]/route.ts` — that is
what its own docs show. It does not work here: `output: export` (§6, the
Capacitor build target CI has kept green since P0) forbids Route Handlers that
read `Request`, and Better Auth's handler does exactly that. Using it would
break the static build the moment auth landed.

Instead `src/server/worker.ts` — already the custom entry re-exporting the DO
(§6 gotcha 2) — intercepts `/api/auth/*` and calls `createAuth(env).handler(request)`
before falling through to the OpenNext handler for everything else. Zero Next
server surface, so the static build never sees it. `createAuth(env)` is a
factory called fresh per request, for the same reason recorded in §7: the D1
and Email bindings only exist inside `fetch()`.

Cost: `next dev` never runs the worker entry, so `/api/auth/*` 404s there.
`src/lib/auth-client.ts` reads `NEXT_PUBLIC_AUTH_URL` to point at a separate
`npm run preview` instance when developing against real auth; unset (the
default), it resolves same-origin, which is correct in production and in
`npm run preview` itself. The same env var is what a Capacitor WebView will
need at P7 (`capacitor://localhost` is not the API's origin), so this is not
dev-only scaffolding.

> **That override must never live in `.env.local`, and once did.** `NEXT_PUBLIC_*`
> is inlined into the client bundle at **build** time, and Next loads `.env.local`
> in *every* environment — so `npm run deploy` shipped a production bundle whose
> login page posted to `http://localhost:8787`, and sign-in on
> https://myfaite.app died on a CORS preflight with the deployed worker answering
> `Access-Control-Allow-Origin: http://localhost:8787`. `.env.production` cannot
> rescue this: `.env.local` takes precedence over it.
>
> The override now lives in the `dev` script in `package.json`, so it is scoped to
> the one command that needs it and no build can see it. `resolveAuthBaseURL()`
> additionally **discards a localhost target when the page is served from a real
> domain**, which turns a total login outage into a console warning. Capacitor is
> unaffected — `capacitor://localhost` is itself a local hostname.

**D1 holds auth tables only** (`user`, `session`, `account`, `verification`,
generated by `@better-auth/cli generate` into `src/server/auth-schema.ts` —
regenerate with `npm run auth:schema` after changing `auth.ts`'s
`emailAndPassword`/`socialProviders`/plugin config). Todo data stays in the
per-user DO (§2.9); D1 needs a conventional adapter, which is what §2.9 already
predicted.

**Password reset and verification email go through Cloudflare Email Service**
(`src/server/email.ts`, the `EMAIL` binding), not a third-party provider —
transactional-only by design, and no API key to manage from a Worker. Sending
is inert until `myfaite.app`'s DNS is on Cloudflare and
`wrangler email sending enable myfaite.app` has run; until then `sendEmail()`
catches `E_SENDER_NOT_VERIFIED` and logs the content (including the reset/
verify link) instead of throwing, so the rest of the flow stays testable
without DNS.

**Email verification is required (`requireEmailVerification: true` is the
target), but the flag in `auth.ts` starts `false`.** Turning it on before
`myfaite.app` can send mail would make every signup — including testing it —
unrecoverable. It is flipped by hand, once, the day the first real message
sends. It gates password sign-in only; GitHub and Google already hand over a
verified address.

**Adopting local data into a real account is a one-time backfill, not a
standing translation layer.** Every row already carries `ownerId` (§2.10 —
this is the payoff), fixed at `LOCAL_OWNER_ID` (`"local-user"`) through P1.
`adoptLocalData()` (`src/lib/store/adopt-owner.ts`), triggered by
`SessionProvider` on first sign-in, rewrites every `todos`/`lists`/`labels`/
`projects`/`tabs` row carrying that placeholder to the signed-in user's real
id, through `mutate()`'s table dispatch so the outbox sees it, and remembers
the binding in `localStorage` (mirroring the font/theme bridge in
`layout.tsx`) so it never repeats. **New writes after that use
`getCurrentOwnerId()`** (`src/lib/store/owner.ts`) instead of the constant, or
adoption would only ever be historical — everything created after signing in
would silently fall back to the placeholder again.

`settings` is the deliberate exception, excluded from adoption entirely and
**permanently** keyed to `LOCAL_OWNER_ID`. Unlike the other tables, `ownerId`
is its Dexie *primary key* — Dexie cannot repoint a primary key with
`update()` — and `useSettings()`/`mutateSettings()` are hardcoded to that key
throughout the app (the board, the settings sheet, the command palette).
Re-keying it would silently orphan every read and write of settings the
moment someone signs in. Nothing filters todos/lists/labels/projects/tabs by
`ownerId` on read (see `hooks.ts` — every `use*` hook reads the whole table),
so rewriting those five tables is free; settings' Dexie primary key is the one
place that coupling actually bites. P3's sync layer needs its own answer for
settings regardless — "one row per device" was never going to survive sync
unchanged — so this is deferred there, not solved here.

**A different account signing in on a device already bound to someone else
does not merge.** `adoptLocalData()` returns `"different-user"`, and
`SessionProvider` asks via a confirmation dialog before calling
`resetLocalDataForNewOwner()` (wipes local data, keeps the remote accounts
untouched) and reseeding. Declining signs back out rather than leaving the
device signed in against a board it does not match.

Auth stays optional throughout: the board renders and mutates identically
signed in or out (§2.4 still holds — nothing here is on the render path), and
`/login`/`/signup`/`/forgot-password`/`/reset-password`/`/verify-email` are
ordinary reachable routes, never a gate.

### 2.13 The board moved to `/board`; it stays ungated

`/` used to serve the board directly — anyone visiting `myfaite.app` landed in
a working app with no explanation of what it was. `/` is now a marketing page;
the board lives at `/board`.

**`/board` is not gated behind sign-in.** The instinct was to gate it, then to
reconsider: this app already works fully against local data with no account
(§2.4, §2.10), and `adoptLocalData()` (§2.12) already exists to fold that data
into an account on first sign-in. Gating would have made that path an edge
case; leaving it open makes it the primary onboarding flow — try it, then sign
up and keep what you made. It also sidesteps a real trap: a gate built on
`useSession()` (a network fetch) would show a login page to an offline
signed-in user, which is exactly the failure §2.4 exists to prevent. With
nothing gating the route, there is nothing to get that wrong.

**Signed-in visitors to `/` bounce to `/board`, but on the local marker, not
the session.** `getBoundOwnerId()` (`lib/store/owner.ts`) already answers "has
this browser used the board before", synchronously, offline — the same inline
pre-paint-script technique `layout.tsx` uses for font/theme, reused rather than
reinvented. It is deliberately the *cheap* check for this one case: querying
IndexedDB instead would drag Dexie into a page that should stay a static,
near-JS-free Server Component. A local-only returning visitor this misses just
clicks "Open the board" once.

**Three logged-out nudges (welcome dialog, "this device only" banner, header
Sign up CTA) all gate on `useShouldShowAuthNudges()`
(`lib/auth-nudge.ts`), not on `useSession()` directly**, for the same offline
reason as the gate that wasn't built: offline, a fetch failure and a genuine
"not signed in" both resolve to `data: null`, and showing "create an account,
your data isn't saved" to someone who IS signed in but offline would be
actively wrong. The hook distinguishes them via `error` — a clean `null` is a
confirmed answer, a `null` *with* an error is a failed check — and falls back
to the local marker only in that failure case. An in-page sign-in/out is
unaffected by this and reacts immediately, because that transition is not a
network race the way a cold start is.

The banner is additionally conditional on the board actually holding data
(`todos.length > 0`). Empty, the warning is noise; once something exists to
lose, it is the moment the message lands. The welcome dialog and the banner
also use different storage tiers on purpose (`lib/onboarding.ts`): the dialog
is a one-time explanation (`localStorage`, dismissed forever), the banner is a
standing warning (`sessionStorage`, dismissed for the visit, back next time) —
collapsing them into one mechanism would have made one of the two wrong.

None of this is a security boundary. A client-side nudge (or a gate, had one
been built) is trivially bypassed from devtools — acceptable only because
there is nothing behind it yet: all data lives in the visitor's own IndexedDB.
Real enforcement arrives at P3, when the per-user Durable Object holds the data
and authenticates every sync request server-side.

### 2.14 Derive unless the fact is historical

§2.2 already says overflow is derived and never stored. That was always the
general rule; it had only ever been written down for one case.

Before adding a field, three questions:

1. **Does it change when its inputs change?** Then derive it. A stored copy is
   a cache with no invalidation, and under §2.6 it is a cache that two devices
   can disagree about.
2. **Must it survive its source being deleted, moved, or renamed?** Then
   persist it — and make it a *provenance* reference (§2.8e).
3. **Is it a decision or a consequence?** Decisions persist. Consequences
   derive.

Worked examples, both real, both of which looked like new columns and turned
out to be new selectors:

- *"Which tab is this to-do under?"* — `listId → list.tabId → tab`. Derived,
  so moving a list between tabs updates every to-do in it for free (EI-62).
- *"Which list did this come from?"* — already answered by `listId`, which
  `scheduleTodo` deliberately preserves while `moveTodoToList` re-files. A
  second immutable column would freeze a fact the user expects to be able to
  change (EI-61).

Two cases derive to *nothing*, and that is a real answer rather than a gap: a
Backlog to-do has no tab (`List.tabId === null` means "pinned into every tab",
§2.8b) and an unfiled to-do has no list. Both render blank. Do not invent a
placeholder for a fact that legitimately does not exist.

The payoff: the cheapest schema change is the one you don't make.

**Projects is retired in favour of labels**, decided 2026-08-06. The first
worked example above (tab-from-list) is what made this legible: once "which
tab" is a derived selector rather than a stored field, a `project` entity
whose only real job was cross-cutting grouping is redundant with a `label` —
multi-assign, already synced, already has UI. EI-53 ("Projects +
cross-cutting project views") is cancelled; EI-62 does the retirement.
Revivable later if the need reappears, but not before a real use case does.

### 2.15 The data model is resettable, for now

Faite has one user, so a schema change that would be awkward to migrate can
instead be resolved by throwing the data away — `npm run schema:reset`.

This is a deliberate, bounded position, not a lack of rigour. It buys freedom
to keep changing the model while the right shape is still being found, and it
expires on a single event: **a second real account.** You cannot reset data
that isn't yours.

Two things make it safe rather than reckless:

1. **`schema-parity.test.ts`** makes "I forgot a file" a red test instead of a
   permanently broken account (§2.8c).
2. **`pull()` detects a stranded cursor.** Wiping a Durable Object resets its
   version counter, and a device holding a higher watermark would otherwise
   believe it was caught up forever — silently, on every device at once. Since
   every row's `version` is allocated below `sync_meta.next_version`, a cursor
   at or above it is provably only reachable after a wipe, so the server
   returns `reset: true` and the ordinary pull loop re-reads from 0.

Everything locked mode needs — a client backfill ledger, the three-deploy
retirement ladder, bundle telemetry — is specified and deliberately unbuilt.
See "Not built yet, and why" in `docs/SCHEMA-CHANGES.md`, and
`docs/SCHEMA-OPS.md` for the procedure in both modes.

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.2.12 | App Router, `src/` dir |
| React | 19.2.4 | |
| Hosting | Cloudflare Workers via `@opennextjs/cloudflare` 1.20.2 | |
| CLI | wrangler 4.118.0 | |
| Styling | Tailwind v4 + shadcn/ui | |
| Drag & drop | dnd-kit | keyboard + screen-reader support built in |
| Local store | Dexie (IndexedDB) | |
| Auth | Better Auth 1.6.x | GitHub + Google OAuth, email/password — see §2.12 |
| Auth storage | D1 + Drizzle (`@better-auth/drizzle-adapter`) | auth tables only; todo data stays in the DO |
| Email | Cloudflare Email Service (`send_email` binding) | password reset + verification, see §2.12 |
| Validation | Zod | source of truth for Drizzle, OpenAPI, MCP |
| Tests | Vitest (+ fake-indexeddb, Testing Library) | 692 tests |

---

## 4. Layout

```
src/
  app/
    page.tsx                  Marketing page (Server Component) — see §2.13
    board/page.tsx            The board, dynamically imported with ssr:false
    layout.tsx                TooltipProvider + Toaster
    login/, signup/,
    forgot-password/,
    reset-password/,
    verify-email/             client-only auth pages — see §2.12
  lib/
    schema.ts                 Zod source of truth for every entity
    scheduling.ts             deriveColumn(), civil-date arithmetic, rollover
    ordering.ts               fractional index helpers
    board.ts                  groups todos into columns; drop-target id codec
    column-nav.ts             arrow-key focus grid — see KEYBOARD.md §11
    auth-client.ts            createAuthClient(); NEXT_PUBLIC_AUTH_URL-aware
    auth-nudge.ts             useShouldShowAuthNudges() — see §2.13
    onboarding.ts             welcome-dialog/banner dismissal flags — §2.13
    store/
      db.ts                   Dexie schema, lazy singleton
      mutate.ts               THE single write path + outbox
      repositories.ts         CRUD per entity, seeding, duplicate repair
      owner.ts                getCurrentOwnerId() — LOCAL_OWNER_ID vs adopted
      adopt-owner.ts           one-time ownerId backfill on first sign-in
      hooks.ts                reactive reads (useLiveQuery)
  components/
    board/                    board, columns, cards, sheet, command palette
    auth/                     SessionProvider, welcome dialog, signed-out banner
    marketing/                landing page header — see §2.13
    ui/                       shadcn components
  server/
    worker.ts                 custom worker entry (exports the DO, mounts auth)
    auth.ts                   createAuth(env) factory — see §2.12
    auth-schema.ts            generated by `npm run auth:schema`, don't hand-edit
    auth-cli.ts               dev-only `auth` export for the CLI to introspect
    email.ts                  sendEmail() over the EMAIL binding
    user-do.ts                UserDurableObject skeleton — filled in at P3
```

---

## 5. Scheduling rules

```
unscheduled                 -> planning half, its list column
rolls <= 0                  -> calendar half, its scheduled day
rolls <= overflowAfterDays  -> calendar half, today
otherwise                   -> calendar half, Overflow
```

Then one override: **if the resulting day is outside the visible window, render
in the planning half instead**, dimmed with a date chip. This follows from "a
todo is hidden from planning only when it is actually visible in the calendar" —
otherwise something scheduled three weeks out would appear in neither half.

This override used to be normal, everyday behaviour: the window was always
exactly `settings.visibleDays` long, so scheduling something for next week
routinely bounced it here, and changing the 1/3/5/7-day toggle visibly moved
todos between halves. It is now a rare safety valve. `Board` opens on
`DEFAULT_RENDERED_DAYS` (30) rather than `settings.visibleDays`, specifically
so the day track has room to scroll from the very first render, and grows the
rendered window (`contextFromSettings`'s `renderedDays` param, in
lib/scheduling.ts) further to always cover the furthest-scheduled todo, up to
`Board`'s `cap` state (starts at `DEFAULT_DAY_CAP`, 365 — about a year).
`settings.visibleDays` still means something, but only as an explicit action:
picking a smaller count from the ⌘K toggle collapses the window back down to
exactly that many days (`Board`'s effect on `settings.visibleDays` changes),
the same "show only N days" behaviour the toggle always had, just no longer
what sizes the default view.

`cap` is a floor, not a hard ceiling: it bounds ordinary scrolling and the
Week/Month/Quarter buttons, but the date picker in `date-nav.tsx` has no
upper bound of its own. Picking a day past `cap` — a reminder eighteen months
out, say — grows `cap` (and the rendered window with it) to reach it, rather
than the picker silently refusing the date. `cap` only ever grows and is
never reset by the ⌘K toggle, so an explicitly unlocked longer horizon
survives a later "show fewer days" collapse. The planning-half override above
fires only past whatever `cap` currently is, where rendering a column is not
an option and the todo has to surface somewhere instead. See `Board`'s
`renderedDays` calculation and `use-day-track.ts` for the scrolling and
jump-button mechanics; Overflow and Backlog are pinned outside their scroll
tracks (`BoardColumn`'s `pinned` prop) so they stay reachable however far a
track scrolls.

Subtleties that are easy to get wrong:

- **Rolls count *eligible* days, not calendar days.** With workdays-only on, a
  Friday miss viewed on Monday has rolled once, not three times.
- **The workday setting affects rollover targets only.** A todo the user
  explicitly scheduled on a Saturday still shows on Saturday.
- **Deadlines never affect placement.** They never exempt a todo from overflow
  and never change its column; they render as a missed badge.
- **Status is three-valued**: `open | done | dropped`. "Won't do" is not "done".

---

## 6. Build and deploy

Two build targets from one codebase:

- **Workers (web)** — `npm run deploy`
- **Static export (Capacitor, P7)** — `npm run build:static`

The static build is kept green by CI from P0 onward. If an app route ever takes
a dependency on RSC data fetching, middleware, or `next/image` optimization,
that build fails immediately instead of at P7 when it would be a rewrite.

### Gotchas encoded in the repo

1. **`next.config.ts` is loaded via `require()`**, so top-level `await` breaks
   the build outright. `initOpenNextCloudflareForDev` must be a static import.
2. **The default OpenNext output cannot export a Durable Object class.** A
   custom worker entry (`src/server/worker.ts`) re-exports the DO alongside the
   OpenNext handler, and `wrangler.jsonc` points `main` at it.
3. **The `open-next/worker` specifier needs two aliases kept in sync** —
   `paths` in `tsconfig.worker.json` for tsc, `alias` in `wrangler.jsonc` for
   the bundler.
4. **`src/server` is excluded from the Next tsconfig** and typechecked by
   `tsconfig.worker.json`; it uses `cloudflare:workers` types and imports a
   bundle that only exists after a build.
5. **ESLint must ignore `.open-next/`** or CI is permanently red from ~10k
   generated-code violations. `cloudflare-env.d.ts` (wrangler-generated) is
   ignored for the same reason.
6. `next dev` warns that the DO class is not exported. Expected — it is
   exported from the custom worker entry, not the Next build. The real deploy
   resolves both bindings.
7. **`cloudflare-env.d.ts`'s `mainModule` field is `typeof import("./src/server/worker")`**,
   which pulls `worker.ts` — and its Workers-only `open-next/worker` import —
   into whichever tsconfig includes the `.d.ts` file. It is excluded from the
   main `tsconfig.json` for exactly this reason (gotcha 4 again, one level
   removed) and included only in `tsconfig.worker.json`.
8. **`/` is now the marketing page, not the board (§2.13) — and with
   `output: export`, `/` is also the Capacitor bundle's `index.html`.**
   Unaddressed as of P2: the mobile app would open on marketing, not the
   board. Fix at P7, not before — either point Capacitor's entry at
   `/board/index.html`, or have the marketing page detect the
   `capacitor://localhost` origin and redirect.

---

## 7. Roadmap

| Phase | Scope | Status |
|---|---|---|
| P0 | Scaffold + deploy | done |
| P1 | Local main loop, no backend | done |
| P2 | Better Auth on D1 — email/password, GitHub + Google OAuth | **shipped and live** |
| P3 | Sync v0 — per-user DO, HLC LWW, polling | **done, including transport** — see `docs/SYNC.md` |
| P4 | Sync v1 — WebSocket push, hibernation | **shipped and live** |
| P5 | API + OpenAPI docs | next up (EI-50) |
| P6 | Fast follow (see below) | in progress |
| P7 | Capacitor + MCP | not started |

**P3 was the milestone that mattered most** — the app syncs between a work and
a personal machine, verified on two real browsers. P4 then swapped the
transport to WebSockets against the same semantics, also verified live.

**Projects is retired in favour of labels** as the cross-cutting organizing
primitive (see §2.14, EI-62) — no longer part of P6 scope.

**P6 fast-follow, in priority order:** sub-tasks, recurrence (RRULE template +
lazily materialized occurrences + exceptions table), locations library, saved
views, icon upload, magic-link auth (Google moved into P2 — see §2.12).

List tabs, priority, and location were pulled forward out of P6 and shipped —
see §2.8b.

**Markdown descriptions shipped** alongside day notes: `MarkdownField`
(`components/ui/markdown-field.tsx`) wraps BlockNote and now backs both
`todo.description` and `dayNote.body`. Markdown remains the stored format
rather than BlockNote's own JSON — the command palette substring-searches
descriptions, and the field has declared itself markdown since P1.

**Day notes are the seventh sync kind** (`dayNote`, migration 4). One row per
calendar day, keyed by a DETERMINISTIC id (`daynote:YYYY-MM-DD`) rather than a
UUIDv7 — the one deliberate exception to that rule, because there is exactly
one note per day and two offline devices must collide on a single entity for
LWW to resolve rather than producing two rows nothing merges. See
`dayNoteSchema` in `lib/schema.ts`. Surfaced by `DaySheet`, which also renders
a DERIVED timeline of that day's todo events (`lib/day-timeline.ts`) — there is
still no events table, and the limits that follow from deriving history out of
`createdAt`/`completedAt` are documented in that module's header.

### P2 is live

DNS, OAuth apps, secrets, Email Sending, and CI are all done — see
`docs/SETUP.md` for the runbook and the current state of each.

**`createAuth(env, request)` derives `baseURL` from the request's origin — do
not hardcode it.** Better Auth builds its origin check and every callback URL
from `baseURL`, so a fixed value breaks auth on every host that is not the one
hardcoded: both local ports and, once branch previews were enabled, every
`*-faite.bfmw-dev.workers.dev` preview. Deriving it makes production,
previews, and localhost all work with no environment branching. This does not
weaken the origin check — a browser sets `Origin` from the page's real origin
and scripts cannot forge it, so a cross-origin request still mismatches and is
still rejected; `trustedOrigins` remains the redirect allow-list.

The same request origin decides one more thing: **email verification is
required everywhere except localhost** (`requireEmailVerification = !isLocal`).
The `send_email` binding does not deliver under local `wrangler dev` without
`"remote": true`, so requiring it locally deadlocks every local signup with no
way to reach the link. `sendEmail` logs the message body locally for the same
reason. Branch previews are not local and stay strict — they share
production's D1.

### Known P2/P3 gotchas, recorded early

- **Better Auth must be constructed per-request.** D1 bindings only exist inside
  `fetch()`, so a module-level singleton fails at runtime. Solved with a
  factory (§2.12) — recorded here as the gotcha it would have been otherwise.
- **OAuth in a Capacitor WebView** needs custom-scheme deep links /
  `@capacitor/browser`. A plain web redirect never returns to the app. Not
  addressed yet — `trustedOrigins` reserves `capacitor://localhost` so this
  is not designed out, but the deep-link wiring itself is P7 (EI-51).
- `LOCAL_OWNER_ID` in `repositories.ts` (now `owner.ts`) was the P1 stand-in
  for a real user id. **Resolved at P2**, not deferred to P3 as originally
  planned here — see §2.12's `adoptLocalData()`/`getCurrentOwnerId()`.
  `settings` is the one row that intentionally still uses it forever.
- The outbox `hlc` field currently holds a wall-clock ISO string. P3 replaces it
  with a real HLC; the shape is already stable.

---

## 8. Testing

```bash
npm run verify   # typecheck (app + worker), lint, tests, both builds
npm test         # vitest run
```

692 tests (52 files), verified 2026-08-09 via `npm test` with `npm run lint`
clean, including the board card redesign and the day-column list grouping
(DRAG-AND-DROP §4.13). The load-bearing ones:

- **`scheduling.test.ts`** — timezone boundaries, DST, roll thresholds,
  workday rollover, deadline independence. The most heavily tested file, for
  good reason: a `Math.round` vs `Math.floor` bug in the epoch-day helper once
  shifted every derived date forward by a day. `daysBetween` masked it because
  the offset cancels in subtraction; only `addDays` exposed it.
- **`ordering.test.ts`** — fractional key convergence under concurrent reorder.
- **`repositories.test.ts`** — uses `fake-indexeddb`; covers the concurrent
  seeding race that React StrictMode's double-invoked effect triggers.
- **`board.test.ts`** — column grouping and drop-target resolution.
- **`undo.test.ts`** — `inversePatch` is the correctness core, so most cases
  live there: falsy values must survive (a `?? null` regression would rewrite
  `false`/`0`/`""`), and a field missing from the before-state must invert to
  `null`, never `undefined` — Dexie's `update()` reads `undefined` as "delete
  this key path". Also guards the shared patch shapes: `listPatch` writes
  `scheduledDate: null` internally, so a hand-built inverse would leave a
  dragged todo unscheduled after undo.
- **`adopt-owner.test.ts`** — `fake-indexeddb` + `happy-dom` (for the
  `localStorage` binding bridge): the `LOCAL_OWNER_ID` → real-user rewrite,
  that it is a genuine no-op the second time the same user signs in, that a
  second distinct user is refused rather than merged, and that `settings`
  never gets re-keyed away from `LOCAL_OWNER_ID`.

### Lesson worth keeping

Verify deploys with a real request, not the deploy command's output. A `curl`
right after `wrangler deploy` returned 404 with `error code: 1042`, which looked
like a worker-fetch loop; it was propagation lag and resolved moments later.
Poll before diagnosing.
