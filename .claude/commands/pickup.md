---
description: Start work in a fresh worktree — read the ticket, the handoff, and the lessons before touching code
---

Run this as the first thing in a new worktree session.

Argument (optional): `$ARGUMENTS` — the ticket, e.g. `EI-249`. With no argument,
infer it from the branch name (`git branch --show-current` → `rob/ei-249-…`).

## 1. Read before writing

- The Linear ticket: `get_issue`, then `list_comments` — the `## Handoff`
  comment holds the decisions and the already-verified facts. Do not re-derive
  what it already establishes.
- `.ai/lessons.md` — scan the headings, read anything touching this area.
- `docs/README.md` — find the doc that owns this subsystem, and read it.
- `AGENTS.md` — the rules that must not be broken.

## 2. Check the worktree is actually usable

```bash
git branch --show-current     # rename only if the slash is missing
ls node_modules .wrangler .dev.vars 2>&1
```

If anything is missing: `npm install && npm run dev:bootstrap`. See
`docs/WORKFLOW.md` §3.

## 3. Restate, then build

Before editing anything, say back in a few lines: what is being built, the
decisions already taken (so they are not relitigated), what is out of scope, and
how it will be verified. Flag any conflict between the handoff and what the code
actually shows — the handoff was written earlier and the code is the truth.

Then build it.
