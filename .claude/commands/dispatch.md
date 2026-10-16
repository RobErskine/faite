---
description: Hand a brainstormed plan to an unattended worktree session — ticket, step plan, worktree, and a Sonnet conductor that builds it, opens the PR, and posts a review
---

Run this in the main session (Opus, on `main`) once a plan is settled. It is
`/handoff` with one more step: instead of you opening the worktree, a conductor
session on Sonnet runs `.claude/commands/conduct.md` there and stops at an open
PR with a posted review. You merge. `docs/WORKFLOW.md` §7 explains the routing.

Argument (optional): `$ARGUMENTS` — an existing ticket like `EI-249`, or a short
description. With no argument, infer both from this conversation.

## 1. Is it ready to dispatch?

The conductor is Sonnet and nobody will be there to answer it. Dispatch only
when the design is decided: what to build, which files, how to verify it. If a
real decision is still open, say which one and stop — answer it here first.

## 2. The ticket

Fetch the `EI-` ticket, or create one (team **Erskine Interactive**, project
**Faite**) after searching for a duplicate — the `ticket-writer` agent does
both. Move it to **In Progress**.

## 3. The handoff comment — this is the conductor's whole brief

Add one comment headed `## Handoff`, as `/handoff` §2 describes (decisions and
what was rejected, facts verified against the code, out of scope, how it is
verified), then add a section the conductor executes literally:

```markdown
## Steps
1. <what> — files: `path/a.ts`, `path/b.test.ts` — verify: `npx vitest run path/b.test.ts`
2. …

Parallel: 1 and 3 touch no file in common. 2 waits for 1.
Done when: <the observable result>, and `npm run e2e:ci` passes.
```

Each step must fit one `implementer` run. Name files exactly. Steps that share
a file are never parallel. This is where Opus earns its price: a vague step
becomes a Sonnet guess.

## 4. The worktree and the conductor

```
mcp__jean__create_worktree({ projectId, customName: "<gitBranchName>" })
mcp__jean__create_session({ worktreeId, backend: "claude", name: "Conductor <EI-nnn>" })
mcp__jean__set_session_settings({ sessionId, model: "claude-sonnet-5-5",
  executionMode: "auto", effortLevel: "medium" })
mcp__jean__send_chat_message({ sessionId,
  message: "Conduct <EI-nnn>. Follow .claude/commands/conduct.md exactly." })
```

Use `customName`, never `linearIssueIdentifier` (Jean has no Linear key). Use
the full model ID, not `sonnet` (§7 says why). `auto` lets the session run
without stopping for each command while still blocking destructive ones.

## 5. Report

Ticket URL, branch, worktree path, conductor session id, and the steps you
dispatched. Then the user can watch it in Jean, or come back to a PR.
