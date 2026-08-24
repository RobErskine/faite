# Faite

A weekly-planner todo app. *Faite* is "done" in French — the double meaning is
the point: you control your fate by getting things done.

Live: https://myfaite.app

The UI is two horizontal halves, and dragging between them is the whole app.
The top half is a day-by-day calendar plus an **Overflow** column; the bottom
half is your lists. Capture into a list, then drag up onto a day to commit to
doing it. Missed items roll forward through **the Faite Loop**, and after a
configurable number of rolls fall into Overflow — if something has been put
off that long, it probably was not important. **Overdrive** is the way back
out: a full-screen, one-card-at-a-time mode for burning down an Overflow pile
— won't do, done, back to a list, or scheduled forward, one keystroke or tap
at a time.

Local-first: everything reads and writes to IndexedDB, so it works offline and
no request is ever on the interaction path.

## Docs

Everything is written down. The problem is knowing which file, so start here:

| I want to… | Read |
|---|---|
| understand **why** anything is the way it is | **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the one source of rationale. Stack, layout, scheduling rules, build gotchas, roadmap |
| work on rollover/Overflow, the Faite Loop's config, or its card/timeline affordances | **[FAITE-LOOP.md](docs/FAITE-LOOP.md)** |
| work on Overdrive — the Overflow triage overlay | **[OVERDRIVE.md](docs/OVERDRIVE.md)** |
| get it running on my machine | [Running locally](#running-locally) below, then **[SETUP.md](docs/SETUP.md)** |
| stand the infrastructure up again, or change a Cloudflare/OAuth/email setting | **[SETUP.md](docs/SETUP.md)** — the one-time runbook, plus what does and doesn't work locally |
| **add or rename a field**, or add an entity kind | **[SCHEMA-CHANGES.md](docs/SCHEMA-CHANGES.md)** first — a field is declared in four places and derived in three more. Then **[SCHEMA-OPS.md](docs/SCHEMA-OPS.md)** for the actual procedure |
| work on sync, the Durable Object, or the WebSocket | **[SYNC.md](docs/SYNC.md)** — state of the work, what's settled, known limits |
| work on sign-in, sessions, or account switching | **[AUTH.md](docs/AUTH.md)** — where each piece lives and how to operate it |
| change drag-and-drop | **[DRAG-AND-DROP.md](docs/DRAG-AND-DROP.md)** — self-contained working document |
| add a keyboard shortcut | **[KEYBOARD.md](docs/KEYBOARD.md)** — structure, guard model, how to add one |
| touch the ⌘K palette or search | **[COMMAND-PALETTE.md](docs/COMMAND-PALETTE.md)** |
| build the public API or MCP adapter | **[API.md](docs/API.md)** — not started; the design constraint to read *before* writing an endpoint |
| work on locations — free text, saved places, or the Google typeahead | **[LOCATION.md](docs/LOCATION.md)** — the three-layer model, the Worker proxy, and the cost rules that break silently |
| set up or re-key the Google Places API | **[GOOGLE-PLACES-SETUP.md](docs/GOOGLE-PLACES-SETUP.md)** — the one-time runbook. Do **not** referrer-restrict the key |
| work on email capture — forwarding mail into Backlog | **[EMAIL-INGEST.md](docs/EMAIL-INGEST.md)** — the flow, the trust model, and the privacy invariants |
| touch attachments, R2, or anything that moves file bytes | **[ATTACHMENTS.md](docs/ATTACHMENTS.md)** — the two-plane split, the ordering invariant, the limits and why they are not higher |
| add a marketing/legal/support page, or touch `SITE_PAGES`, sitemap, robots, or the contact form | **[SITE.md](docs/SITE.md)** — the route table, the metadata contract, and how to add a page |

Split by design: **rationale lives in ARCHITECTURE, setup in SETUP, operations
in the subsystem doc.** No file repeats another's reasoning — two copies drift,
and the stale one always wins the argument.

Working notes, not documentation:

- **[.ai/todo.md](.ai/todo.md)** — phase checklist, progress, and per-phase
  code reviews.
- **[.ai/lessons.md](.ai/lessons.md)** — mistakes worth not repeating. Read
  before a debugging session; several entries cost an hour each to learn.
- **[.ai/P4-PROGRESS.md](.ai/P4-PROGRESS.md)** — the P4 shipping record.

## Getting started

```bash
npm install
```

### Running locally

**You need both servers, in two terminals.** `next dev` serves the UI with hot
reload, but it never runs the worker entry (`src/server/worker.ts`) — so
`/api/auth/*` and `/api/sync/*` simply do not exist on :3000. Those only live
under the real Workers runtime.

```bash
npm run preview   # terminal 1 — builds, then serves the worker on :8787
npm run dev       # terminal 2 — UI with hot reload on :3000
```

Then open **http://localhost:3000**. `.env.local` points the auth client at
:8787, so you get hot reload *and* a working login.

Three things that will bite, in the order they usually do:

- **Sync does not work on :3000 — by design, and it fails silently.**
  `/api/sync/*` is fetched same-origin-relative, so on :3000 it 404s and the
  WebSocket handshake fails. The engine gives up quietly rather than nagging,
  because the board is local-first and genuinely fine without it — your edits
  are saved to IndexedDB, they just stay on that tab instead of reaching your
  account. **This is not a bug and push/pull is not broken.** Use :8787 when
  you need to verify real sync. See "Known limits" in
  [SYNC.md](docs/SYNC.md).
- **`npm run preview` does not hot-reload.** It builds once at startup, so any
  change under `src/server/` needs a full restart. A stale worker looks exactly
  like a bug that won't go away.
- **Local D1 is a different database from production.** Your production account
  does not exist locally — sign up fresh at http://localhost:3000/signup. Email
  verification is off on localhost, so signup logs you straight in.

### Which server do I want?

| | `npm run dev` (:3000) | `npm run preview` (:8787) |
|---|---|---|
| Hot reload | ✅ | ❌ rebuild + restart |
| UI, board, drag-and-drop | ✅ | ✅ |
| Login (`/api/auth/*`) | ✅ via :8787, cross-origin | ✅ |
| Sync (`/api/sync/*`, WebSocket) | ❌ silent no-op | ✅ |

Iterating on UI → :3000. Touching anything in `src/server/`, or verifying sync,
auth redirects, or the real runtime → :8787 alone. Full detail on what works
locally is in **[SETUP.md](docs/SETUP.md)**.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Next dev server on :3000 — UI only, no `/api/*` |
| `npm run preview` | the real Workers runtime on :8787 — all of `/api/*` |
| `npm test` | Vitest |
| `npm run verify` | typecheck (app + worker), lint, tests, **both** build targets |
| `npm run e2e:ci` | Playwright — the 53 tests a pull request runs |
| `npm run e2e` | Playwright — the full 89-test, five-device matrix |
| `npm run deploy` | build and deploy to Cloudflare Workers |

`npm run verify` is the gate to run before committing. It includes a static
export build that guards the future Capacitor target — if that fails, an app
route has taken a dependency on RSC data fetching, middleware, or
`next/image` optimization.

**`verify` deliberately excludes the E2E suite** — browser launch and a live
dev server add minutes a dev shouldn't pay on every run. CI runs it as a
separate job. A PR runs `e2e:ci` (desktop + one phone); the full matrix runs
locally or on demand, and is worth running before a large feature PR.
**[E2E.md](docs/E2E.md)** covers what runs where and why, §8–§9.

The `schema:*` and `auth:schema` scripts are the data-model toolchain
(generate, parity-check, inspect, reset). Do not run them from memory —
**[SCHEMA-OPS.md](docs/SCHEMA-OPS.md)** says which one, in what order, and
against which database.

## Status

Live and in use. **P0**–**P4** are shipped to production: scaffold and deploy,
the local-first main loop, auth, and sync between machines with WebSocket live
push ([.ai/P4-PROGRESS.md](.ai/P4-PROGRESS.md)).

In flight: **P5** (documented API + tokens — [docs/API.md](docs/API.md), not
started) and **P6** (fast-follow UI work), alongside ongoing schema work.
**P7** is Capacitor + MCP. Roadmap in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), checklist in
[.ai/todo.md](.ai/todo.md).
