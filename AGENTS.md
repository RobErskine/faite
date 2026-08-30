<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# End-to-end tests and CI

**Adding an `e2e/*.spec.ts` file is not enough to make it run.** Which device
projects a spec runs under is declared by `testMatch` in
`playwright.config.ts` — a spec named by no project runs under *zero* of them
and passes by saying nothing. `e2e/config-coverage.test.ts` fails `npm test`
if you forget, so the mistake is caught in seconds, but only if you don't
"fix" it by deleting the guard. Never gate a spec with a runtime
`test.skip(project.name !== ...)`; that was removed deliberately.

**A pull request does not run the whole suite.** `npm run e2e:ci` — the gate
— runs `desktop` + `phone-iphone` (90 of 129 tests). Those two are the
cheapest pair that renders both board shells, because `resolveLayout()`
(`src/lib/use-viewport.ts`) puts everything ≥640px on `DesktopBoard`. The
other three projects run via `npm run e2e` locally, or the `CI` workflow's
`workflow_dispatch` with `e2e: full`. Run the full matrix locally before
opening a large feature PR.

**CI minutes are metered and small.** This repo is private on GitHub Free:
2,000 minutes a month, and a single hung step once burned 360 of them.
Before adding a job, a matrix leg, or a workflow trigger, cost it in *billed
runner-minutes* (each job rounds **up** to the whole minute, and parallel
jobs each bill in full) — not in wall clock. The two are opposite: sharding
this suite three ways made it faster and 27% more expensive. Every job needs
a `timeout-minutes`.

The reasoning behind all of the above, with the measurements, is
`docs/E2E.md` §8 (what runs where, and the coverage traded for time) and §9
(why CI serves a production build while local serves `next dev`). Read those
before changing `playwright.config.ts` or `.github/workflows/ci.yml`.

# Keyboard shortcuts

Any new keyboard shortcut — global or local — must be registered in
`src/lib/shortcuts.ts` (a global entry is derived automatically from the
`Hotkey[]` registry in `use-board-ui-state.ts`; a local one needs a hand-added
`LOCAL_SHORTCUTS` entry with a `source`) and reflected in `docs/KEYBOARD.md`
§1. The `?` help sheet and the `⌘K` palette both read from `shortcuts.ts` —
a shortcut left out of it is invisible to users who go looking for it. See
`docs/KEYBOARD.md` §5 for the full recipe.

# Issues live in Linear, not GitHub

This project tracks work in **Linear**, not GitHub Issues. Workspace
`rob-erskine`, team **Erskine Interactive**, project **Faite**, ticket prefix
**`EI-`**. GitHub holds pull requests and CI, and nothing else — its issue
tracker is empty and always will be.

So any instruction to "search issues", "find related issues", or "check for
tickets this fixes" means the **Linear MCP** (`list_issues` with
`project: "Faite"`), never `gh issue list`. Running `gh issue list` here returns
nothing and the honest-looking conclusion — "no open issues" — is false; there
are 250+. If the Linear MCP is unavailable, **say that it is unavailable**.
Never report an empty result you did not actually get.

# Where the context lives

- **`docs/README.md`** — index of every doc. Start there, not with a grep.
- **`docs/ARCHITECTURE.md`** — the *why* behind the data model and sync.
- **`docs/WORKFLOW.md`** — how a ticket becomes a merged PR, and how to hand a
  session off to a worktree.
- **`.ai/lessons.md`** — mistakes already made here, with the rule each one
  produced. Read it before a non-trivial change; `docs/SYNC.md` calls it
  "not optional".
- **`.ai/todo.md`** — the append-only build log. Read it for history. **Never
  write a plan into it** — a per-batch plan goes in `.ai/<slug>-runbook.md`.

# Ticket → branch → PR → merge

Branch name is Linear's own `gitBranchName`, verbatim (`rob/ei-249-…`). Commit
subjects are Conventional Commits with the ticket as the scope —
`feat(EI-242): …`, `fix(EI-238): …`, and `feat(EI-244/EI-245): …` when one PR
closes two tickets.

**Squash merge.** Older history has merge commits and one retrospective still
recommends them; that is out of date, and PRs #43 onward are all squashes.

`npm run e2e:ci` is the CI gate. `npm run verify` is a broader local check and
is **not** the gate — passing it proves nothing about what CI will do. See
`docs/WORKFLOW.md` for the full loop.
