# How work moves: ticket → branch → PR → merge

This is the procedure. The *rules* summary lives in `AGENTS.md`; this file is
the long form, including the parts that are only obvious after you have got
them wrong.

## 1. Linear is the tracker

Workspace `rob-erskine`, team **Erskine Interactive**, project **Faite**,
prefix **`EI-`**. GitHub Issues is unused — see `AGENTS.md`.

Milestones use letter axes rather than continuing the `P0`–`P7` roadmap:
**A** (public API + MCP), **M** (mobile), **D** (desktop shell), **S** (site
and legal). A ticket's milestone tells you which doc holds its rationale —
`docs/API.md`, `docs/MOBILE.md`, `docs/DESKTOP.md`, `docs/SITE.md`.

Two Linear habits worth keeping:

- `get_issue` results are cached. If you are about to report status, or you
  believe a ticket moved, fetch it again rather than trusting what you read
  earlier in the session.
- Write the *reasoning* into the ticket, not only into the code. Half the
  useful history in this repo is in Linear, and it is the only half a fresh
  worktree can see.

## 2. Brainstorm in one session, build in another

The usual shape is: think it through on `main`, file a ticket, then build in a
worktree. There are two ways to carry the context across, and picking the wrong
one is what makes this feel confusing.

### Continuing *this* conversation → `move_session`

```
mcp__jean__create_worktree({ projectId, customName: "<Linear gitBranchName>" })
mcp__jean__move_session({ sessionId, targetWorktreeId })
```

`move_session` preserves the session id, the whole message history,
attachments, settings, and the backend's resume context. The move is
*scheduled*: a running session lands in the worktree after the current turn
ends. Call it, then finish the turn. Do not retry it and do not cancel the run.

Get both ids from `mcp__jean__get_current_context` and the `create_worktree`
result.

**Do not reach for `EnterWorktree`.** A Jean worktree is outside the session's
write scope, and `EnterWorktree({ path })` is supposed to fix that, but it has
returned its approval prompt indefinitely without ever widening the scope. Two
identical prompt returns means stop, not retry.

### Handing off to a *fresh* session → a Linear comment

When someone or something else will pick the work up, put the handoff in a
**comment on the ticket**, headed `## Handoff`.

The reason is mechanical: `.ai/*.md` notes are untracked, and a new worktree is
a clean checkout of `origin/main`, so **an untracked handoff file does not
exist there**. Linear is the only carrier that crosses the boundary for free.
A handoff comment should carry the decisions and the facts that were expensive
to establish — not a restatement of the ticket:

- decisions taken, and what was rejected, with the reason
- facts verified against the code (exact table and column names, exact exports,
  file paths) so they do not have to be rediscovered
- what is explicitly out of scope
- how the result will be verified

Then start the new session with one line: *"Work EI-249. Read the ticket and
its Handoff comment first."* Everything else is recoverable from Linear and the
repo. `/handoff` and `/pickup` in `.claude/commands/` automate both ends.

### Naming

Pass Linear's `gitBranchName` as `customName`. Jean has no Linear API key, so
`create_worktree`'s `linearIssueIdentifier` parameter fails — use `customName`.

Jean has historically dropped the `/` from a branch name (`rob/foo` →
`robfoo`); recent worktrees keep it. So it is inconsistent: run
`git branch --show-current` once, and only rename if it is wrong. If it is,
`git branch -m <actual> <intended>` **before the first push** — otherwise the
push fails with `error: src refspec ... does not match any`, which reads like a
credentials problem and is not one.

## 3. A new worktree is emptier than it looks

`node_modules/`, `.wrangler/`, `.dev.vars` and `.open-next/` are all
git-ignored, so none of them cross over:

```bash
npm install
npm run dev:bootstrap     # local D1 + a verified test account (EI-249)
```

`docs/SETUP.md` §"First run in a new checkout or worktree" has the detail.
Without the second command, the first query hits an empty database and fails
with "no such table", which looks like a code bug.

## 4. Build, then verify

- `npm run typecheck` — and run it **again** after writing tests. Vitest's
  esbuild transform does not type-check, so a test file can pass while failing
  `tsc`.
- `npm run e2e:ci` — the actual CI gate: `desktop` + `phone-iphone`.
- `npm run verify` — broader, slower, and **not** the gate.
- A new `e2e/*.spec.ts` must be named by a `testMatch` in
  `playwright.config.ts` or it runs under zero projects and passes silently.
  See `AGENTS.md` and `docs/E2E.md` §8.

## 5. PR and merge

Fetch and rebase on `origin/main` **before** opening the PR — the primary
checkout drifts, and rebasing at report time is too late.

```bash
git push -u origin <branch>
gh pr create --fill
```

Squash merge. `gh pr merge --delete-branch` fails while `main` is checked out
in a sibling worktree, so delete the remote branch as its own step
(`git push origin --delete <branch>`).

Afterwards: comment the PR link on the ticket, move the ticket to Done, and add
anything that cost real debugging time to `.ai/lessons.md` as a rule.

## 6. Before you say you are finished

Search Linear — not GitHub — for tickets this work closes, relates to, or
duplicates, and label each one honestly. Do not close a ticket unless the work
fully satisfies it, and do not change ticket state unless asked.
