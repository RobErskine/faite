---
description: Conductor for an unattended worktree — build a dispatched ticket with subagents, verify, open the PR, post a review, stop before merge
---

You are the conductor in a fresh worktree, normally on Sonnet, started by
`/dispatch` from the main session. Nobody is watching. You coordinate; the
subagents in `.claude/agents/` do the work. You **never merge**.

Argument: `$ARGUMENTS` — the ticket, e.g. `EI-249`. With none, infer it from
`git branch --show-current`.

## 1. Pick up

Do everything in `.claude/commands/pickup.md`: read the ticket and its
`## Handoff` comment, scan `.ai/lessons.md`, check the worktree
(`npm install && npm run dev:bootstrap` if `node_modules` or `.dev.vars` is
missing), fix the branch name if the slash is missing.

If the Handoff has no `## Steps` section, or a step names no files, do not
plan the work yourself — go to §6 with "not dispatchable: no step plan".

## 2. Build, step by step

For each step, start an `implementer` subagent and give it: the ticket id,
the step text exactly as written, its files, and its verify command.

- Run steps in parallel **only** when the Handoff marks them parallel; they
  share one working tree, so two agents editing one file corrupt each other.
- Use `Explore` for any search you need; do not read the codebase yourself.
- Review each report against its step before starting the next. A step that
  reports success but changed files outside its list is a failure.

**Escalation.** When an implementer returns `ESCALATE:`, start a fresh
`implementer` with `model: "claude-opus-5-5"` on the Agent call (it outranks
the agent's own model), passing the step, the escalation report, and the
files already changed. If the Opus run escalates too, go to §6 — the step
needs a human decision, not a third try.

## 3. Verify the whole change

```bash
npm run typecheck
npm test
npm run lint
npm run build
CI=1 E2E_PORT=3100 E2E_SERVER="npx next start -p 3100" npm run e2e:ci
```

The e2e line is the CI gate run the way CI runs it (`docs/WORKFLOW.md` §4);
bare `npm run e2e:ci` flakes locally and its failures are not real. A real
failure goes back to an `implementer` as a new step, with the same
escalation rule. If the change touches auth, sync, the REST API, or MCP, also
run `npm run e2e:server`.

## 4. Commit and open the PR

```bash
git fetch -q origin && git rebase origin/main
git add -A && git commit -m "<type>(EI-nnn): <summary>"
git push -u origin "$(git branch --show-current)"
/opt/homebrew/bin/gh pr create --fill
```

Conventional Commits with the ticket as scope; `feat`, `fix`, `chore`, or
`docs`. Rebase conflicts you cannot resolve in a few lines go to §6. Use the
full `gh` path.

## 5. Review

Start the `pr-reviewer` subagent on the PR number and tell it to post. Then:

- Every `bug` or `rule` finding becomes an `implementer` step (same escalation
  rule), followed by §3 again and a new commit on the same branch. Push.
- Do not loop: one fix round only. Findings left after it go in the report.
- `nit` and `test` findings are listed in the report, not fixed.

## 6. Report and stop

Comment on the Linear ticket, headed `## Conductor report`:

- the PR link, or why there is none;
- each step: done, escalated to Opus, or blocked — with the reason;
- the checks from §3 and their results;
- review findings fixed, and findings left open.

Move the ticket to **In Review** if a PR is open; leave its state alone if
blocked. Do not merge, do not close the ticket, do not delete the branch.
