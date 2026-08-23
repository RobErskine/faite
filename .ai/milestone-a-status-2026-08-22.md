# Milestone A — Public API + MCP: session summary, 2026-08-22

**Everything below is merged to `main` and deployed. Linear confirmed
up to date as of this writing.** Autonomous `/loop` session end-to-end:
7 planned tickets plus two follow-on features requested mid-session.

## What shipped, in order

| # | Ticket | PR | Notes |
|---|---|---|---|
| A1 | [EI-226](https://linear.app/rob-erskine/issue/EI-226) | [#47](https://github.com/RobErskine/faite/pull/47) | OpenAPI now documents the real surface. Split into `openapi/openapi.json` (internal) and `openapi/v1.json` (public). CI drift check wired in. |
| A4 | [EI-229](https://linear.app/rob-erskine/issue/EI-229) | [#48](https://github.com/RobErskine/faite/pull/48) | Durable server-side HLC via `sync_meta.server_last_hlc`, injectable `HlcPersistence`. |
| A2 | [EI-227](https://linear.app/rob-erskine/issue/EI-227) | [#49](https://github.com/RobErskine/faite/pull/49) | `auth-scopes.ts` gates every prefix by a key's actual `permissions`. `GET /api/v1/{todos,lists,labels,tabs}` added. Verified live: narrow key reads 200/writes 403, desktop key full access, revoked key 401. |
| A3 | [EI-228](https://linear.app/rob-erskine/issue/EI-228) | [#50](https://github.com/RobErskine/faite/pull/50) | Settings → API Keys panel (list/create/revoke, one-time key reveal). |
| A5 | [EI-230](https://linear.app/rob-erskine/issue/EI-230) | [#51](https://github.com/RobErskine/faite/pull/51) | `POST`/`PATCH /api/v1/todos`. Caught and fixed a real pre-merge data-clobbering bug — a static `.pick().partial()` silently expanded a sparse PATCH into a full-record overwrite. |
| A6 | [EI-52](https://linear.app/rob-erskine/issue/EI-52) | [#52](https://github.com/RobErskine/faite/pull/52) | Remote MCP server at `/mcp`, `createMcpHandler` (current SDK, not the deprecated `McpAgent`). `list_todos`/`create_todo`/`complete_todo` + `summarize_backlog` prompt. Fixed a version-field leak caught live pre-merge. 406-on-JSON-only-Accept fixed and verified; full SSE-framing removal for legacy-protocol-era traffic is a documented, not-fully-solved residual risk (see `docs/API.md`). |
| A7 | [EI-231](https://linear.app/rob-erskine/issue/EI-231) | [#53](https://github.com/RobErskine/faite/pull/53) | `/docs` renders `openapi/v1.json` via `@scalar/api-reference-react`, build-time spec import (required for the static Capacitor export target). Caught a real duplicate-`<h1>` bug via `e2e/marketing-pages.spec.ts` (Scalar renders its own heading from the spec title; the page had added a second one) — fixed by aligning `SITE_PAGES`'s title to Scalar's own, not fighting it. |
| A8 | [EI-236](https://linear.app/rob-erskine/issue/EI-236) *(filed retroactively)* | [#54](https://github.com/RobErskine/faite/pull/54) | Added `description` to lists, mirroring `tabSchema.description` exactly: nullable text, edited via the list's info dialog, surfaces automatically in `GET /api/v1/lists` and `openapi/v1.json` (schema-driven, no separate wiring). |
| A9 | [EI-237](https://linear.app/rob-erskine/issue/EI-237) *(filed retroactively)* | [#55](https://github.com/RobErskine/faite/pull/55) | MCP tool coverage brought to parity with `/api/v1` plus two convenience reads: `list_lists`, `list_labels`, `list_tabs`, `update_todo`, `get_backlog`, `get_overflow`, `get_profile` — 10 tools total. Caught a real bug live (a fresh account's missing Settings row crashed `get_profile`/`get_overflow`) via an actual MCP client against a real `wrangler dev` instance, not just unit tests. |

## What Milestone A actually delivered

1. **Every real endpoint documented, kept documented by CI** (A1) — OpenAPI
   3.1 for the actual surface (`/api/sync`, `/api/places`, `/api/desktop`,
   `/api/email`, `/api/contact`, `/api/auth`, `/api/v1`), drift-checked in CI.
2. **Users mint their own scoped API keys from Settings** (A2 + A3) — real
   scope enforcement (`read`/`write`/`sync`/`places`), a Settings UI to
   create/revoke them, with the desktop shell's full-access key protected by
   a migration-safety fallback.
3. **Todos createable/updatable outside the Faite app** (A5) — `POST`/`PATCH
   /api/v1/todos`, routed through the real CRDT push pipeline, not a
   side-channel write.
4. **A remote MCP server** (A6, then extended) — `/mcp`, Streamable HTTP,
   10 tools covering everything `/api/v1` can do plus Backlog/Overflow/
   profile reads with no REST equivalent. Ready for Pointer (EI-221) to
   consume — see below, this now unblocks a *different* project's ticket.
5. **Published public docs** (A7) — `/docs`, interactive, generated from the
   same spec CI already drift-checks.
6. **List descriptions** (follow-on) — context a human or an MCP client can
   use to decide where a to-do belongs; nothing routes on it automatically
   yet.

Plus A4 (durable server HLC), a correctness fix A5 depended on with no
user-facing surface of its own.

## Cross-project note

Faite's MCP server (A6) is the connector [Pointer's EI-225 "P7 — Breadth:
additional connectors, config-only"](https://linear.app/rob-erskine/issue/EI-225)
names as a prerequisite: *"Faite `mcp` connector, once Faite ships its own
MCP server... binds the already-configured `capture_todo` intent."* That
prerequisite is now satisfied — worth flagging next time Pointer work comes
up, not something this session touched.

## Residual risks worth re-checking, not blockers

- **MCP SSE framing** (A6): every test request negotiated the "legacy"
  (2025-11-25) protocol era, where `responseMode: 'json'` has no effect —
  documented in `docs/API.md`, not solved. Worth a real check once Pointer
  (EI-221/EI-234) is an actual client, not a hand-rolled test script.
- **Bundle size growth** (A7): Worker upload went from ~13.0 MB to ~19.5 MB
  (gzipped ~4.06 MB) after adding Scalar. Dry-run deploy succeeds and
  Cloudflare's limit is far higher, but worth knowing before adding another
  heavy client-only dependency.

## Verification bar used for every ticket

```bash
npm run typecheck && npx vitest run && npm run lint
npm run build && npm run build:static
npx opennextjs-cloudflare build && npx wrangler deploy --dry-run
npm run openapi:generate && git diff --exit-code openapi/
```

Plus, for anything touching auth/scopes/writes/MCP tools: a real `wrangler
dev` session against a signed-up test user (or, for the MCP tickets, a real
`@modelcontextprotocol/client` connection) — never just unit tests. Two of
the real bugs this session caught (A5's clobbering PATCH, the MCP-tools
follow-on's Settings-fallback crash) were only visible against a live
Durable Object, not in vitest.

## Linear

All 7 milestone tickets are `Done`, GitHub-PR-linked automatically via
Linear's integration (no manual status flips were needed — the connection
merely being unreachable mid-session never left anything stale). The two
follow-on features (list description, MCP full coverage) had no ticket at
the time they shipped — they were scoped and built directly from chat
requests — so EI-236 and EI-237 were filed retroactively, marked `Done`,
and linked to their PRs once Linear reconnected.

## Branch/PR hygiene followed throughout

Each ticket: `git checkout -b <branch> origin/main` (fetching main fresh
each time — every branch, including the two follow-ons, correctly started
from the *updated* main rather than stacking on prior work), implement,
verify, push, `gh pr create`, wait for CI via a background Monitor, squash
merge, delete the remote branch. `gh pr merge --delete-branch` reliably
failed on a local-worktree-conflict error in this environment (`main` is
checked out in a sibling worktree) — the merge itself always succeeded on
GitHub regardless; confirmed via `gh pr view --json state,mergedAt` and
cleaned up the remote branch with `gh api -X DELETE .../git/refs/heads/...`
each time. No real merge conflicts across all 9 PRs.
