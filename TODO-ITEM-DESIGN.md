# To-do items — design decision log

A consolidated record of how a to-do *item* works: what it stores, where it
renders, what a drag writes, and which of those answers were decided rather
than fallen into. Read it before changing any of that behaviour.

Named for the domain object, not the verb — this is **not** a task list. The
running work log is `.ai/todo.md`.

Companion docs, referenced rather than duplicated here:
`docs/ARCHITECTURE.md` (§2 principles, §5 scheduling) · `docs/DRAG-AND-DROP.md`
(the full drag narrative) · `docs/SYNC.md` · `docs/SCHEMA-CHANGES.md` ·
`docs/SCHEMA-OPS.md` · `docs/KEYBOARD.md`.

---

## 1. The record

`todoSchema` in `src/lib/schema.ts` is the source of truth; Drizzle
(`src/server/db/user-schema.ts`) mirrors it and Dexie stores whole objects.

| Field | Note |
|---|---|
| `status` | `"open" \| "done" \| "dropped"` |
| `completedAt` | Stamped by `statusPatch`, never by callers |
| `scheduledDate`, `deadline` | **Civil dates** (`YYYY-MM-DD`), never instants |
| `position` | Fractional index — ordering, not an integer rank |
| `listId`, `projectId`, `labelIds` | `labelIds` is JSON-encoded text in SQLite |

`labelIds` is writable at creation time too, not only through the sheet's
Labels toggle row — quick-add and the ⌘K palette both resolve a `#label`
inline mention (alongside `@list`) into `createTodo`'s `labelIds`. See
`docs/AT-MENTION.md`.

### `dropped` is not `done`

Three states, not a boolean. Finishing something and abandoning it are
different facts, and collapsing them destroys information you cannot recover.
Everything downstream honours the split: the status filter offers them
separately, and `todo-card.tsx` strikes through `done` but only dims
`dropped` — a strike claims credit for work that was abandoned.

### Civil dates, never `Date`

A to-do is scheduled for *a day*, not an instant. All arithmetic lives in
`src/lib/scheduling.ts` and operates on `YYYY-MM-DD` strings, so DST and travel
cannot shift a day boundary. The one bridge is `civilDateToLocalDate` in
`date-nav.tsx`, for `react-day-picker`, which has no civil-date mode — and it
keeps both sides of the comparison in local time so the conversion is exact.

### `completedAt` is stamped centrally

`statusPatch` (`src/lib/store/repositories.ts`) is the only thing that writes
it: `completedAt: status === "open" ? null : now()`. Callers pass a status and
get the timestamp for free, so reopening always clears it.

---

## 2. Where a to-do renders

`deriveColumn` (`src/lib/scheduling.ts`) is the whole placement rule for **open**
to-dos:

```
unscheduled                  -> planning half, its list column
rolls <= 0                   -> calendar half, its scheduled day
rolls <= overflowAfterDays   -> calendar half, TODAY
otherwise                    -> calendar half, Overflow
```

Then one override: a day outside `visibleWindow` renders in the planning half
flagged `awayDate`. That is now a **safety valve only** — the board grows the
window to cover the furthest-scheduled to-do, so it fires only past the day cap.

### Overflow is derived, never stored

The alternative — a nightly job pushing `scheduledDate` forward — needs a cron,
breaks offline, destroys the user's original intent, corrupts recurrence, and
cannot be undone. Deriving it makes placement a pure function of stored data
plus the clock, so every device agrees without coordinating.

### Rolls count *eligible* days

`rollsElapsed` counts days that pass the `workdaysOnly`/`workdays` filter, so a
Friday miss seen on Monday has rolled **once**, not three times. That is what
makes "overflow after 3" mean three working days.

### The Faite Loop is configurable and visible (EI-96)

`overflowAfterDays` (0–30, default 3) is a Settings → Faite Loop control, not
a hardcoded constant. Every visible trace of it — the card's rollover marker,
the Overflow age badge, and the `rolledOver`/`overflowed` rows in both the
day timeline and the per-todo History — comes from ONE derivation,
`rollEventsFor()` (`src/lib/rollover-events.ts`), so the rule can't drift
between surfaces. Recurring to-dos bypass the loop entirely (one miss →
Overflow, no grace period — the series comes around again). Full design:
**[docs/FAITE-LOOP.md](docs/FAITE-LOOP.md)**.

### ⚠ The window must stay contiguous from today

`deriveColumn` answers "is this day rendered?" with an O(1) offset check —
`daysBetween(today, day) >= visibleWindow.length` — chosen over `.includes`
because `buildBoard` would otherwise run it per to-do against a year-long array.

**This is load-bearing.** Punching days out of `visibleWindow` does not hide
them; it silently exiles everything scheduled on them to the planning half as
away-cards. It is why hiding weekends is a *rendering* concern (§5) and not a
change to `buildWindow`.

---

## 3. Which statuses show

`settings.visibleStatuses` (default `["open"]`) reaches `buildBoard` as an
option. Controls: the **View** dropdown in `view-settings.tsx`, mirrored in ⌘K.

### Settled work takes a different placement path

`placeSettled` in `src/lib/board.ts`, deliberately **not** `deriveColumn`:

- **No rollover, never Overflow.** Overflow means "you have put this off too
  long", which is a claim about work you still owe. Filing last week's finished
  errand under it reads as an accusation, and it would push genuinely stale work
  down the column to make room.
- **Out of window → renders nowhere.** Specifically *not* the `awayDate`
  fallback, which exists to keep live work reachable. Applying it here would
  pour months of finished cards into the lists.
- **Unscheduled → its list**, as normal.

### Settled work sinks

`openFirst(...)` in `src/lib/priority.ts` wraps whichever comparator the half
uses — priority in the calendar half, hand-arranged `position` in the planning
half. `done` and `dropped` rank *together*: how you dismissed a card changes how
it reads, not where it sits.

### The last status cannot be turned off

Both in the dropdown and in ⌘K. An empty board is a legal state that is
indistinguishable from a broken one — every column blank, no error, and the
cause behind a menu that has since closed. One guarded line beats an empty-state.

---

## 4. How many days are shown

Four values interact, all in `board.tsx`:

| Value | Meaning |
|---|---|
| `DEFAULT_RENDERED_DAYS = 30` | Columns on first load |
| `horizon` | Grows by scrolling / "Load 30 more days" |
| `cap` (`DEFAULT_DAY_CAP = 365`) | Ceiling; **only ever grows** |
| `furthestScheduledOffset` | Keeps the window over the furthest open to-do |

```ts
renderedDays = min(cap, max(minDays, horizon, furthestScheduledOffset))
```

### `visibleDays` counts VISIBLE COLUMNS, not calendar days

Changed with the weekend strip. With weekends shown the two are identical; with
weekends collapsed a strip is not a column, so **5 on a Friday spans 7 calendar
days** — Fri · [Weekend] · Mon · Tue · Wed · Thu. `calendarSpanFor`
(`weekend-runs.ts`) derives the span, and always ends it on a working day so no
trailing strip dangles with nothing after it.

### Growing the horizon is never a side effect of scrolling

It would silently drain cards out of their lists as the user looked further
ahead, with no way back. Growth is always an explicit click on the load-more
tile — except the date picker, which has no upper bound on purpose (a reminder
18 months out should be reachable) and raises `cap` to match via `onExtend`.

### The collapse effect keys on `visibleDays`, not the derived span

Toggling weekends changes the span but is **not** a request to collapse a
30-day track back to a week. `renderedDays` takes the max, so the window grows
to fit a new span on its own. The effect also skips the first time
`settings.visibleDays` becomes defined — that transition is Dexie's initial load
resolving, not a user action, and firing on it would collapse the default 30-day
view to 7 before the user touched anything.

---

## 5. Weekends

`settings.showWeekends` (default `true`). When off, each maximal run of
consecutive non-working days collapses into one 40px strip.

- **Which days are "the weekend" derives from `settings.workdays`**, not a
  hardcoded `[0, 6]`. One source of truth, and it follows a user who works
  Tue–Sat. Independent of `workdaysOnly`, which governs rollover targets only.
- **Runs, not fixed Sat+Sun pairs.** The window starts at *today*, so it can
  begin or end mid-weekend; opening on a Sunday gives a one-day strip.
- **Expansion is unpersisted** (`board.tsx`, beside `collapsedGroups`). Opening
  a strip is a peek, not a preference — the thing that survives a reload is
  `showWeekends`, and a strip that stayed open would make that setting a lie.
- **Nothing ever re-collapses a strip**, including on drag end. A column
  vanishing from under a card the moment you release it is indistinguishable
  from the drop having gone somewhere unexpected.

### The strip is a drop *target* but never a drop *destination*

It registers `useDroppable` only so a hovering card can be detected and the
strip opened after a 600ms dwell; the real day columns then take the drop.
"Schedule this for the weekend" is not a date, and picking Saturday on the
user's behalf would silently make an ambiguous choice for them.

Mid-drag mounting works only because `DndContext` measures with
`MeasuringStrategy.Always` — dnd-kit re-measures every move, so columns that
appear mid-drag are immediately valid targets. **Do not change that strategy.**

---

## 6. Drag and drop — id namespaces

Full narrative in `docs/DRAG-AND-DROP.md`. The part that bites:

| Id | Kind | Drop destination? |
|---|---|---|
| `day:<date>` | day column | yes → `scheduleTodo` |
| `day:overflow` | Overflow | **refused with a toast** |
| `list:<id>` | list column | yes → `moveTodoToList` (clears `scheduledDate`) |
| `daygroup:<date>\|<key>` | group in a day column | yes → `moveTodoToDayGroup` |
| `tab:<id>` | tab pill | no — dwell-switches the tab |
| `weekend:<date>` | collapsed strip | no — dwell-expands |
| `listdrag:` / `tabdrag:` | reorder handles | drag *sources* only |
| a bare UUID | a card | — |

### ⚠ `parseColumnId(id) === null` means "this id is a CARD"

That convention is load-bearing everywhere. A new namespace must go into
`isDropZoneId`, or a hover on it is classified as a card, looked up in the todo
list, not found, and the drag does nothing at all — **with no error anywhere**.

`weekend:` is in `isDropZoneId` and deliberately **not** in `parseColumnId`:
being a drop zone is what makes it detectable, and being absent from
`parseColumnId` is what stops `handleDragEnd` finding a day to write. Both
halves are pinned by tests in `src/lib/board.test.ts`.

### The two halves order differently

Planning is arranged by hand (`position` is the order); the calendar half is
computed (`position` is only a tiebreaker after priority). A hand-arranged day
column reshuffles into groups the first time `buildBoard` runs — nothing is
destroyed, but do not expect drag order to survive there.

---

## 7. Keyboard

`src/lib/column-nav.ts` models the board as two rows of columns, each an ordered
list of stops. `use-column-nav.ts` moves focus; the grid arithmetic is pure.

**A rendered thing that is not in the grid is unreachable.** A collapsed weekend
strip is a single-stop sentinel column (`strip: true`), the same shape as
`NAV_CREATE_LIST` and `NAV_LOAD_MORE` — without it, `→` steps Friday to Monday
past a control the user can see.

`defaults.calendar` picks the first **real** day, not `days[0]`: opening on a
Saturday with weekends collapsed puts a strip in that slot, and a cross-half
move landing there parks focus somewhere you cannot type.

---

## 8. Settings persistence

One Dexie singleton row keyed by `LOCAL_OWNER_ID`, read with `useSettings()`,
written with `mutateSettings(...)` — which stamps `updatedAt` and enqueues an
outbox entry in one transaction. No zustand, no context, no localStorage as
source of truth (localStorage mirrors theme/font only, for the pre-paint script).

`SETTINGS_SYNCED_FIELDS` in `src/lib/sync/wire.ts` is the allowlist. Excluded on
purpose: `activeTabId` (device view-state, and the highest-frequency writer) and
the four rail width/collapsed fields (the right width for a laptop is not the
right width for a wide monitor on the same account).

`visibleStatuses` and `showWeekends` **do** sync — they are account-level
preferences like `visibleDays`.

Precedent for shipping unpersisted first: `collapsedGroups` and
`expandedWeekends` are plain `useState`, with comments saying so.

---

## 9. ⚠ Adding a field — the trap

`docs/SCHEMA-CHANGES.md` is the full checklist and now carries this warning
too — it did not when `visibleStatuses`/`showWeekends` were added, and its
recipe said to do the dangerous thing:

> **`bootstrap.ts` and an `ALTER` migration must never both declare the same
> column.**

`USER_DB_MIGRATIONS[0].statements` **is** the live `BOOTSTRAP_STATEMENTS`
constant, not a frozen copy. On a fresh DO, migration 1 creates the table from
whatever `bootstrap.ts` says *today*, then later migrations run in order — and
`runUserDbMigrations` executes raw `sql.exec` with **no duplicate-column
tolerance**. So adding a column to both places boots migration 1 with the column
present and then fails the `ALTER`, breaking **every new account** while your
own keeps working.

Evidence it already works this way: migration 2 added the four rail columns and
`bootstrap.ts` does not contain them.

So, for a column on an existing table:

1. `src/lib/schema.ts` — Zod
2. `src/server/db/user-schema.ts` — Drizzle (the *current full* shape)
3. `src/server/db/migrations.ts` — append; **never edit or renumber**
4. `src/server/sync/columns.ts` — add to `JSON_ENCODED_FIELDS` if it is a
   JSON-encoded `text()` column (`labelIds`, `workdays`, `visibleStatuses`)
5. `src/lib/sync/wire.ts` — `SETTINGS_SYNCED_FIELDS`
6. `src/lib/store/repositories.ts` — seed default
7. **Leave `bootstrap.ts` alone**
8. Any `Settings` fixture in a test file — there are several, and they are
   type errors rather than silent failures

Then `npm run schema:generate` → `npm run schema:check`. If only the ledger
changed, the bootstrap fingerprint should **not** move and no
`npm run schema:snapshot` is needed. Dexie needs nothing unless you must
*query* by the field — `.stores()` declares indexes only.

---

## 10. Presentation

The spec of record for colour, type, surfaces and motion is
[`docs/DESIGN.md`](docs/DESIGN.md). The notes below are the card-specific
decisions it builds on.

- Priority is a **rail**, not a chip — a chip cost a whole badge row in a 168px
  column. Since the V milestone the rail is achromatic: thickness (3/2/1/1px)
  and opacity carry the four levels, and P4 is dotted. Hue was dropped so red
  can mean urgency alone — `docs/DESIGN.md` §7, decision A. See
  `src/lib/priority.ts`.
- `done` is struck through; `dropped` is dimmed only.
- The unchecked checkbox uses `border-muted-foreground`, not `border-input`.
  `--input` is `oklch(0.922 0 0)` in the light theme — near-white, fine on a
  plain surface and invisible over a coloured group wash. It is square
  (`rounded-none`): a 4px radius on a 16px box is mostly lost anyway.
- The three colour alphas in `src/lib/colors.ts` are a **ladder**, and the gaps
  are the point: rule 35% / header 12% / card field 5%. Wash and tint were once
  10% and 12%, which is inside the noise — the header and the run below it read
  as one flat panel rather than a label above a field.

### The Air pass (2026-09-05)

Board-wide, so the full record is `docs/DESIGN.md` §3 and §7 — noted here
because it changes what a card sits on and how completing one feels.

- **Columns lost their borders and backgrounds.** No panel, no sunken floor.
  Whitespace (`gap-3`) is the only column separator; today is the board's
  only card (`--surface-1` + `shadow-card`, no border — the shadow carries
  the edge). A card's own chrome (checkbox, priority rail, meta badges) is
  now the only thing giving it a boundary at all, since its column no
  longer draws one.
- **`--shadow-card` gained a `-1px` spread.** Box-shadow blur bleeds
  sideways as much as down; on today's column and the active tab pill the
  un-spread blur read as a stray vertical border. Any future card-level
  shadow should carry the same spread, not the bare `0 1px 2px` shape.
- **The completion check-flash is wired** (`--animate-check`, `todo-
  card.tsx`): a spectrum pulse on the checkbox the instant a to-do is
  marked done, gated on the actual open→done transition (a `wasDoneRef`
  guard), not on `status === "done"` alone, so an already-done card
  remounting (tab switch, filter change) never replays it.
- **Every focus ring, including the checkbox and title button, is one
  `focus-ring` utility** (`globals.css`) now — no more per-component
  `ring-2`/`outline-2` variants drifting apart.
- Overlays (the to-do sheet included) dropped shadcn's default filled
  footer bar and label-sized title for a hairline footer and a real
  heading step — see `docs/DESIGN.md`'s new "Overlays" paragraph in §3.

---

## 11. Known limitations (deliberate)

- **Jump precision with weekend strips.** `measurePitch` reads a real
  `[data-day-column]` rather than the track's first child, but with mixed widths
  `scrollLeft → day index` is genuinely nonlinear, so Week/Month/Quarter jumps
  and the date picker land within ~1 column. Exact scrolling needs cumulative
  per-slot offsets. Every consumer degrades by one column and none is
  destructive.
- **`collapsedGroups` / `expandedWeekends` reset on reload.**
- **No multi-select drag.** Keyboard drag is unverified end to end; touch is
  untested on a real device. See `docs/DRAG-AND-DROP.md` §7.
- **Settled work is not reachable outside the window.** There is no history
  view; `placeSettled` returns null past the horizon by design.

---

## 12. Sub-tasks (EI-55)

`Todo.parentId` (`lib/schema.ts`) was reserved from P1 but had no UI until
this. The scope is deliberately narrow — **one level of nesting**, and a
sub-task never becomes a board citizen in its own right.

### Where a sub-task lives

**Only inside its parent's detail sheet** (`TodoSheet`'s Sub-tasks section) —
never as its own card, day-column entry, or search/⌘K result. That is enforced
by filtering `parentId`-having rows out of `visibleTodos` itself
(`use-board-data.ts`), the same choke point archived-list orphans already go
through — so every downstream reader (`nonTemplateTodos`, `buildBoard`, the
palette, foreground reminders, the day sheet's timeline) is correct for free
rather than needing its own `!t.parentId` guard.

`TodoSheet` still receives the raw, unfiltered `todos` table (a new optional
prop) purely to look up `t.parentId === todo.id` — the same reasoning that
keeps `todosById` (`use-board-data.ts`) built from the raw table rather than
`visibleTodos`, so a sub-task's own row is never actually inaccessible, just
never surfaced as a first-class board object.

### One level, enforced at the write site

Rather than modelling depth, `createSubtask(parentId, title)`
(`store/repositories.ts`) just refuses to set a `parentId` on a todo that
already has one. `TodoSheet` mirrors that at the UI layer — the Sub-tasks
section does not render at all when `todo.parentId` is already set — so the
repository check is defense in depth (reachable only if a stale sheet somehow
stays open across its own promotion), not the primary guard.

### A sub-task is a real todo, not a checklist string

It is an ordinary `Todo` row with its own `id`, `status`, `createdAt` — just
one whose `parentId` keeps it off the board. That is what makes reopening,
history (EI-94's `todoEvent` log), and sync all work on it with zero special
casing: it goes through `createTodo`/`setTodoStatus`/`deleteTodo` exactly like
any other row.

What it deliberately does NOT get, in this UI: its own scheduling, list, or
priority. `createSubtask` never sets `listId`/`scheduledDate`/`priority`, and
`TodoSheet`'s Sub-tasks section exposes no fields for them — only a title, a
checkbox (open ↔ done), and delete. Those fields stay at their zero value
until the sub-task is PROMOTED (see below), at which point `buildBoard`'s
existing "no list falls back to Backlog" rule places it sensibly with no new
code.

### Deletion: `parentId` is a LIVE reference, not provenance

Deleting a todo with open sub-tasks does not cascade-delete them. `deleteTodo`
promotes every live child first — clears `parentId`, same "cleared, not
destroyed" rule `deleteList` uses for `listId` (rehoming orphans to Backlog)
and `deleteSeries` uses for `recurrenceParentId` — and only then tombstones
the parent. A sub-task's own work is real and outlives its parent going away.
See `ARCHITECTURE.md` §2.8e's live-vs-provenance table.

Completing or dropping the parent does **not** cascade either. Nothing forces
open sub-tasks closed — the codebase has no existing pattern for that kind of
cross-row cascade (§2.8e's whole point is that references are advisory), and
inventing one here would be exactly the kind of complexity this feature's
scope note (`schema.ts`'s doc comment: "one level of nesting") warns against.

### Sync

No migration was needed. `parentId` has been in `bootstrap.ts`'s frozen
initial `todos` table since the very first P3 commit (`a247bd2`) — every
account, old or new, already has the column — and `COLUMNS_BY_KIND`
(`server/sync/columns.ts`) derives its whitelist from the Drizzle schema
automatically, so `sanitizePatch` already let it through. `npm run
schema:check` passes with no changes to the migration ledger.

### Known limitations (deliberate)

- **No progress badge on the board card.** A parent's "N/M sub-tasks" count
  is visible only inside its own sheet, not on the collapsed card — adding it
  would mean threading sub-task counts through `buildBoard`'s data flow,
  which this pass deliberately kept out of. Candidate follow-up.
- **No reordering, no promotion UI.** Sub-tasks list in creation order; there
  is no drag handle, and the only way to detach one from its parent today is
  deleting the parent (which promotes it) — there is no explicit "make this a
  full todo" action.
- **No mention grammar in the add row.** Unlike the title field and quick-add,
  typing `@list` or `#label` into "Add a sub-task" is taken literally, not
  resolved — consistent with sub-tasks having no list/label surface at all in
  this UI.
