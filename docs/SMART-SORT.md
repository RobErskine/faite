# Smart sorting

**Epic:** EI-365. **Tickets:** EI-366 (the Backlog rule), EI-367 (engine),
EI-368 (settings), EI-369 (chip), EI-370 (Quick sort). **Parked:** EI-371
(learning from accept/dismiss).

With the user's own TypeSafe Jev key, Faite **proposes** a list for each new
Backlog to-do. The user confirms. Jev never moves a to-do on its own.

The reason for that rule: a to-do from Raycast, email, MCP or REST must not
vanish into a list the user never looks at. It stays in Backlog, with a chip
that names the proposed list, until the user acts on it.

It reuses the duplicate-detection pieces (`docs/DUPLICATES.md`): the same key,
the same hook in `push()`, the same write-back path, the same eligibility.

## 1. What "in Backlog" means

`backlogMembership(lists)` in `src/lib/backlog.ts` (EI-366) is the one rule.
The board, `GET /api/v1/backlog`, MCP `get_backlog` and smart sorting all use
it. A to-do is in Backlog when it has no `scheduledDate` and its `listId` is
one of these:

- the Backlog list's id;
- null (every email capture, and every API create that names no list);
- a list that was deleted or archived.

`src/lib/board.test.ts` asserts that this rule files the same to-dos as
`buildBoard`.

## 2. The proposal: the push hook

`UserDurableObject.push()` collects new to-do inserts. After the commit, and
without awaiting it, `afterCreate()` does two things in this order:

1. **`checkDuplicates`** (EI-346). It runs first, so a to-do flagged as a
   duplicate is not also given a list.
2. **`proposeLists`** (EI-367). It runs only if `settings.smartSortEnabled` is
   true and a key is saved. It:
   - reads the to-dos again (still open, not flagged, no proposal, in
     Backlog);
   - asks Jev;
   - reads them again, because the user may have filed one while Jev was
     answering;
   - writes `suggestedListId` through `push()` with a server HLC.

That write is an update, not an insert, so it does not start the hook again.

Which creates are checked: `eligibleNewTodos` in `duplicates/check.ts`, which
both features share. A to-do must be open, top-level, not a recurring
occurrence, not flagged, and have a title. A push with more than 3 such
creates is a bulk write and is skipped. Smart sorting also skips a create
that already has a `scheduledDate`.

Every path is covered: board, REST, Raycast, MCP and email all reach
`push()`.

## 3. The judgment

The code is `src/server/smart-sort/suggest.ts`. It sends one **Choice** per
to-do (https://docs.typesafe.ai/primitives/choice.md):

| Part | Content |
|---|---|
| `state` | `{ todos: [{ title, notes? }] }`. Notes are cut to 300 characters. Dates are never sent. |
| question `q{i}` | "Which of the user's to-do lists does the to-do `todos[i]` belong in? Choose `none` unless one list clearly fits." |
| `criteria` | One option for each live, non-archived, non-Backlog list, plus `none`. The option key is a slug of the list name (`groceries`, `work_inbox`). The model reads it, so it is a name, not an id. The text is the list name, its tab name and its `description`. |

A proposal is stored only when the choice is not `none` **and** `confidence`
is at least `SUGGEST_THRESHOLD` (0.5). The value 0.5 is a start, not a
measurement. A wrong proposal costs one dismiss, and nothing moves without the
user, so the threshold errs toward proposing
(https://docs.typesafe.ai/confidence.md).

Other limits:

- Requests carry 10 questions each and run in parallel.
- An account with more than 254 lists is skipped, because a Choice allows
  255 options.
- The model is pinned to `JEV_MODEL`, the same pin as duplicates.

**List descriptions matter.** A list called "Misc" with no description gives
Jev nothing to go on. The `description` field (EI-236) was added for this
kind of routing.

## 4. The suggest route (Quick sort)

`POST /api/smart-sort/suggest` takes `{ todoIds }` (at most 50) and returns
`{ suggestions: { [todoId]: listId | null } }`.

- It uses the cookie session only.
- It **writes nothing**: a pre-selection in Quick sort is not a decision.
- It ignores `smartSortEnabled`, because opening Quick sort is the request.
- It returns 409 `no-key` when no key is saved, and 502 when Jev fails.
- The client is `fetchListSuggestions` (`src/lib/smart-sort.ts`). It never
  throws; every failure means "nothing to pre-select".

## 5. Settings

**Settings → Smart sorting** (`settings/smart-sorting-section.tsx`, EI-368)
replaced the Duplicates tab, because one key now powers both features. It has:

- the key block;
- the Duplicates group with **Hold every duplicate**;
- **Smart to-do sorting → Suggest a list for new to-dos**
  (`smartSortEnabled`).

Both switches are disabled, and show as off, until a key is saved. Neither
feature can run without a key, so a switch that could be turned on would do
nothing. The stored setting is kept: saving a key brings back what was on.

## 5a. The chip (EI-369)

A Backlog card whose `suggestedListId` resolves through `suggestedListFor`
(`src/lib/suggested-list.ts`) shows a dashed chip under the title. The list
must be live, not archived and not Backlog, and the to-do must be open.

| Action | Result |
|---|---|
| Click the chip, or `⇧→` on the focused row | `moveTodoToList(…, "smart-sort")`, then `suggestedListId: null`, with an Undo toast. Undo brings the chip back. |
| Click the ×, or **Dismiss suggestion** in the card menu | Sets `suggestedListId: null`. The to-do stays. Nothing proposes it again. |

The shortcut is `⇧`, not bare `→`. Bare `→` is board navigation
(KEYBOARD.md §11), and on every Backlog card it moves to the first list. The
× exists because touch screens have no context menu.

**What is logged.** An accept is a `moved` event with `via: "smart-sort"`.
That is the record EI-371 can learn from. A dismiss is **not** logged in v1:
it needs a new event kind, and a new kind changes every kind filter
(`kind-filter.ts` and the settings arrays, see the EI-320 lesson). EI-371
owns that work.

The e2e spec is `e2e/smart-sort.spec.ts`. It runs on desktop and
phone-iphone, and it writes the proposal into IndexedDB in place of the
server.

## 6. Fields

| Field | Written by | Meaning |
|---|---|---|
| `todo.suggestedListId` | the server (proposal); the client (null on accept/dismiss) | The proposed list. A value that points at a list that is gone is not shown. Nothing cleans it up. |
| `settings.smartSortEnabled` | Settings → Smart sorting | Gates the push hook. It syncs to the server, because the server reads it. Off by default. |

Migration 26 adds both.

## 7. Known limits

- It is not tested against a live key. The tests use a fake `fetch`, as for
  duplicates.
- Only creates are checked. A to-do moved back into Backlog later gets no
  proposal from the hook; Quick sort asks for one on demand.
- One threshold for everyone. EI-371 plans to learn from what users accept
  and dismiss.
