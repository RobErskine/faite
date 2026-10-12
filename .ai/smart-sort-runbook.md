# Smart sorting — runbook (EI-365)

Approved by Rob 2026-10-11. Worktree `/Users/roberskine/jean/faite/smart-sorting`
(Jean worktree id `917091ac-a28d-42c8-a28d-bbc4ee1ae194`). Work runs on a
self-paced `/loop`: one ticket per pass.

Goal: with the user's own TypeSafe Jev key, Faite **proposes** a list for each
new Backlog to-do. The user confirms; Jev never moves a to-do. A to-do from
Raycast/email/MCP/REST stays visible in Backlog with a chip until the user acts.

## Decisions
- Proposed, confirm to move. Never auto-move.
- `todo.suggestedListId`; chip on Backlog cards; click or `⇧→` accepts; toast + Undo.
- Dismiss in v1 (card context menu). Accept / dismiss / override are todo events —
  v2 (EI-371, parked) learns from them.
- Settings tab "Duplicates" → "Smart sorting" + "Smart to-do sorting" toggle.
- Quick sort = Overdrive Backlog mode, list combobox per card, pre-selected from Jev.
- All sources that land a to-do in Backlog are checked.
- Jev: one Choice per to-do; options = lists + `none`; suggestion only when
  `choice != none && confidence ≥ 0.5` (tune). Sources:
  https://docs.typesafe.ai/primitives/choice.md (≤255 options, `answers[id].{choice,confidence,probabilities}`),
  https://docs.typesafe.ai/confidence.md.
- Suggest route (`POST /api/smart-sort/suggest`) **does not write**; only the push hook writes.

## Tickets — order and status
| # | Ticket | Branch | Status |
|---|---|---|---|
| 1 | EI-366 bug: REST/MCP backlog reads miss null-listId to-dos | `rob/ei-366-rest-backlog-and-mcp-get_backlog-miss-to-dos-with-no-list` | done (#132) |
| 2 | EI-367 A: schema + engine + push hook + suggest route | `rob/ei-367-smart-sorting-a-suggestedlistid-field-jev-list-suggestion` | done (#133) |
| 3 | EI-368 B: settings tab + toggle | `rob/ei-368-smart-sorting-b-rename-the-duplicates-settings-tab-to-smart` | done (#134) |
| 4 | EI-369 C: chip, ⇧→, dismiss, toast | `rob/ei-369-smart-sorting-c-suggested-list-chip-on-backlog-cards-click` | in review |
| 5 | EI-370 D: Quick sort (Overdrive Backlog mode) | `rob/ei-370-smart-sorting-d-quick-sort-an-overdrive-mode-for-the-backlog` | todo |

Ticket bodies in Linear are the spec. Read them with `get_issue` at the start of each pass.

## Per-pass loop protocol
1. `git fetch` ; `git switch -c <branch> origin/main` (after the previous PR merged).
2. Linear → In Progress. Read the ticket, `docs/WORKFLOW.md`, the related doc, `.ai/lessons.md` hits.
3. Implement (subagents in parallel where files do not overlap). Narrow checks only.
4. `npm run typecheck` (again after tests — vitest skips type checks), the touched unit tests,
   the touched e2e spec on desktop + phone-iphone. UI: check in the running app.
5. Commit `feat(EI-xxx): …` / `fix(EI-xxx): …`; push; PR (`/opt/homebrew/bin/gh`); wait for CI;
   squash merge. Linear → Done with a short comment + PR link.
6. Update the status table here. Stop the loop and report if: CI fails twice on the same
   cause, a decision is not in this runbook, or a Linear/Jean tool is unavailable.

## Log
- 2026-10-11: tickets EI-365..EI-371 filed; worktree created.
- 2026-10-11: EI-366 merged (#132). Jean `move_session` restarted the process mid-loop and killed the
  wakeup/monitor; loop re-armed from inside the worktree. EI-367/368/369 built stacked while CI ran.
- EI-369 scope note: accept is logged (`moved`, `via: "smart-sort"`); dismiss is NOT logged in v1 —
  a new event kind needs the kind-filter migration ripple (`kind-filter.ts`, migrations 21-ish). Moved to EI-371.
- 2026-10-11: EI-367 (#133) and EI-368 (#134) merged. Session restarted a second time mid-check;
  no work lost (all on disk). Landscape-phone Overdrive e2e is broken on main too → EI-372 filed.
