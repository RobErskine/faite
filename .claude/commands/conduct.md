---
description: Conductor for an unattended worktree — build a dispatched ticket with subagents, verify, open the PR, post a review, stop before merge
---

You are the conductor in a fresh worktree, normally on Sonnet, started by
`/dispatch` from the main session. Nobody is watching. You coordinate; the
subagents in `.claude/agents/` do the work. You **never merge**, never
force-push, and never run `git reset`, `git stash`, or `git checkout --` on
work in progress — a git state you do not understand goes to §6.

Argument: `$ARGUMENTS` — the ticket, e.g. `EI-249`. With none, infer it from
`git branch --show-current`.

## 1. Pick up

Do §1 and §2 of `.claude/commands/pickup.md` — read the ticket and its
`## Handoff` comment, scan `.ai/lessons.md`, check the worktree
(`npm install && npm run dev:bootstrap` if `node_modules` or `.dev.vars` is
missing), fix the branch name if the slash is missing. Skip its §3: you do
not build; implementers do.

If the Handoff has no `## Steps` section, or a step names no files, do not
plan the work yourself — go to §6 with "not dispatchable: no step plan".

## 2. Build, step by step

For each step, start an `implementer` subagent and give it: the ticket id,
the step text exactly as written, its files, and its verify command.

- Run steps in parallel **only** when the Handoff marks them parallel. They
  share one working tree, so tell each parallel implementer to run only its
  step's test files and **not** `npm run typecheck`; run the typecheck
  yourself once all of them have finished. A failure there becomes a new step.
- Use `Explore` for any search you need; do not read the codebase yourself.
- Check each report against its step before starting the next. A step that
  reports success but changed files outside its list is a failure.

**Escalation.** When an implementer returns `ESCALATE:`, start a fresh
`implementer` with `model: "opus"` on the Agent call (a per-call model
outranks the agent's own), passing the step, the escalation report, and the
files already changed. If the Opus run escalates too, go to §6 — the step
needs a human decision, not a third try.

## 3. Verify the whole change — the same steps CI runs

```bash
npm run typecheck
npm test
npm run openapi:generate && git diff --exit-code openapi/
npm run lint
npm run build:static
npm run build
CI=1 E2E_PORT=3100 E2E_SERVER="npx next start -p 3100" npm run e2e:ci
```

Order matters: `build:static` leaves `.next` holding the app-shell render, so
`npm run build` must come after it and right before the e2e run
(`docs/WORKFLOW.md` §4). `CI=1` with a production server is how CI runs the
gate; bare `npm run e2e:ci` flakes locally and its failures are not real.

If the change touches auth, sync, the REST API, MCP, or anything under
`e2e/server/`, also run the server suite. First check that nothing else holds
the port — `lsof -nP -iTCP:8787 -sTCP:LISTEN` must print nothing; if it does,
another checkout's server would answer and the run would prove nothing, so
report it in §6 instead of running. Then:

```bash
npx opennextjs-cloudflare build --skipNextBuild
CI=1 E2E_SERVER="npx opennextjs-cloudflare preview" npm run e2e:server
```

A real failure goes back to an `implementer` as a new step, with the same
escalation rule. A failed `openapi` diff means the generated spec must be
committed: run the generator and include `openapi/` in the commit.

## 4. Commit, rebase, open the PR

```bash
git add -A && git commit -m "<type>(EI-nnn): <summary>"
git fetch -q origin && git rebase origin/main
git push -u origin "$(git branch --show-current)"
/opt/homebrew/bin/gh pr create --fill
```

Commit **before** the rebase; git refuses to rebase a dirty tree. If the
rebase brought in new commits, run §3 again before pushing. A conflict you
cannot resolve in a few lines: `git rebase --abort`, then §6. Conventional
Commits with the ticket as scope: `feat`, `fix`, `chore`, or `docs`. Use the
full `gh` path.

## 5. Review

Start the `pr-reviewer` subagent on the PR number and tell it to post. Then:

- Every `bug` or `rule` finding becomes an `implementer` step (same escalation
  rule), followed by §3 again and a new commit on the same branch. Push.
- One fix round only. Findings left after it go in the report.
- `nit` and `test` findings are listed in the report, not fixed.

## 6. Report and stop

Comment on the Linear ticket, headed `## Conductor report`:

- the PR link, or why there is none;
- each step: done, escalated to Opus, or blocked — with the reason;
- the checks from §3 and their results, and any you skipped;
- review findings fixed, and findings left open.

Move the ticket to **In Review** if a PR is open; leave its state alone if
blocked. Do not merge, do not close the ticket, do not delete the branch.
