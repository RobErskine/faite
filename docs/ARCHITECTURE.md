# Faite — Architecture

Reference document. Captures decisions and their rationale, so the *why* is
recoverable later without re-deriving it.

**Faite** ("done" in French) is a weekly-planner todo app. The double meaning is
the point: you control your fate by getting things done.

Status at time of writing: **P0 and P1 shipped.** Auth (P2) and sync (P3) are
next. Live at https://faite.bfmw-dev.workers.dev

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
`deleteTab` rehomes lists to. Renaming and recolouring it are fine.

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
| Validation | Zod | source of truth for Drizzle, OpenAPI, MCP |
| Tests | Vitest (+ fake-indexeddb, Testing Library) | 64 tests |

---

## 4. Layout

```
src/
  app/
    page.tsx                  Board, dynamically imported with ssr:false
    layout.tsx                TooltipProvider + Toaster
  lib/
    schema.ts                 Zod source of truth for every entity
    scheduling.ts             deriveColumn(), civil-date arithmetic, rollover
    ordering.ts               fractional index helpers
    board.ts                  groups todos into columns; drop-target id codec
    store/
      db.ts                   Dexie schema, lazy singleton
      mutate.ts               THE single write path + outbox
      repositories.ts         CRUD per entity, seeding, duplicate repair
      hooks.ts                reactive reads (useLiveQuery)
  components/
    board/                    board, columns, cards, sheet, command palette
    ui/                       shadcn components
  server/
    worker.ts                 custom worker entry (exports the DO)
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
otherwise something scheduled three weeks out would appear in neither half. A
visible consequence is that changing the day-count toggle changes which todos
appear below. That is intended.

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
   generated-code violations.
6. `next dev` warns that the DO class is not exported. Expected — it is
   exported from the custom worker entry, not the Next build. The real deploy
   resolves both bindings.

---

## 7. Roadmap

| Phase | Scope | Status |
|---|---|---|
| P0 | Scaffold + deploy | done |
| P1 | Local main loop, no backend | done |
| P2 | Better Auth on D1, GitHub OAuth only | next |
| P3 | Sync v0 — per-user DO, HLC LWW, polling | |
| P4 | Sync v1 — WebSocket push, hibernation | |
| P5 | API + OpenAPI docs | |
| P6 | Fast follow (see below) | |
| P7 | Capacitor + MCP | |

**P3 is the milestone that matters most** — it is when the app syncs between a
work and a personal machine. Acceptance is real-world use for a week, not a
passing test.

**P6 fast-follow, in priority order:** projects + views, sub-tasks, recurrence
(RRULE template + lazily materialized occurrences + exceptions table), priority,
markdown descriptions, location, search/saved views, icon upload,
Google + magic-link auth.

List tabs were pulled forward out of P6 and shipped — see §2.8b.

### Known P2/P3 gotchas, recorded early

- **Better Auth must be constructed per-request.** D1 bindings only exist inside
  `fetch()`, so a module-level singleton fails at runtime. Use a factory.
- **OAuth in a Capacitor WebView** needs custom-scheme deep links /
  `@capacitor/browser`. A plain web redirect never returns to the app.
- `LOCAL_OWNER_ID` in `repositories.ts` is the P1 stand-in for a real user id.
  Every row already carries `ownerId`, so P2 swaps the value without a migration.
- The outbox `hlc` field currently holds a wall-clock ISO string. P3 replaces it
  with a real HLC; the shape is already stable.

---

## 8. Testing

```bash
npm run verify   # typecheck (app + worker), lint, tests, both builds
npm test         # vitest run
```

64 tests. The load-bearing ones:

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

### Lesson worth keeping

Verify deploys with a real request, not the deploy command's output. A `curl`
right after `wrangler deploy` returned 404 with `error code: 1042`, which looked
like a worker-fetch loop; it was propagation lag and resolved moments later.
Poll before diagnosing.
