# Faite

A weekly-planner todo app. *Faite* is "done" in French — the double meaning is
the point: you control your fate by getting things done.

Live: https://faite.bfmw-dev.workers.dev

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
npm run dev
```

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Next dev server |
| `npm test` | Vitest (64 tests) |
| `npm run verify` | typecheck (app + worker), lint, tests, **both** build targets |
| `npm run preview` | run the real Workers runtime locally |
| `npm run deploy` | build and deploy to Cloudflare Workers |

`npm run verify` is the gate to run before committing. It includes a static
export build that guards the future Capacitor target — if that fails, an app
route has taken a dependency on RSC data fetching, middleware, or
`next/image` optimization.

## Status

**P0** (scaffold + deploy) and **P1** (local-first main loop) are shipped.
Next up is **P2** (auth) and **P3** (sync between machines). See the roadmap in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
