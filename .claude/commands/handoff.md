---
description: Turn this brainstorm into a Linear ticket and a worktree, and carry the context across
---

Run this in the main session, on `main`, after we have talked something through
and want to start building it.

Argument (optional): `$ARGUMENTS` — an existing ticket like `EI-249`, or a short
description of the idea. With no argument, infer both from this conversation.

Read `docs/WORKFLOW.md` §2 first; it explains why each step is what it is.

## 1. The ticket

If the argument is an `EI-` identifier, fetch it with `get_issue`. Otherwise
create one with `save_issue` — team **Erskine Interactive**, project **Faite** —
with a description that states the problem and the evidence for it, not just
the proposed fix. Link related tickets with `relatedTo`.

## 2. The handoff comment

Add a comment on the ticket headed `## Handoff`. This is the part that survives
the jump to a fresh session, so put in it what would be expensive to rediscover:

- decisions taken, and what was rejected, with the reason
- facts verified against the actual code — exact table and column names, exact
  exports, file paths — so nobody re-derives them
- what is explicitly out of scope
- how the result will be verified

Do not restate the ticket description. If something is already in the ticket,
leave it there.

## 3. The worktree

Read `gitBranchName` off the ticket and pass it as `customName`:

```
mcp__jean__create_worktree({ projectId, customName: "<gitBranchName>" })
```

Do not use `linearIssueIdentifier` — Jean has no Linear API key and it fails.

## 4. Carry the context

If we want *this* conversation to continue in the worktree, call
`mcp__jean__move_session({ sessionId, targetWorktreeId })` and then **end the
turn** — the move is scheduled and lands after the turn finishes. Do not retry
it, and do not use `EnterWorktree`.

If a fresh session will pick it up instead, print the one-line prompt to paste
there:

> Work `<EI-nnn>`. Read the ticket and its Handoff comment first.

## 5. Report

Ticket URL, branch name, worktree path, and which of the two handoff paths was
used.
