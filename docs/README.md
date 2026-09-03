# Docs index

Every file in `docs/`, one line each. The root [README](../README.md) has a
task-shaped version of this ("I want to… → read…") covering the most common
starting points; this is the complete list.

Two conventions run through all of it: **rationale lives in `ARCHITECTURE.md`,
procedure lives in the subsystem doc**, and no file repeats another's
reasoning — two copies drift, and the stale one always wins the argument.

## Start here

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The one source of *why*. Stack, local-first store, `mutate()`, field-level LWW, fractional ordering, auth and routing, roadmap P0–P7. |
| [WORKFLOW.md](WORKFLOW.md) | Ticket → branch → PR → merge. Linear conventions, handing a session off to a worktree, the fresh-worktree checklist. |
| [SETUP.md](SETUP.md) | One-time infrastructure runbook (DNS, Worker domain, email, OAuth, secrets), plus local development and what does not work locally. |

## Data, sync, and schema

| Doc | Covers |
|---|---|
| [SCHEMA-CHANGES.md](SCHEMA-CHANGES.md) | Read **before** adding or renaming a field: it is declared in four places and derived in three more. |
| [SCHEMA-OPS.md](SCHEMA-OPS.md) | The procedure for actually running a schema change, local and production. "Tinker mode" vs "locked mode". |
| [SYNC.md](SYNC.md) | Push/pull, the Durable Object, the WebSocket. What is settled, and the limits deliberately accepted. |
| [AUTH.md](AUTH.md) | Sign-in, sessions, account switching — where each piece lives and how to operate it. Rationale is in ARCHITECTURE §2.12–2.13. |
| [API.md](API.md) | The public API and MCP adapter: token model, scopes, the two OpenAPI documents, `/api/v1` routes. |
| [ATTACHMENTS.md](ATTACHMENTS.md) | Files on a to-do over R2 — the JSON/bytes two-plane split, the ordering invariant, and why the limits are not higher. |
| [EMAIL-INGEST.md](EMAIL-INGEST.md) | Forwarding mail into Backlog: Email Routing → `worker.ts email()` → DO push, with the trust and privacy invariants. |

## The board

| Doc | Covers |
|---|---|
| [FAITE-LOOP.md](FAITE-LOOP.md) | The product's core mechanic — rollover to today, then Overflow. Config, computation, visibility. |
| [OVERDRIVE.md](OVERDRIVE.md) | The Overflow triage overlay: keyboard and thumb burn-down, writing only through existing repositories. |
| [DRAG-AND-DROP.md](DRAG-AND-DROP.md) | The dnd-kit model across the calendar and planning halves. Includes deliberate non-bugs and reverted "improvements" — read before changing drag behaviour. |
| [COMMAND-PALETTE.md](COMMAND-PALETTE.md) | ⌘K and search: cmdk's re-filtering constraint, row actions, quick-add tokens. |
| [KEYBOARD.md](KEYBOARD.md) | The shortcut catalog and guard model. §5 is the recipe for adding one — required reading, per `AGENTS.md`. |
| [DAY-NOTES.md](DAY-NOTES.md) | The day sheet's timeline filter and the BlockNote notes editor. |
| [LINK-PREVIEW.md](LINK-PREVIEW.md) | Link preview cards in the Notes field, and the card/inline toggle. |
| [REMINDERS.md](REMINDERS.md) | Reminder presets — the tenth sync kind, the typeahead, settings and seeds. |
| [LOCATION.md](LOCATION.md) | The three-layer location model: free text → saved `Place` → Google lookup through a Worker proxy. |
| [AT-MENTION.md](AT-MENTION.md) | The reusable inline `@list` / `#label` picker: pure logic in `lib/mention.ts`, UI in `mention-menu.tsx`. |
| [PICKERS.md](PICKERS.md) | `LocationField` vs `LabelPicker` — Base UI Autocomplete vs Combobox, and how to choose. |

## Surfaces

| Doc | Covers |
|---|---|
| [MOBILE.md](MOBILE.md) | Mobile responsiveness, phases M-1…M6. A separate axis from P0–P7. |
| [GESTURES.md](GESTURES.md) | PhoneBoard's touch model, and why it is CSS scroll-snap rather than a JS carousel. |
| [RESIZE-UI.md](RESIZE-UI.md) | The draggable seam between the calendar and planning halves. |
| [DESKTOP.md](DESKTOP.md) | The Tauri v2 desktop shell, milestones D0–D6 — including hot asset bundles (§14), which is how a web deploy reaches an installed `.app`. |
| [DESKTOP-SYNC-TIMER-SPIKE.md](DESKTOP-SYNC-TIMER-SPIKE.md) | The D2 spike: hidden-webview `setInterval` death and three measured mitigations. |
| [SITE.md](SITE.md) | Marketing, legal and support pages: the `SITE_PAGES` table, the metadata contract, static-export constraints. |
| [RESEARCH.md](RESEARCH.md) | The cited evidence base for marketing claims — verbatim quote, relevance, primary link, and the claims we deliberately do not make. |

## Build and operations

| Doc | Covers |
|---|---|
| [E2E.md](E2E.md) | The Playwright suite. §8 is what runs where and the coverage traded for time; §9 is why CI serves a production build. |
| [APP-ICON.md](APP-ICON.md) | The icon pipeline. `assets/icons/icon.svg` is the single source — never hand-edit a derived asset. |
| [GOOGLE-PLACES-SETUP.md](GOOGLE-PLACES-SETUP.md) | One-time Google Cloud/Places key runbook. Do **not** referrer-restrict the key. |

## Not in `docs/`

| Path | Covers |
|---|---|
| [`AGENTS.md`](../AGENTS.md) | The rules an agent must not break. `CLAUDE.md` is a one-line import of it. |
| `.ai/lessons.md` | Mistakes already made here, each with the rule it produced. `SYNC.md` calls reading it "not optional". |
| `.ai/todo.md` | The append-only build log. History only — plans go in `.ai/<slug>-runbook.md`, never here. |
| `.ai/*-runbook.md` | Per-batch execution plans, written for zero-context handoff. Point-in-time and disposable. |
| `scripts/*/README.md` | Each script directory documents its own setup, run and cleanup. |
