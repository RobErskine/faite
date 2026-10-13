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

## 2. When the proposal is made

There are two paths, and each create takes exactly one, so Jev is never asked
twice for the same to-do.

### 2a. Board creates: the board asks at once (EI-373)

A to-do typed into Backlog (quick-add, or ⌘K) calls `proposeListForNewTodo`
(`src/lib/smart-sort.ts`) right after the local create. It sends the to-do's
**text** to the suggest route (§4) and writes the answer locally as
`suggestedListId`, which then syncs like any edit.

This is the fast path because it skips everything else in the way:

- the board's **2 s sync debounce** (`DEFAULT_DEBOUNCE_MS`,
  `lib/sync/engine.ts`), which coalesces typing and must stay;
- the push round trip, and the duplicate check;
- the write-back and the pull that brings the chip to the board.

What is left is one request to the Worker and one Jev call. The helper reads
the settings, the to-do and the lists from the local store, and it does
nothing unless `smartSortEnabled` is on and the to-do is open and in Backlog.
It reads the to-do again before it writes, so a to-do filed while Jev was
answering is left alone.

### 2b. Server creates: the push hook

`UserDurableObject.push()` collects new to-do inserts. For
**server-stamped** creates only (`isServerStamped`: REST, MCP, Raycast,
email), `afterCreate()` runs two things **at the same time**:

1. **`checkDuplicates`** (EI-346).
2. **`proposeLists`** (EI-367). It runs only if `settings.smartSortEnabled` is
   true and a key is saved. It reads the to-dos (still open, not flagged, no
   proposal, in Backlog), asks Jev, then **waits for the duplicate check**,
   reads them again, and writes `suggestedListId` through `push()` with a
   server HLC. So a to-do flagged as a duplicate gets no list, but the two
   Jev calls overlap instead of running one after the other.

That write is an update, not an insert, so it does not start the hook again.

Which creates are checked: `eligibleNewTodos` in `duplicates/check.ts`, which
both features share. A to-do must be open, top-level, not a recurring
occurrence, not flagged, and have a title. A push with more than 3 such
creates is a bulk write and is skipped. Smart sorting also skips a create
that already has a `scheduledDate`.

Both paths log the Jev call's time (`[faite] list proposal` / `[faite] list
suggestions`, counts and `ms` only, never titles). Read them with
`wrangler tail` to see how much of a delay is Jev itself.

**The list lookup is not a cost.** `listOptions()` is a SQLite read in the
same Durable Object, well under a millisecond, so a cache of the lists would
save nothing.

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

## 4. The suggest route

`POST /api/smart-sort/suggest` takes `{ todos: [{ id, title, description? }] }`
(at most 50) and returns `{ suggestions: { [id]: listId | null } }`.

- It takes the to-do's **text**, not an id: a board create has not synced
  yet (§2a). `id` only keys the answer.
- Two callers: `proposeListForNewTodo` (a board create) and Quick sort on
  open (EI-370).
- It uses the cookie session only, and it **writes nothing**.
- It ignores `smartSortEnabled`; the caller checks it.
- It returns 409 `no-key` when no key is saved, and 502 when Jev fails.
- The client is `fetchListSuggestions` (`src/lib/smart-sort.ts`). It never
  throws. After a 401, 404 or 409 it stops asking for the rest of the
  session; saving a key resets that (`resetListSuggestions`).

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
  proposal; Quick sort asks for one on demand.
- A board create made while offline gets no proposal: the board asks once,
  at create time, and the server hook skips board creates. Quick sort covers
  it.
- One threshold for everyone. EI-371 plans to learn from what users accept
  and dismiss.
