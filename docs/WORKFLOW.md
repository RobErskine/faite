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

### Handing off to an *unattended* session → `/dispatch`

When the design is settled and you want the work done without you, run
`/dispatch` instead of `/handoff`. It adds a `## Steps` plan to the Handoff
comment — each step one `implementer` run with exact files and a verify
command — then creates the worktree and a session on Sonnet in `auto` mode,
and tells it to follow `.claude/commands/conduct.md`. The conductor builds,
runs the CI gate, opens the PR, has `pr-reviewer` post a review, fixes what
the review finds once, and reports on the ticket. It never merges. §7 says
which model does what.

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
npm run dev:full          # both servers, one terminal (EI-249)
```

`docs/SETUP.md` §"First run in a new checkout or worktree" has the detail.
Without the second command, the first query hits an empty database and fails
with "no such table", which looks like a code bug.

## 4. Build, then verify

- `npm run typecheck` — and run it **again** after writing tests. Vitest's
  esbuild transform does not type-check, so a test file can pass while failing
  `tsc`.
- `npm run e2e:ci` — the actual CI gate: `desktop` + `phone-iphone`. Run bare,
  it flakes badly and the failures are not real: locally Playwright uses
  `next dev` with one worker per core, which starves a server that compiles on
  demand. To reproduce what CI actually runs, serve a production build instead:

  ```bash
  npm run build
  CI=1 E2E_PORT=3100 E2E_SERVER="npx next start -p 3100" npm run e2e:ci
  ```

  `E2E_PORT` matters because `CI=1` turns off `reuseExistingServer`, so a dev
  server already on :3000 aborts the run. **Do not believe a local e2e failure
  until it survives this command**, or `--workers=1`. `docs/E2E.md` §9 has the
  measurements.

  **`npm run build` on the first line is not optional, and skipping it after
  `npm run verify` fails in a way that looks like a real bug.** `verify` runs
  `build` and then `build:static`, and the second one leaves `.next` holding
  the **app-shell** render — where `/` is nothing but
  `window.location.replace("/board")`. `next start` then serves that, so every
  homepage spec fails with the board's welcome dialog in the snapshot and
  headings that are "not found" because the page under test never rendered.
  Seven failures, none of them real. Rebuild the web target first.
- `npm run verify` — broader, slower, and **not** the gate. It is a convenience
  script, not a mirror of `.github/workflows/ci.yml`; read the workflow's step
  list before claiming a change is CI-clean.
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

## 7. Which model does the work

Opus is the main session: it plans, decides, reviews, and takes work back.
The cheaper models do what is already decided. Four project subagents in
`.claude/agents/` carry the routing (EI-398):

| Agent | Model | Use it for |
|---|---|---|
| `Explore` | Haiku | Search and reading. This **replaces** Claude Code's built-in `Explore`, which otherwise runs on the main session's model — so every existing Explore call got cheaper without anyone changing habits. |
| `implementer` | Sonnet, effort `medium` | One ticket or runbook step whose design is settled. |
| `ticket-writer` | Sonnet, effort `medium` | Filing Linear tickets from a plan. Searches for duplicates first. |
| `pr-reviewer` | Opus, effort `high` | Reviewing a PR or branch against the rules in `AGENTS.md`. Read-only; posts one GitHub review only when told to post. |

**Escalation is triggered by evidence, not by a guess.** The implementer
stops with `ESCALATE:` when the typecheck or a test still fails after its
second fix, or when the spec reads two ways. The caller then re-runs it with
`model: "claude-opus-5-5"` on the Agent call — a per-call model outranks the
agent's frontmatter — and if Opus escalates too, the step needs a person. In
an interactive session the main session can also just finish the work
itself. Guessing a
task's difficulty from its ticket before anyone has read the code was
considered and rejected — the ticket rarely shows it.

Per-token prices when this was set up (2026-10, Anthropic API): Opus 5.5
$4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million input/output. So
Sonnet halves the cost, and Haiku is about forty times cheaper — moving search
to Haiku is most of the saving. Fable 5.1 ($10/$50) is for an architecture
decision someone asks for by name, not for routine planning.

The frontmatter names full model IDs (`claude-haiku-5-5`, not `haiku`). An
alias resolves to whatever generation the installed Claude Code knows: the
older CLI that Jean ships in its app bundle (2.1.220) mapped `sonnet` to
Sonnet 5 and `haiku` to Haiku 4.5, and could not run `claude-opus-5-5` at all.
Jean starts sessions with `~/.local/bin/claude`, which is current.

Three things are deliberately left alone:

- `general-purpose` and the globally installed plugin agents still inherit the
  main model. `CLAUDE_CODE_SUBAGENT_MODEL` would move them; measure with
  Jean's usage view before turning it on.
- A per-call `model` on the Agent tool outranks an agent's frontmatter, so the
  main session can still send a hard search to Opus.
- Jean's Magic Prompts (commit message, PR description, review) choose their
  own model in Jean's settings, not in this repo. Set the short-generation
  ones to Sonnet or Haiku there.
