# Faite

A weekly-planner todo app. *Faite* is "done" in French — the double meaning is
the point: you control your fate by getting things done.

Live: https://myfaite.app

The UI is two horizontal halves, and dragging between them is the whole app.
The top half is a day-by-day calendar plus an **Overflow** column; the bottom
half is your lists. Capture into a list, then drag up onto a day to commit to
doing it. Missed items roll forward, and after a few rolls fall into Overflow —
if something has been put off that long, it probably was not important.

Local-first: everything reads and writes to IndexedDB, so it works offline and
no request is ever on the interaction path.

## Docs

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — decisions and their
  rationale, stack, layout, scheduling rules, build gotchas, roadmap.
- **[docs/DRAG-AND-DROP.md](docs/DRAG-AND-DROP.md)** — self-contained working
  document for the drag-and-drop system.
- **[docs/KEYBOARD.md](docs/KEYBOARD.md)** — how shortcuts are structured, the
  guard model, and how to add one.
- **[docs/COMMAND-PALETTE.md](docs/COMMAND-PALETTE.md)** — the ⌘K palette and
  search: current surface, the cmdk filtering constraint, and where to take it.
- **[.ai/todo.md](.ai/todo.md)** — phase checklist and progress.
- **[.ai/lessons.md](.ai/lessons.md)** — mistakes worth not repeating.

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
:8787, so you get hot reload *and* a working login. Two things that will bite:

- **`npm run preview` does not hot-reload.** It builds once at startup, so any
  change under `src/server/` needs a full restart. A stale worker looks exactly
  like a bug that won't go away.
- **Local D1 is a different database from production.** Sign up fresh at
  http://localhost:3000/signup; email verification is off on localhost.

`npm run preview` also works standalone on http://localhost:8787 — no hot
reload, but sync works there, which it does not on :3000. Full detail, including
what does and doesn't work locally, is in **[docs/SETUP.md](docs/SETUP.md)**.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Next dev server on :3000 — UI only, no `/api/*` |
| `npm run preview` | the real Workers runtime on :8787 — all of `/api/*` |
| `npm test` | Vitest |
| `npm run verify` | typecheck (app + worker), lint, tests, **both** build targets |
| `npm run deploy` | build and deploy to Cloudflare Workers |

`npm run verify` is the gate to run before committing. It includes a static
export build that guards the future Capacitor target — if that fails, an app
route has taken a dependency on RSC data fetching, middleware, or
`next/image` optimization.

## Status

**P0** (scaffold + deploy) and **P1** (local-first main loop) are shipped.
Next up is **P2** (auth) and **P3** (sync between machines). See the roadmap in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
