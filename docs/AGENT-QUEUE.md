# The agent queue (EI-402)

Assign a to-do to an agent, say when it is done and what it needs, and let the
agent work through its own queue over MCP. Everything it does is attributed to
it in the to-do's history. Tool reference: [API.md](API.md), "MCP server".

## 1. Setup

1. **Settings > Assignees.** Add an assignee, kind **Agent** (for example
   "Claude"). A person assignee is just a name and color; it has no key.
2. On the agent's row, **Create key.** This mints a read and write API key that
   never expires, shows it once (copy it), and stores the key's *id* on the
   assignee (`apiKeyId`). That binding is what makes the agent an identity: the
   server finds the acting assignee from the verified key id, never from the
   key's name or metadata. Lose the key and you delete the assignee and start
   over.
3. Point the agent's MCP client at `https://myfaite.app/mcp` with
   `Authorization: Bearer <key>`.
4. On a to-do, set **Who** to the agent, then fill in **Done** and **Access**.

Deleting an assignee hands its to-dos back to you (`assigneeId: null`) and
revokes the bound key. Reassigning or unassigning keeps the Done and Access
data on the to-do.

## 2. The rule

A null assignee is you. When the assignee is an **agent**, the to-do needs:

- **Done**: at least one line, the checklist that says when the agent may stop.
- **Access**: declared. `[]` means "needs nothing"; null means "not declared"
  and does not satisfy the rule.

The app blocks the save, REST answers 400 and the MCP tools return an error,
each with a message naming the missing piece. People assignees need neither.
The rule lives in `src/lib/assignee-rules.ts`.

## 3. The tools an agent uses

| Tool | Use |
|---|---|
| `get_my_work` | Its queue: open to-dos assigned to it, with Done lines (and their ids), access, and how to work them. Errors if the key is not bound to an agent. |
| `add_note` | Report progress. Shows in the to-do's history as "by <agent>". |
| `add_criterion` / `update_criterion` | Add a Done line, or tick (`done: true`) or reword one. |
| `update_access` | Replace the access list; set a status such as `blocked` when stuck. |
| `complete_todo` | Mark it done once every Done line is true. There is no separate review status. |
| `create_todo` | With **no** `assigneeId`: a to-do for the owner. This is how an agent says "I need you" (a decision, a credential, a review). It is never defaulted to the agent itself. |
| `list_assignees`, `list_todos` | Look around. `list_todos` takes `assigneeId` (or `none`). |

Anything an agent writes has `via: agent:<assigneeId>` stamped by the server,
and new Done lines get `addedBy`, overwriting whatever the client sent.

## 4. A sample cron prompt

Run it on whatever schedule suits (an hourly job, a scheduled cloud agent). The
server also sends this as the MCP `instructions` and inside `get_my_work`, so
the prompt can be short.

```text
You are Claude, working my Faite queue. Call get_my_work. For each to-do:
read the description, the Done lines and the access list. Do the work. After
each meaningful step call add_note, and tick a Done line with update_criterion
only when it is true. If you are missing access, call update_access with that
item's status set to "blocked" and move on. When every Done line is ticked,
call complete_todo. If you need a decision or a credential from me, call
create_todo with no assigneeId and a title that says what you need. If the
queue is empty, stop.
```

## 5. Tests

- Unit: `src/lib/assignee-rules.test.ts`, `src/server/mcp/routes.test.ts`,
  `src/server/v1/*.test.ts`.
- End to end: `e2e/server/agent-queue.spec.ts` (run with
  `npm run e2e:server`, see [E2E.md](E2E.md) section 10). It creates the agent
  and key through Settings, seeds a to-do over REST, then works it through
  `/mcp` alone and checks the history names the agent.

## 6. Out of scope

A "Why" field (the description serves), multiple owners, an agents view, push
or webhook delivery to agents (agents poll), a new status, and validating or
storing the credentials an access item names.
