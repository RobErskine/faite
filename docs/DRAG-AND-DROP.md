# Drag & Drop — working document

**Self-contained handoff.** Everything needed to continue drag-and-drop work on
Faite without reading the rest of the codebase. Read this top to bottom before
changing anything; several behaviours look like bugs but are deliberate, and at
least one "obvious improvement" has already been tried and reverted.

---

## 1. What Faite is (30 seconds)

A weekly-planner todo app. The UI is two horizontal halves and **dragging
between them is the entire product**:

- **Calendar half (top)** — one column per day + an **Overflow** column.
  Day-count toggle: 1 / 3 / 5 / 7 days.
- **Planning half (bottom)** — one column per **list**. "Backlog" is leftmost
  and undeletable.

Capture into a list → drag up onto a day to commit to it. Missed items roll
forward; after enough rolls they fall into Overflow.

Local-first: every write goes to IndexedDB and the UI re-renders reactively.
**No network is on the interaction path**, so a drop applies instantly. There is
no server call to await, no optimistic-update reconciliation, no failure path to
handle mid-drag.

---

## 2. Stack

- **dnd-kit** — `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
  (chosen over react-beautiful-dnd, which is dead; dnd-kit ships keyboard and
  screen-reader support)
- React 19.2.4, Next.js 16.2.12, Tailwind v4, shadcn/ui
- `fractional-indexing` for ordering

---

## 3. Files that matter

| File | Role |
|---|---|
| `src/components/board/board.tsx` | `DndContext`, sensors, collision detection, all drag handlers, `DragOverlay` |
| `src/components/board/board-column.tsx` | `useDroppable` + `SortableContext`; drop-target visual states; column insertion bar |
| `src/components/board/todo-card.tsx` | `useSortable`; whole-row drag, grip, insertion line |
| `src/components/board/drag-grip.tsx` | The one grip affordance, shared by rows and columns |
| `src/components/board/column-grip.tsx` | `useDraggable` handle for reordering list columns |
| `src/components/board/create-list-column.tsx` | End-of-track "Create list" slot. Column-sized, deliberately **not** a droppable (§5.6) |
| `src/app/globals.css` | `--column-min` / `--column-max` / `--list-column-min`, and the `column-track` utility (§4.12) |
| `src/lib/board.ts` | Column grouping, id codecs, `preferPreciseTarget()`, `planListDrop()` |
| `src/lib/drop-animation.ts` | Drop animation: `readLandingRect()`, `landingTransform()`, `runLandingDropAnimation()` |
| `src/lib/ordering.ts` | Fractional index helpers (`positionForIndex`) |
| `src/lib/board.test.ts` | Tests for id codecs, target selection, column reordering |
| `src/lib/drop-animation.test.ts` | Tests for the landing rect math |

**Two gestures share one `DndContext`**: dragging a todo card, and dragging a
list column to reorder it. `active.id` is the only thing that tells them apart —
see §4.1 and §4.10.

---

## 4. How it works

### 4.1 Droppable ids are encoded strings

Columns register droppables with encoded ids, so a drop can be decoded back into
an intent:

```
day:2026-08-03     a day column          droppable
day:overflow       the Overflow column   droppable
list:<listId>      a list column         droppable
listdrag:<listId>  a column's reorder handle   DRAGGABLE ONLY
tab:<tabId>        a tab pill            droppable  (reorder target AND card hover)
tabdrag:<tabId>    a tab's reorder handle      DRAGGABLE ONLY
<uuid>             a todo card           both
```

`parseColumnId(id)` returns `{kind:"day"|"overflow"|"list", ...}` or `null`.
**`null` means the id is a card**, which is how the code distinguishes the two
everywhere. `isColumnId()` wraps that check.

**A tab pill is a drop zone without being a column** — nothing lands *in* it, so
it is not a `DropTarget`. That makes it the one id shape that would slip through
the `null`-means-card rule, so any code resolving a card's target must use
`isDropZoneId()` (columns **plus** tab pills) rather than `isColumnId()`. See
§4.3 for the specific bug this prevents.

**`listdrag:` is deliberately a separate id space from `list:`.** A list column
is a drop *target* for cards and a drag *source* for reordering, and those two
roles must stay distinguishable. Reusing `list:<id>` for both would have been
shorter, but then `active.id` could no longer say which gesture is in flight,
and `parseColumnId` — which the entire card drop path routes through — would
start matching drag sources. `parseListDragId()` is the decoder; it returns
null for `list:` ids, and `parseColumnId` returns null for `listdrag:` ids.
There is a test pinning that non-overlap, because a collision here fails
*silently*: a column reorder would fall into the card path, find no todo, and
return without writing anything.

**The same split repeats one level up for tabs**, and there the trap is sharper:
`tabdrag:` begins with the literal string `tab`, so a prefix check written as
`startsWith("tab")` rather than `startsWith("tab:")` would match both. Four id
spaces now share one `DndContext`, and `board.test.ts` carries a full
non-collision matrix asserting every parser returns null for every other
namespace's ids.

### 4.2 Collision detection — pointer first

This is the most important part of the file, and it was a bug fix.

```ts
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  const collisions = underPointer.length > 0 ? underPointer : closestCorners(args);

  if (parseListDragId(String(args.active.id))) {
    const column = collisions.find((c) => parseColumnId(String(c.id))?.kind === "list");
    return column ? [column] : [];
  }

  const target = preferPreciseTarget(collisions);
  return target ? [target] : collisions;
};
```

**The two gestures want opposite answers**, which is why the branch exists.
`args.active` is available in `CollisionDetectionArgs`, so no extra state is
needed to tell them apart. A card drag wants the most *precise* thing under the
pointer (the card). A column drag wants the *least* precise (the column) — the
cards inside are noise, since a column can only land relative to another column.
Day columns are filtered out too: `kind === "list"` means dragging a list column
up over the calendar half finds nothing, and the drop is a no-op rather than a
nonsense reorder.

**Why not `closestCorners` alone** (the original implementation): it measures
the *dragged element's* corners against each droppable's corners. The drag
overlay is much wider than the gutter between columns, so an item straddling a
boundary had corners roughly equidistant from two columns — the winner
flip-flopped, or resolved to a column the cursor was never over. The item
appeared to hover between two zones, droppable in neither. **The user's cursor
never entered the calculation at all.**

`pointerWithin` asks the question that matches user intent: *what is under the
cursor?* Columns fill their half's full height, so any point inside one resolves
to it. This is the "always droppable when over a column" guarantee.

**`closestCorners` must stay as the fallback.** Two cases have no pointer to
consult:
1. the few pixels of container padding belonging to no column, and
2. **keyboard drags, which have no pointer coordinates at all.**

Removing the fallback silently breaks keyboard dragging — an accessibility
regression that no current test catches.

### 4.3 `preferPreciseTarget` (in `lib/board.ts`)

The pointer is usually inside **both** a card and the column containing it.

- Prefer the **card** → precise insertion point.
- Fall back to the **column** → "append to the end".

Pure function, unit-tested, so the rule is verifiable without hand-dragging.

### 4.4 Drag handlers (`board.tsx`)

| Handler | Job |
|---|---|
| `onDragStart` | sets **either** `activeTodo` or `activeList`, never both |
| `onDragOver` | sets `overId` — needed for both insertion indicators |
| `onDragEnd` | branches on gesture, resolves target, computes position, writes |
| `onDragCancel` | clears state (Escape mid-drag must not strand outlines) |

`activeTodo` and `activeList` are mutually exclusive, which is load bearing:
`isDragActive={!!activeTodo}` is what drives the columns' candidate outlines, so
a column drag automatically produces none of the card-drag chrome.

Two derived values, both `useMemo`:

- `overTodoId` — null if `over` is a column, and **null if `over` is the dragged
  card itself**; an indicator above the item being moved would imply a no-op drop.
- `columnDrop` — `{listId, side}` for the column insertion bar. Derived rather
  than stored **so the indicator and the write cannot disagree**: `onDragEnd`
  calls the same `planListDrop()` with the same inputs. If it were stored in
  state, a missed render would show the bar in one place and write another.

### 4.5 Drop resolution

```
over is a card    -> that card's column, insert AT that card's index
over is a column  -> that column, append at the end
```

Then:

```ts
const ordered = siblings.filter((t) => t.id !== todo.id);   // ← critical
const position = positionForIndex(ordered, index);
```

**The dragged item must be excluded from its own sibling list**, or it becomes
one of its own neighbours and the new key can land on the wrong side of it.

Writes, by target kind:

- `list:` → `moveTodoToList(id, listId, position)` — **clears `scheduledDate`**
- `day:` → `scheduleTodo(id, day, position)` — **keeps `listId` and labels**
- `overflow` → **refused**, toast only (see §5.1)

### 4.6 Ordering

`position` is a fractional index string sorting lexicographically. A reorder
writes **one field on one record**, never a renumbering.

This matters for sync (P3, not yet built): two devices reordering the same list
offline generate different keys instead of fighting over integers, so the merge
stays a plain field-level last-writer-wins.

### 4.7 The drop animation flies to the landing spot, not back home

This was a bug fix, and like §4.2 it was not a timing problem.

dnd-kit's default drop animation is **hardcoded to animate the overlay back to
the source draggable's rect** (`core.esm.js`, `defaultDropAnimation`: the delta
is `dragOverlay.rect.left - active.rect.left`, where `active` is the node the
drag started from). That is right for a sortable list where the item returns to
a slot near where it began. It is wrong for this board, where the entire point
is that the item is going *somewhere else*.

What the user saw: release the card, watch the ghost snap back toward the
column it came from, then a beat later see the card appear in the target column.
A successful drop read as a failed one that got corrected. The two events are
independent — the overlay's 150 ms return trip, and the Dexie write →
`useLiveQuery` → remount under a different React parent.

**The animation target is the drop indicator.** The insertion line
(`todo-card.tsx`) and the end-of-column line (`board-column.tsx`) already sit at
the exact pixel the item will occupy — that is their whole job. Flying to them
means the motion cannot promise something the drop will not deliver, and it
collapses "over a card" and "over a column" into one path with no prediction of
post-write layout. Both carry `data-drop-indicator`; `readLandingRect()` finds
the one on screen. At most one exists, since there is a single `over`.

Two things in dnd-kit make this work, and both are load-bearing:

1. **`onDragEnd` runs before React commits.** dnd-kit calls it inside
   `unstable_batchedUpdates`, after its own `DragEnd` dispatch. The indicator is
   therefore still in the DOM when the handler starts — **but not after the
   first `await`.** `readLandingRect()` must stay at the top of `handleDragEnd`.
2. **A `DropAnimationFunction` may return a Promise.** dnd-kit's
   `AnimationManager` keeps the cloned overlay mounted until it resolves, so the
   flight owns its own lifetime.

**`landingTodoId` hides one id across two different DOM nodes.** Between release
and the write landing it hides the *source* row: `isDragging` has already
cleared by then, so without it the row flicks from 30% back to full opacity and
then vanishes. After the write it hides the *destination* row, which now exists
but must not show until the ghost arrives. It renders at `opacity-0` rather than
being removed, so column heights never jump mid-flight.

Three details that look optional and are not:

- **The overlay wrapper is measured with `getBoundingClientRect()`, not
  `dragOverlay.rect`.** dnd-kit measures whichever node it deems "measurable",
  which for a single-child overlay is the *child* — and this overlay's child is
  tilted, scaled and `max-w-xs`-capped, so its box is not the wrapper's.
- **The tilt is an inline style (`LIFTED`), not `rotate-2 scale-[1.02]`.**
  Whether Tailwind emits `transform` or the individual `rotate`/`scale`
  properties decides whether the settle animation composites or *doubles* the
  tilt. Inline style removes the guess.
- **There is a backstop timeout on `landingTodoId`.** `onLand` only fires if
  dnd-kit gets as far as invoking the drop animation; it bails early if the
  overlay cannot be measured. A row stuck at zero opacity looks like data loss.

No landing rect means no flight, and dnd-kit's return-to-source animation
stands. That is the correct read for **Overflow** (§5.1) — the item visibly goes
back where it came from — and for Escape, a release over nothing, and a drop
onto the dragged card itself. It is also what `prefers-reduced-motion: reduce`
gets: an instant swap, the repo's first reduced-motion handling.

`landingTransform()` is pure and unit-tested. The animation itself needs layout
and WAAPI, so it is not testable here — see the caution at the end of this doc.

### 4.8 Sensors

```ts
useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
```

The 4px activation distance keeps clicks distinguishable from drags — without
it, clicking a card's title to open the detail sheet starts a drag instead.
**This is now load bearing**, not just a nicety: since the whole row is a drag
surface (§4.9), that threshold is the only thing separating a tap on the
checkbox or the title from a drag.

---

### 4.9 The whole row drags; the grip is still a real control

Pointer drags start anywhere on the row — `onPointerDown` from `useSortable`'s
listeners sits on the row element. Two things deliberately stay on the grip:

- **`attributes` and the keyboard activator (`onKeyDown`).** `attributes`
  carries `role="button"`, `tabIndex` and `aria-roledescription`. Putting those
  on the row would make a focusable button that *contains* a checkbox and
  another button — nested interactive content, which breaks both tab order and
  screen-reader semantics. The grip is already a real focusable control, so it
  keeps them.
- **`touch-none`.** `touch-action: none` is what stops the browser claiming a
  touch gesture for scrolling before dnd-kit's 4px threshold is met. Putting it
  on the row would cost the columns their touch scrolling entirely, so on touch
  the grip remains the drag surface. Mouse and pen drag from anywhere.

**Two objections that the old code was built around turn out to be dnd-kit's
job, not ours** — worth knowing before "restoring" any of this:

- *Text selection.* `AbstractPointerSensor.handleStart` calls
  `removeTextSelection()` and then registers a `selectionchange` listener that
  keeps clearing it for the duration of the drag.
- *A drag also firing a click, opening the detail sheet.* The same method
  registers a **capture-phase `click` listener on the document that stops
  propagation**, and `detach()` deliberately leaves document listeners attached
  for 50 ms after the drag ends specifically so that click is caught.

Below the 4px threshold nothing activates and no listener is registered, so a
tap on the checkbox or the title behaves exactly as it did before.

Cursors are set explicitly on the row, the title and the checkbox rather than
left to inherit. `cursor` is an inherited property and Tailwind v4's preflight
does not set one on `button`, so the children would otherwise silently pick up
`grab` — including the checkbox, which should not advertise itself as a drag
surface even though it is one.

---

### 4.10 Reordering list columns

The planning half's columns can be dragged into a new order. Day columns cannot
— they are date-ordered, so "reorder" has no meaning there.

**Lists already had everything needed in the data model.** `List.position` is a
fractional index and `useLists()` already sorted by it, so this added no schema
change and no migration: a reorder is `updateList(id, {position})`, one field on
one record, exactly like a todo reorder (§4.6).

**Columns are dragged by a handle, not by their body.** This is the opposite
choice from cards (§4.9), and for a concrete reason: a column's body is full of
cards that are themselves drag sources, so a pointerdown on a card would bubble
straight into a column drag. The header is the only surface in a column with no
competing gesture. `ColumnGrip` is a separate component because the hook must
not run for columns that cannot be reordered, and hooks cannot be conditional —
rendering it conditionally is how "this column is draggable, that one is not"
gets said.

**Direction decides the side**, the way every sortable list does it:

```
dragging rightwards onto a column  -> land AFTER it
dragging leftwards  onto a column  -> land BEFORE it
```

Without direction, hovering a column could only ever mean "insert before", and
**the last slot would be unreachable** — there would be no way to drag a column
to the end. The insertion bar renders on the matching edge, so before/after is
visible rather than inferred.

**Backlog is pinned leftmost structurally, not by clamping.** `planListDrop()`
filters Backlog out of the movable set entirely and only ever uses it as the
lower bound for the first slot. There is no arithmetic path through that
function that produces a key below it. It also has no drag handle, and returns
null if asked to move it. Clamping an index would have worked too, but this way
the invariant is a property of the shape of the data rather than a guard that
someone can later "simplify" away.

Dropping a column onto Backlog means "as far left as allowed" — i.e. the slot
immediately after it — rather than being refused. Refusing would be technically
correct and practically annoying.

`planListDrop()` is pure and unit-tested, including the exact case that prompted
it: grab the last column, drop it on the leftmost movable one, land between
Backlog and that column.

### 4.10b Reordering tabs, and carrying a card between them

Tabs are the third gesture in the same `DndContext`. Reordering them is
`planTabDrop()` — `planListDrop()` with the Backlog special-casing removed,
since tabs have no pinned member (the default tab is undeletable, not
immovable). Same direction rule, same insertion bar, same `data-drop-indicator`
so the overlay lands on it.

**Hovering a tab mid-card-drag focuses that tab.** Pick up a to-do, hold it over
another tab for ~600 ms, and the planning half switches; drop it into one of the
columns that just appeared. Without this, moving a to-do to another tab would be
a drop, a click, and a second drag.

Three things make it work, and two of them are easy to lose:

1. **`measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}` on
   `DndContext`.** By default dnd-kit measures droppables once, when the drag
   starts. A tab switch unmounts every column droppable and mounts a new set, so
   with the default the columns that appear are **invisible to the card already
   in flight** — it hovers them and drops into nothing. Silently. If cross-tab
   drops ever stop working, look here first.
2. **The dwell timer.** The strip sits between the two halves, so a card dragged
   upward crosses it. Switching on contact would flip through every tab on the
   way past. The timer is keyed on `overId`, so leaving a pill before it fires
   cancels it — React tears the effect down on every change of target.
3. **`preferPreciseTarget` knowing about `tab:` ids** (§4.1, §4.3). A pill is
   not a column, so under the old `!isColumnId()` test it would be taken for a
   card, looked up in `todos`, and not found.

**Releasing a card *on* a pill writes nothing.** By then the tab has already
switched and the card belongs in a column, so the handler refuses explicitly and
leaves the landing rect null — the card visibly returns home rather than flying
into the strip. Distinct from Overflow's refusal (§5.1), which raises a toast;
this one is silent, because the tab switch the user just watched is the feedback.

### 4.11 The React Compiler rejects refs read during render

Worth knowing before restructuring anything in `board.tsx`. The drop animation
was first written as a factory called during render:

```ts
// REJECTED by react-hooks/refs — "Cannot access refs during render"
useMemo(() => createLandingDropAnimation({
  getLandingRect: () => landingRectRef.current,
}), [])
```

Handing a ref-reading closure to a plain function during render is exactly what
that rule catches, and it is right to: nothing guarantees the function will not
call the closure immediately. The fix was to change the module's shape rather
than silence the rule — `runLandingDropAnimation(args, {landingRect, onLand})`
takes the rect as a plain argument, and `board.tsx` reads the ref inside a
`useCallback` body, which only runs when dnd-kit invokes the animation.

Related: dnd-kit types its listeners as bare `Function`, which spreads onto an
element fine but **cannot be assigned to a typed handler prop**. `todo-card.tsx`
splits `onPointerDown` and `onKeyDown` across two different elements, so it
casts the map once at the top rather than at each site.

### 4.12 Columns have a floor and a ceiling, so the halves really scroll

Layout, but it changes what drag-and-drop has to cope with, which is why it is
here rather than only in `ARCHITECTURE.md`.

**Until recently the halves could not overflow.** Every column was
`min-w-0 flex-1`, so N columns always divided the available width between them
however thin that made each one. Both halves carried `overflow-x-auto` and
neither ever used it — earlier revisions of §7 below described horizontal
scrolling as something that existed, and it did not. It was dead CSS.

Columns are now bounded:

```
--column-min       10.5rem (168px)   day columns
--list-column-min  calc(--column-min + 50px) = 218px   planning columns
--column-max       18rem   (288px)   both
```

The **floor** is what creates the overflow: once more columns exist than fit at
`--column-min`, the track scrolls instead of squeezing every column into an
illegible sliver. The **ceiling** is the same idea from the other side — without
it, two lists on a wide display stretch into slabs where a five-word to-do
occupies a foot of width.

**168px is not arbitrary.** It is the largest floor at which the default view —
Overflow plus a seven-day week, eight columns — still fits a 1440pt laptop
without scrolling. A wider floor means the most common window size opens on a
half-clipped Sunday, which reads as a bug rather than as an affordance. If the
day-count toggle or the Overflow column ever changes, that number is the thing
to recompute.

**The planning half's wider floor is set on the track, not on each column.**
`BoardColumn` reads `--column-min`; the planning container overrides that one
property, so every column inside — including the create-list slot — widens
without a size prop threaded through the component.

**The scrollbar is drawn with `::-webkit-scrollbar`, not `scrollbar-width`.**
The standard property is the tidier spelling and was tried first, but on macOS
it leaves the scroller on *overlay* scrollbars: invisible until a scroll is
already under way, which is the one moment the affordance is not needed. Styling
the pseudo-element opts the scroller out of overlay entirely. The two cannot be
combined — Blink ignores these pseudo-elements outright once `scrollbar-width`
is set to anything but `auto`, so adding it back "for Firefox" would silently
return every Chrome user to overlay. Firefox keeps its native behaviour.

`column-track` deliberately sets **no `overflow-y`**. Left unset it computes to
`auto` alongside the x-axis, so a column whose cards run past the bottom of the
half scrolls; `hidden` would clip it.

**What this means for dragging.** Droppable rects now genuinely live inside a
scrolling container, and dnd-kit's `autoScroll` prop defaults to `true`
(`node_modules/@dnd-kit/core/dist/core.cjs.development.js:2858`). Items 2, 3 and
9 in §7 were written when the halves could not overflow at all, so they describe
a gap that has never actually been observed under the current layout. They are
now *reachable* and *unverified* — see the rewritten entries.

---

## 5. Deliberate behaviours — do not "fix" these

### 5.1 Overflow refuses drops

Dropping onto Overflow does **not** reschedule. It shows a toast and does
nothing. Overflow means "you have put this off too long"; parking things there
manually defeats its purpose. It is styled as a **rejecting** target (red-tinted
outline) so the refusal is visible *before* release rather than arriving as a
surprise toast after.

> This is a product decision, not an oversight. It has been questioned once and
> deliberately kept. If it changes, it should be because the product owner asked.

### 5.2 A todo renders in one half or the other, never both

Scheduling does **not** clear `listId` or labels — membership is preserved, the
todo simply renders in the calendar half instead. Dragging back to a list clears
`scheduledDate`.

### 5.3 Items scheduled outside the visible window fall back to their list

Shown dimmed with a date chip (`awayTodoIds`). Otherwise something scheduled
three weeks out would appear in neither half. **Consequence: changing the
1/3/5/7-day toggle changes which todos appear in the bottom half.** Intended.

### 5.4 One grip, always left of the name, small mark and large target

`DragGrip` (`drag-grip.tsx`) is the single affordance for everything draggable —
todo rows and list columns both. It is one component on purpose: a grip that
sits somewhere else, or is a different size, on a card versus a column reads as
two unrelated controls rather than one idea.

Three rules, and each has a failure mode if changed:

- **Always immediately left of the title or name.** On a column that meant
  moving it out of the header's right-hand action cluster. Backlog, which cannot
  be reordered, renders an **empty slot of the same width** — without it, its
  title would sit flush left while every neighbouring column's title was
  indented past a grip. Day columns have no grips at all, so they reserve
  nothing.
- **12px icon.** Small enough to stay quiet next to the text it precedes.
- **24×24 hit area**, the WCAG 2.2 "Target Size (Minimum)" floor, applied with
  an absolutely positioned `::before` rather than padding. Padding would have
  grown the button's box and pushed the title along with it; the pseudo-element
  costs nothing in layout, and pointer events on it still resolve to the button.
  On a card the expansion stops ~2px short of the checkbox, so **widening it
  further would start stealing clicks from that control.**

Hover is a colour change, not a background fill — a filled box around a 12px
icon undoes the point of making the mark small.

> `before:absolute`, `before:-inset-1.5` and `before:content-['']` were checked
> against the built CSS, per the warning at the end of §6. They emit.

### 5.5 The grip is faintly visible at rest

`text-muted-foreground/30`, darkening on hover — not hidden. A control that only
exists on hover is undiscoverable until you happen to sweep over it. This was
the original complaint that prompted the affordance work.

It stayed after the whole row became draggable (§4.9). It is no longer the only
way to start a pointer drag, but it is still the keyboard activator, still the
touch drag surface, and still the thing that *advertises* that a row can be
dragged at all — nothing else on the row does.

### 5.6 The "Create list" card is column-shaped but is not a drop target

`create-list-column.tsx` renders as the last slot in the planning track, sized
exactly like a list column so it shares the track's rhythm. That position is the
point: it is what you reach by scrolling right, and it is also where the new
list appears, since `createList()` writes `positionAtEnd()`. ⌘K could already
create a list, but only if you knew it could.

**It is not registered with `useDroppable`, on purpose.** Making it one would
mean answering what "drop a to-do onto Create list" does — create a list named
after the to-do? create an untitled list and move the item into it? — and every
answer is worse than not offering the gesture at all.

Two consequences worth knowing before changing it:

- A **card** dragged over it finds no collision there, so `pointerWithin`
  returns nothing and `closestCorners` falls back to the nearest real column.
  The card lands in a list, never on the button.
- A **column** dragged over it likewise finds nothing, so no insertion bar
  renders and the drop is a no-op. The end slot is still reachable the normal
  way: drag rightwards onto the last real column (§4.10).

Its own interaction is a plain button → autofocused field. Enter commits,
Escape abandons, blur commits what was typed — matching the per-column quick-add
inputs rather than inventing a third convention. It records to the undo stack
and toasts with an Undo action, the same shape the palette's creates use.

---

## 6. Visual states

**Card** (`todo-card.tsx`)
- whole row is `cursor-grab` / `grabbing`; the checkbox overrides to
  `cursor-pointer` so it still reads as a control (§4.9)
- `DragGrip` leftmost, faintly visible at rest → darker on hover (§5.4)
- dragged source stays at **30% opacity** so the column does not collapse under
  the cursor
- insertion line: 2px primary bar + leading dot, absolutely positioned at
  `-top-px`, drawn *above* the hovered card. Carries `data-drop-indicator` —
  it doubles as the drop animation's target (§4.7), so its position is load
  bearing, not just decorative
- landing row held at `opacity-0` while the overlay flies to it

**Column** (`board-column.tsx`) — three mutually exclusive drag states:

| State | Condition | Style |
|---|---|---|
| candidate | drag active, not hovered | dashed 1px border outline |
| active | hovered, accepts | solid 2px primary outline + `bg-primary/5` |
| rejecting | Overflow | dashed/solid destructive outline + `bg-destructive/5` |

All four are **card-drag** states and are suppressed during a column drag. A
column drag hovers the same droppables, but there the hovered column is only a
*reference point* for where the dragged one lands — outlining it as "the target"
would say the wrong thing. During a column drag the insertion bar speaks alone.

All use `outline-offset-[-2px]` to draw inside the column bounds.

Hovering a column but no specific card renders an end-of-column indicator
instead of a per-card line.

**Column reorder** (`board-column.tsx`, `column-grip.tsx`)
- the same `DragGrip`, in the header immediately left of the list name; Backlog
  reserves the slot but shows none, and day columns reserve nothing (§5.4)
- insertion bar: 2px primary vertical rule on the **left** edge for "before" and
  the **right** edge for "after", full column height, also carrying
  `data-drop-indicator` so the column chip gets the same soft landing as a card
- overlay is a compact chip with the list name, sharing the card overlay's
  `LIFTED` tilt

**Track** (`globals.css`, `column-track`) — each half draws a persistent
horizontal scrollbar whenever its columns overflow, and none when they do not.
It is the only always-on chrome either half has, and it is the reason the
create-list slot is discoverable at all on a narrow window. See §4.12 for why it
is a `::-webkit-scrollbar` and not `scrollbar-width: thin`.

**Create list** (`create-list-column.tsx`) — dashed border, centred `+` and
label; hover firms the border and lifts the text out of muted. No drag states at
all, because it is not a droppable (§5.6). While its field is open the dashed
border stays but the card fills faintly, so it reads as the same slot mid-edit
rather than as a new element.

**Overlay** (`board.tsx`) — tilted 2° and scaled 1.02 via the inline `LIFTED`
style, plus ring + shadow, so the item reads as lifted off the board rather than
sliding along it. On release it flies to the drop indicator over 200 ms while
settling flat and morphing to the destination column's width, then crossfades
into the real row over the final 90 ms. See §4.7.

> Tailwind silently drops classes it does not recognize, so a typo leaves an
> outline as an invisible no-op with everything still "passing". Verify new
> utilities actually emit CSS:
> `grep -oE "outline[a-z-]*:[^;]{0,30}" .next-static/_next/static/chunks/*.css | sort -u`

---

## 7. Known gaps / candidate next work

Nothing here is started. (Column reordering used to be item 7 here; it is now
§4.10. The drop animation and whole-row dragging were also delivered from this
list — see §4.7 and §4.9.)

1. **Keyboard drag is wired but never exercised end-to-end.** Sensors and the
   `closestCorners` fallback exist; the actual flow (Tab to grip → Space → arrows
   → Space) has not been verified. Screen-reader announcements
   (`announcements` / `screenReaderInstructions` on `DndContext`) are entirely
   unconfigured — dnd-kit's defaults are generic and say nothing about days or
   lists.
2. **Auto-scroll while dragging to an off-screen column — status unknown.**
   This entry used to read "no auto-scroll", but it was written when the halves
   could not overflow at all (§4.12), so the behaviour it describes was never
   observed. Both halves now really do scroll, and dnd-kit enables `autoScroll`
   by default, so dragging toward the edge may already work. **Nobody has
   dragged it.** Verify before either fixing or closing this.
3. ~~No cross-half scroll affordance.~~ Done, though not the way this entry
   meant: each half has its own persistently-drawn horizontal scrollbar
   (§4.12), so "there is more board this way" is visible without a drag.
4. **Touch is untested, and now asymmetric.** Cards drag from anywhere with a
   pointer but **only from the grip on touch** — `touch-action: none` on the row
   would cost the columns their touch scrolling (§4.9). Columns likewise drag
   only from their header grip. `activationConstraint: {distance: 4}` may need
   `delay`+`tolerance` on touch so a drag does not fight page scroll. Matters
   for Capacitor (P7), and is the most likely place this all falls over.
5. **No multi-select drag.**
6. **Overlay width vs. cursor.** The overlay is `max-w-xs`; on a narrow column
   it visually overhangs neighbours while only the cursor's column highlights.
   Correct, but arguably reads oddly — worth a look.
7. **Column reorder has no keyboard path.** `ColumnGrip` is a focusable button
   with dnd-kit's attributes, so Space should start a keyboard drag, but the
   `sortableKeyboardCoordinates` getter is tuned for sortable lists and columns
   are plain draggables. Unverified.
8. **`onDragOver` sets state on every move.** Fine now; if the board grows to
   hundreds of todos, profile before adding more per-move work.
9. **Reordering columns past the visible edge.** Same open question as item 2,
   and now easy to hit on purpose: the planning half starts scrolling *earlier*
   than the calendar half, because its floor is 50px higher (§4.12). Six lists
   on a 1440pt display is enough.
10. **The create-list slot is not keyboard-reachable mid-drag**, and does not
    need to be — it is not a droppable (§5.6). Noted only so it is not
    "discovered" as a missing target later.

---

## 8. Working on this

```bash
npm run dev        # http://localhost:3000 (or the next free port if taken)
npm test           # vitest run — 119 tests
npm run verify     # typecheck + lint + tests + BOTH builds; run before commit
```

`npm run verify` must stay green. It includes a **static-export build** that
guards the future Capacitor target — if it fails, an app route took a dependency
on RSC data fetching, middleware, or `next/image`.

### Testing drag-and-drop

Pure logic — `preferPreciseTarget`, `parseColumnId`, `parseListDragId`,
`planListDrop`, `landingTransform`, `positionForIndex`, `buildBoard` — is
unit-testable and already covered. **Prefer extracting a pure function over
testing dnd-kit itself**; jsdom/happy-dom has no layout, so rect-based collision
logic cannot be meaningfully tested there.

**Manual checklist — cards**

1. Hover a card — grip visible before hover, darkens on hover. It sits leftmost,
   is a 12px mark, and its hit area extends ~6px past the icon in every
   direction: press just outside the icon and the drag should still start.
   Press on the checkbox and it must still toggle — that is the boundary the
   expansion deliberately stops short of.
2. **Drag from the title, the badges, the row padding — anywhere.** Then the
   three things the 4px threshold protects: a plain click on the title still
   opens the sheet; a click on the checkbox still toggles and does *not* open
   the sheet; and after a real drag, the sheet does **not** open on release.
   Drag across text and confirm no selection is left behind.
3. Drop into another column — the ghost flies from the cursor to the indicator
   and settles. **No return trip toward the source, and the card never appears
   twice.** Check both directions across halves; their columns differ in width,
   so this exercises the width morph.
4. Start a drag — **every** column outlines dashed at once.
5. Straddle two day columns — the column under the **cursor** highlights solid,
   even though the card overlaps its neighbour. *(This was a reported bug.)*
6. Cross a boundary slowly — highlight switches cleanly, no dead zone or flicker.
7. Hover empty space low in a column — still highlights; indicator at the end.
8. Hover a specific card — indicator jumps to that card.
9. Drag over Overflow — red-tinted; drop refused with a toast; ghost returns to
   source rather than landing.
10. Escape mid-drag — all outlines clear, no invisible row.
11. List → day: item leaves the list column, appears under the day.
12. Day → list: item returns, `scheduledDate` cleared.
13. Keyboard: Tab to grip → Space → arrows → Space. The landing works here too —
    the indicator renders from `over` regardless of input device.
14. macOS Reduce Motion on — the swap is instant, no flight, no invisible row.
15. Drop, then immediately start and drop a second drag while the first is still
    in the air. Neither row is left invisible.

**Manual checklist — column reordering**

16. Grab the header grip of the last list and drop it on the leftmost movable
    column. It lands **immediately after Backlog, never before it.** *(This was
    the requested behaviour.)*
17. Drag a column rightwards onto the last one — it lands **after** it, i.e. the
    end slot is reachable. The insertion bar sits on the right edge.
18. Drag leftwards — bar sits on the left edge, and the column lands before the
    target.
19. Drop a column onto Backlog — lands just after it, no refusal.
20. Confirm **Backlog has no grip**, but that its title still lines up with the
    other list titles — the empty slot is reserved. Day columns have neither.
21. Grab a column by the padding just outside its grip icon — the drag should
    still start, from the same 24×24 target a card grip has.
22. During a column drag, confirm the card-drag chrome stays away: no dashed
    candidate outlines, no solid outline on the hovered column, no card
    insertion line. Only the vertical bar.
23. Drag a column up over the calendar half and release — nothing happens, no
    crash, no stray reorder.
24. Drop a column on itself — no-op, no spurious write.
25. Reload after each reorder — the order persists (it is a real `position`
    write, not view state).

**Manual checklist — the scrolling track (§4.12)**

Layout, but every item here changes what a drag has to reach.

26. Narrow the window until each half overflows. A horizontal scrollbar appears
    in **both** halves and is drawn at rest, not only mid-scroll. Widen again
    and it goes away.
27. The planning half should start scrolling **before** the calendar half —
    its floor is 50px higher. Six lists on a 1440pt display is enough.
28. Scroll a half fully right: the last column is not jammed against the edge —
    the container's `px-4` is honoured at the scroll end.
29. **Not yet verified by anyone**: scroll a half so a target column is
    off-screen, then drag a card toward that edge and hold. Does the track
    auto-scroll? §7 item 2 is open on exactly this. Repeat for a column drag.
30. Dark mode — the scrollbar thumb is a `color-mix` off `--foreground`, so
    check it is visible against the darker track rather than vanishing.

**Manual checklist — the create-list slot (§5.6)**

31. Scroll the planning half fully right — the dashed **Create list** card sits
    past the last list.
32. Click it, type a name, Enter. The new column appears immediately to its
    left; the card stays last. ⌘Z (focus outside any input) reverses it.
33. Type a name and click away instead — it still commits. Press Escape
    mid-typing — it discards and returns to the button.
34. Drag a card over the create-list card and release. It must land in the
    nearest real list, **never** on the button, and nothing may be created.
35. Drag a list column over it. No insertion bar, no write, no crash.

### A caution

Every drag-and-drop bug found so far — the invisible grip, the dead zone between
columns, the ghost flying home instead of to the drop — was invisible to
typecheck, lint, and unit tests. They only appear when a human drags something.
**Do not report drag work as verified on the strength of a green test run.** Say
what was and was not exercised by hand.

The corollary, and the reason this file keeps growing: when the answer turns out
to live in dnd-kit's source rather than its docs, **write down what you found
and the line it was on**. Three separate pieces of work here — the collision
rewrite, the drop animation, the whole-row drag — each began by re-deriving
behaviour someone had already read once. §4.7 and §4.9 exist so the fourth
person does not have to.
