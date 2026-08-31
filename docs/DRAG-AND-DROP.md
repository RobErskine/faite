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
| `src/components/board/board.tsx` | The shell: mounts the one `DndContext` and the one `DragOverlay`. The handlers themselves moved out — see the next row |
| `src/components/board/use-board-actions.ts` | Sensors, `collisionDetection`, `keyboardCoordinates`, and every drag handler (`handleDragStart`/`Over`/`End`/`Cancel`). **The file to open first** |
| `src/components/board/use-board-data.ts` | The derived drag values — `overTodoId`, `overGroupId`, `columnDrop`, `listDayDrop`, `selectedTodos`. Each mirrors a write in `handleDragEnd` and must not disagree with it (§4.4) |
| `src/components/board/use-board-ui-state.ts` | Owns all drag state (`activeTodo`/`activeList`/`activeTab`, `overId`, `landingTodoIds`) plus the multi-selection (§4.14) |
| `src/components/board/board-column.tsx` | `useDroppable` + `SortableContext`; `useDraggable` for column reorder; whole-header drag; drop-target visual states |
| `src/components/board/todo-card.tsx` | `useSortable`; whole-row drag, out-of-flow grip, priority rail, inline location pin, insertion line |
| `src/components/board/drag-grip.tsx` | The one grip affordance, shared by rows, columns and tabs |
| `src/lib/priority.ts` | `PRIORITY_RAILS` — the width and colour of a card's priority rail, shared with the drag overlay chip; `byPriorityThenPosition`, which orders a group |
| `src/lib/board.ts` | Id codecs, `preferPreciseTarget()`, and every pure drop planner — `planListDrop`, `planTabDrop`, `planListTabDrop`, `planListDayDrop` (§4.10e), `selectedTodosInBoardOrder`/`rangeSelectionIds` (§4.14). Plus `TodoGroup`, `listSortKey`, `byListGroup`, `dayGroupId` — the calendar half's computed grouping (§4.13) |
| `src/components/board/create-list-column.tsx` | End-of-track "Create list" slot. Column-sized, deliberately **not** a droppable (§5.6) |
| `src/components/board/use-day-track.ts` | Pure scroll-position/jump math for the day track (anchor index, jump clamping) — not itself drag-and-drop, but shares the track dnd-kit measures |
| `src/components/board/date-nav.tsx` | Week/Month/Quarter jump buttons + calendar date picker above the day track |
| `src/components/board/use-rail-resize.ts` | Pure resize/collapse math (§4.12) plus the pointer/keyboard hook for a pinned panel's handle; disabled during any drag so it cannot race dnd-kit's cached rects |
| `src/components/board/rail-handle.tsx` | The draggable seam on a pinned panel's right edge — one per rail, resizing independently (§4.12) |
| `src/lib/rail.ts` | `RAIL_MIN`/`RAIL_MAX`/`RAIL_COLLAPSE_THRESHOLD`/etc. — shared so `schema.ts` can bound the stored width without importing a component |
| `src/app/globals.css` | `--column-min` / `--column-max` / `--list-column-min`, and the `column-track` utility (§4.12) |
| `src/lib/drop-animation.ts` | Drop animation: `readLandingRect()`, `landingTransform()`, `runLandingDropAnimation()` |
| `src/lib/ordering.ts` | Fractional index helpers. `positionForDropOnItem()` is the one a card drop uses — it keeps the exclude-the-dragged-item filter and the target lookup together (§4.5); `positionsForDropOnItem()` is its N-card counterpart (§4.14) |
| `src/lib/board.test.ts` | Tests for id codecs, target selection, column reordering |
| `src/lib/drop-animation.test.ts` | Tests for the landing rect math |
| `e2e/multi-drag.spec.ts` | Real-browser cmd+click and multi-card drag — the click/threshold interference happy-dom cannot reach (§4.14) |
| `e2e/support/hover.ts` | Real pointer input via CDP. `locator.hover()` cannot open a Base UI tooltip; see the caution at the end of §6 |

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

**`closestCorners` must stay as the *last-resort* fallback.** Two cases have no
real pointer to consult:
1. the few pixels of container padding belonging to no column, and
2. **keyboard drags, which have no pointer coordinates at all.**

Removing it entirely silently breaks keyboard dragging — an accessibility
regression no current test would catch.

**As of EI-114, a SYNTHETIC pointer — at the center of `collisionRect`, dnd-kit's
own name for the dragged element's current rect — is tried before falling all
the way to `closestCorners`,** for both cases above. `closestCorners` scores
every candidate by AVERAGING distance across all 4 corners, which structurally
favors a small card's rect over a large, empty column's rect even when the
column is the nearer of the two — its far corners drag the average up, and a
nearby card's corners cluster tight around a point regardless of which column
is genuinely closest. That is exactly how a keyboard drag could silently step
over an empty column sitting between two populated ones, or never cross from
the pinned Backlog rail into the calendar half: the corner-averaged winner was
not the geometric neighbor. Re-running `pointerWithin` with a made-up pointer
position costs nothing extra to reuse — it already nests card > group > column
correctly when more than one rect contains a point, exactly as it does for a
real cursor — and only degrades to `closestCorners` when nothing contains that
center at all (true padding, or the literal end of a track). See
`collisionDetection` and `keyboardCoordinates` in `use-board-actions.ts`, and
§7 item 1 below.

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
- `columnDrop` — `{listId, side}` for the actual landing computation. Derived
  rather than stored **so the display and the write cannot disagree**:
  `onDragEnd` calls the same `planListDrop()` with the same inputs. If it were
  stored in state, a missed render would show one thing and write another.

A third, `columnDropTargetId`, derives from `columnDrop` purely for display: it
is `columnDrop.listId`, **except** when that id is Backlog's, in which case it
is the first movable column's id instead. Backlog is a legitimate value for
`columnDrop.listId` — hovering it is a valid way to drop "as far left as
allowed" — but it must never render as highlighted (§4.10), so the two values
are kept separate: `columnDrop` for `onDragEnd`'s math, `columnDropTargetId`
for which column's `BoardColumn` receives `isColumnDropTarget`.

### 4.5 Drop resolution

```
over is a card    -> that card's column, insert AT that card's index
over is a column  -> that column, append at the end
```

Then, via `positionForDropOnItem()` (`lib/ordering.ts`, pure and unit-tested):

```ts
const ordered = siblings.filter((item) => item.id !== draggedId);   // ← critical
const index = ordered.findIndex((item) => item.id === overId);      // ← also critical
return positionForIndex(ordered, index);
```

**The dragged item must be excluded from its own sibling list**, or it becomes
one of its own neighbours and the new key can land on the wrong side of it.

**And the target's index must be read from that SAME filtered list.** This was
one function for a reason (EI-191): the two lines above used to live apart, with
`index` read from the unfiltered `siblings` in `handleDragEnd` and applied to
`ordered` — so removing the dragged card shifted every element after it up by
one, and a card dragged *downward* past its target landed one slot too low. The
insertion line is drawn **above** the hovered card (§6), so that was a visible
broken promise rather than an internal detail: hover C in an A/B/C/D column with
A in hand, watch the line render between B and C, release, and the card lands
between C and D.

It hid for so long because the other three cases are all genuinely unaffected —
a cross-column drop (the dragged card is not in `siblings`, so the filter is a
no-op), a same-column *upward* drag (the target sits above the dragged card, so
its index does not move), and an append-to-column drop (no target card at all).
Only the down-and-in-the-same-column quadrant was wrong, and fractional indexing
absorbs a one-slot error without ever looking corrupt.

Writes, by target kind:

- `list:` → `moveTodoToList(id, listId, position)` — **clears `scheduledDate`**
- `day:` → `scheduleTodo(id, day, position)` — **keeps `listId` and labels**
- `overflow` → **refused**, toast only (see §5.1)

### 4.6 Ordering

`position` is a fractional index string sorting lexicographically. A reorder
writes **one field on one record**, never a renumbering.

This matters for sync (P3, shipped): two devices reordering the same list
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
useSensor(MouseSensor, { activationConstraint: { distance: 4 } })
useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates })
```

`keyboardCoordinates` (`use-board-actions.ts`, EI-114) wraps dnd-kit's own
`sortableKeyboardCoordinates` rather than using it bare — see §4.2 and §7 item 1
for why, and §7 item 7 for the one keyboard path it does not touch.

The 4px activation distance keeps mouse clicks distinguishable from drags —
without it, clicking a card's title to open the detail sheet starts a drag
instead. **This is load bearing** for the mouse, not just a nicety: since the
whole row is a drag surface (§4.9), that threshold is the only thing separating a
click on the checkbox or the title from a lift. On touch the equivalent guard is
the 250ms delay, not a distance.

**Mouse and touch are two sensors, not one `PointerSensor`, and the split is
deliberate.** `PointerSensor` also claims touch, and `pointerdown` fires before
`touchstart` — so it activates first, `activeRef` is then non-null, and
`bindActivatorToSensorInstantiator` bails out of every sensor bound after it. A
`TouchSensor` added *alongside* a `PointerSensor` is unreachable code. Splitting
them is the only way touch gets an activation rule of its own.

That rule is a long press. Under 250ms, or a move of more than 8px inside it, the
browser keeps the gesture and the column scrolls as before — which is why no
element needs `touch-action: none` any more (§4.9). `TouchSensor.setup()`
registers a non-passive `touchmove` listener so the sensor can `preventDefault`
scrolling once it *does* activate; that listener is what the grip's `touch-none`
used to stand in for, and it covers the whole row rather than one 12px control.

The cost of the split: `MouseSensor` listens to `mousedown`, so a Windows stylus
relies on mouse-compatibility events rather than pointer events. Untested on
device, like the rest of touch (§7).

---

### 4.9 The whole row drags; the grip is still a real control

Mouse and touch drags start anywhere on the row — `onMouseDown` and
`onTouchStart` from `useSortable`'s listeners sit on the row element (the names
follow the sensors; see the warning in §4.11). One thing deliberately stays on the
grip:

- **`attributes` and the keyboard activator (`onKeyDown`).** `attributes`
  carries `role="button"`, `tabIndex` and `aria-roledescription`. Putting those
  on the row would make a focusable button that *contains* a checkbox and
  another button — nested interactive content, which breaks both tab order and
  screen-reader semantics. The grip is already a real focusable control, so it
  keeps them, and `Space` on it still lifts.

**`touch-none` used to be the second thing, and no longer is — as of P1 of the
mobile plan (docs/MOBILE.md), it's actually gone.** `touch-action: none` on the
grip was what stopped the browser claiming a touch gesture before dnd-kit's
distance threshold was met, which made the grip the only touch drag surface on
a card — an asymmetry with the pointer path that was never good, only
necessary. The `TouchSensor` long press (§4.8) replaces it: touch now drags
from anywhere on the row, and nothing needs `touch-action: none` to make that
work. The declaration sat in `drag-grip.tsx` as vestigial dead weight for a
while — costing a touch-scroll start on top of a 12px control and nothing
else — and P1 removed it once `e2e/touch-smoke.spec.ts` (a real CDP long-press
against a real touch input pipeline, not a simulated event) could actually
prove nothing depended on it.

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

### 4.9b Coarse pointers (P1, docs/MOBILE.md)

`useSensor(TouchSensor, ...)`'s `activationConstraint` is coarse-aware:

```ts
activationConstraint: coarse ? { delay: 400, tolerance: 5 } : { delay: 250, tolerance: 8 }
```

`coarse` from `useViewport()` (`pointer: coarse`). 250/8 was tuned against
nothing — no real touch input pipeline existed to test it against until
`e2e/touch-smoke.spec.ts` (CDP `Input.dispatchTouchEvent`, real dnd-kit
sensors, not a simulated event). Once that existed, the number was worth
checking against actual platform behavior: **250ms is shorter than iOS's own
long-press (~500ms) and Android's (~400ms)**, so a slow, deliberate
finger-plant at the *start* of a scroll — completely normal touch behavior —
read as "lift the card" more often than it should. 400/5 sits inside platform
long-press muscle memory instead of ahead of it, and the tighter 5px
tolerance (vs 8) trades a little accidental-cancellation margin for a smaller
window where a case that was a genuine drag gets read as a scroll.

A device that's merely touch-*capable* but not touch-*primary* — a
mouse-driven laptop with a touchscreen, `hover: hover` and `pointer: fine`
plus a touchscreen that can still fire `TouchSensor` events — keeps the
original 250/8. The distinction that matters is which input is doing the
asking, not whether touch is possible at all.

**Haptic feedback on lift**, gated the same way: `navigator.vibrate?.(10)` in
`handleDragStart` when `coarse`. Android honors it; iOS Safari silently
ignores it — no permission prompt, no error, so it costs nothing to leave
unconditional-on-touch rather than feature-testing for it.

**The grip is now visible at rest on touch**, not hover-revealed. Tailwind v4
gates `hover:`/`group-hover:` behind `@media (hover: hover)` — confirmed by
compiling the actual generated CSS during P1, not assumed — so a device that
can never hover would never see `group-hover:opacity-100` apply at all, ever,
by any interaction. `todo-card.tsx`'s grip adds `touch:opacity-100`
(`@media (hover: none)`, the one custom variant P1 kept — see
docs/MOBILE.md §3) specifically because there is no native equivalent for
"show this unconditionally where hover can't reach."

---

### 4.10 Reordering list columns

The planning half's columns can be dragged into a new order. Day columns cannot
— they are date-ordered, so "reorder" has no meaning there.

**Lists already had everything needed in the data model.** `List.position` is a
fractional index and `useLists()` already sorted by it, so this added no schema
change and no migration: a reorder is `updateList(id, {position})`, one field on
one record, exactly like a todo reorder (§4.6).

**Columns are dragged by their whole header, not by the grip alone.** Same
bargain as a card's whole row (§4.9), scoped one level in: `onMouseDown` and
`onTouchStart` sit on the `<header>`, while `attributes` and the keyboard
activator stay on the grip. It is the *header* rather than the whole `<section>`
because a column's body is full of cards that are drag sources themselves — a
press there has to mean "drag this card", not "drag its column". The header is the
only surface in a column with no competing gesture.

This was grip-only at first, on the theory that a header-wide drag surface
would fight something. It does not, and the grip-only version had a visible
tell: dnd-kit sizes the drag overlay from the source node's rect, so with the
12px grip as the source the column chip came out 12px wide with its name
truncated away to nothing. Dragging from the header makes the chip column-width
and the name legible, for free.

`useDraggable` is called unconditionally in `BoardColumn` with `disabled:
!reorderListId`, rather than from a child that only renders for movable
columns. Hooks cannot be conditional and this header markup is shared by every
column, so the alternative was two copies of it. A disabled draggable registers
but can never activate — and dnd-kit withholds its `listeners` entirely, so the
header of a day column gets no activator at all rather than a live one guarded by
a flag.

**Direction decides the side**, the way every sortable list does it:

```
dragging rightwards onto a column  -> land AFTER it
dragging leftwards  onto a column  -> land BEFORE it
```

Without direction, hovering a column could only ever mean "insert before", and
**the last slot would be unreachable** — there would be no way to drag a column
to the end. Direction still decides *where* the column lands; it no longer
decides *what renders*. See below.

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

**The drop target is one outlined column, not a before/after edge bar.**
Originally each column carried a 2px vertical rule on whichever edge
`planListDrop()`'s `side` pointed to — the same idea as a card's insertion
line, ported over. In practice it read as noise: a bar sitting flush against a
column's edge looks like an unwanted second border on that side, and it drew
attention to *which* edge rather than *which* column. Reordering five or six
columns does not need edge-level precision the way reordering fifty todos
does, so the display was simplified to the same "active" outline a card drag
already uses when `isOver` (`board-column.tsx`) — `bg-primary/5 outline
outline-2 outline-primary` on whichever single column `isColumnDropTarget`
names. `side` still exists and still drives `planListDrop()`'s arithmetic; it
just no longer drives anything on screen.

**Backlog can never BE that column, even while it is legitimately the raw drop
target.** `columnDrop.listId` is allowed to be Backlog's id — dropping there is
how "as far left as allowed" gets triggered — but outlining Backlog would claim
something false: there is no "before" for it to receive, and its own header has
no grip to promise the gesture in the first place. `Board` derives a second
value, `columnDropTargetId`, that redirects Backlog's id to the first movable
column's id before it reaches any `BoardColumn`. `onDragEnd` still reads the
raw `columnDrop`/`overId`, so dropping directly on Backlog computes exactly the
same position as before — only the outline moved, not the math.

A related leak, found while fixing the above: the little "insert at the end of
this column" dot a card drag draws (`isOver && !rejectsDrop && !overTodoId`,
just below the last card) was not gated on drag kind, so it lit up on whichever
column a column drag happened to be hovering — including Backlog, which is
exactly what read as "Backlog highlighting itself as a target" even though the
box outline never did. Gated with `!isColumnDragActive` now.

`planListDrop()` is pure and unit-tested, including the exact case that prompted
it: grab the last column, drop it on the leftmost movable one, land between
Backlog and that column.

### 4.10b Reordering tabs, and carrying a card between them

Tabs are the third gesture in the same `DndContext`. Reordering them is
`planTabDrop()` — `planListDrop()` with the Backlog special-casing removed,
since tabs have no pinned member (the default tab is undeletable, not
immovable). Same direction rule, and tabs keep their own before/after edge
insertion bar in `tab-strip.tsx` (`data-drop-indicator` on a 2px rule, not on
the pill itself) — columns moved away from that shape (§4.10) because there
are only ever a handful of them and the edge bar read as a stray border, but a
strip of many tabs is closer to the todo-list case, where edge-level precision
earns its keep.

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

### 4.10c Carrying a whole list to another tab (EI-115)

The fourth gesture, layered on the same dwell as §4.10b: grab a list column,
hold it over another tab's pill, and the planning half switches — drop among
the columns that just appeared (or on the pill itself) and the list, plus
every todo filed under it, moves there. Reported feedback: "if I took the 'To
Buy' list, dragged it over a different tab for a few seconds, that new tab
should become active and I can drop my list in this new tab."

**Todos carry `listId`, never `tabId`, so this is one field write on one
record.** `moveTodoToList`/`scheduleTodo` never enter the picture — nothing
about the todos changes, only which tab their list renders under. Scheduled
todos keep their day-column placement and keep grouping under the moved
list's name and colour either way, because `hiddenLists` (`use-board-data.ts`)
already passes cross-tab lists as records rather than ids (§4.13) — that
existed for the read path before this shipped, and needed no change.

**Three things had to give a list drag the same reach a card drag already
has:**

1. `collisionDetection`'s `listdrag:` branch (§4.2) filtered to
   `parseColumnId(...)?.kind === "list"`, so a tab pill was invisible to a
   column drag — no hover, no dwell, nothing. It now falls back to a pill
   collision when no column is under the pointer, same precedence a card
   drag doesn't need (a pill and a column are never both hit at once, since
   the strip and the track don't overlap).
2. The dwell effect (§4.10b) was gated on `activeTodo` alone. It now fires
   for `activeList` too — same 600 ms, same `overId`-keyed cancellation.
3. The "card released on a pill writes nothing" guard used to run before the
   list-reorder branch, so it silently swallowed a list dropped on a pill as
   well. The list branch now runs first and handles its own pill case.

**Unlike a card, releasing a list *on* the pill is not a no-op — it lands the
list at the end of that tab's track.** A card can always fall back to
"drop into one of the columns that just appeared," because a card drag can
reach any column in the newly-mounted track. A list drag cannot reach a
column past the last one any other way: `planListDrop`'s direction rule
(§4.10) needs a column to drag rightwards onto, and there is no on-screen
column past the end of a track that hasn't rendered yet until you already
switched to it. Releasing on the pill is the only route to that slot, so it
means something rather than nothing.

**Position is computed in the DESTINATION tab's own ordering, never the
source's — `planListTabDrop()` (`lib/board.ts`), not `planListDrop()`.**
`use-board-actions.ts` holds `lists` as the *global* array — every tab,
sorted by one shared position space — and `planListDrop`'s "did the pointer
move left or right" direction rule works by comparing the dragged column's
and the target's indices in that array. That comparison means nothing once
the two columns never rendered in the same track: the dragged list isn't
even a member of the destination tab's ordering yet. `planListTabDrop()`
sidesteps the question instead of answering it wrong — every cross-tab drop
lands **after** whatever it was dropped on (same convention `planListDrop`
already uses for "dropped on Backlog": arriving content, not a neighbour
changing places), scoped to `lists.filter(l => l.isBacklog || l.tabId ===
destinationTabId)`. `overListId: null` is the pill-drop case above, and
lands at the end of that filtered, ordered list.

**Backlog decides the destination tab by where it's rendered, not by its own
`tabId`.** Backlog carries `tabId: null` — it rides along on every tab — so
dropping a cross-tab list onto it can't read the destination off the target
the way dropping onto any other column can. It reads `activeTabId` instead:
by the time a column is droppable under the pointer, the dwell has already
switched the board to render it, so "whichever tab is currently on screen"
and "the tab whose track this column belongs to" are the same tab, same as
they are for a card (§4.10b, §4.2's `MeasuringStrategy.Always` note — the
same requirement, unrestated, is why the destination track's columns are
already visible to this drag too).

**Dropping a list back on the tab it's already on is a no-op**, whether that
lands on the pill directly (`dragged.tabId === overTabId` short-circuits) or
among its own track's columns (`destinationTabId` compares equal to
`dragged.tabId`, so the ordinary same-track `planListDrop()` path runs
instead — same behaviour as before this shipped, unchanged).

Undo restores both fields in one step: `inversePatch(dragged, { tabId,
position })`, not two separate undo entries — a half-undone cross-tab move
(list back on its old tab, but at some arbitrary new position, or vice
versa) would be a worse landing than either applied change on its own.

### 4.10e Carrying a whole list onto a DAY (EI-193)

The fifth thing a `listdrag:` gesture can mean. Grab a list column by its
header, drop it on a day, and every to-do in that list **that has not already
been assigned a day** is scheduled onto it. Reported ask: *"if I take my
'Grocery List' header and move it to a certain day, all of the items in that
list should move to that day. However in the grocery list, I already have a
todo to remind me to buy honey at the farmers market in 2 weeks. This item
should stay in the same spot."*

**`scheduledDate === null` is the entire test, and it is deliberately not
"does this render in the list column".** Those two are not the same set. A
to-do scheduled past the day cap renders in its list column too — dimmed,
with a date chip (§5.3) — and it has very much been assigned a day. Reading
placement instead of the field would silently drag every one of those back
into the visible window, which is the opposite of what the gesture promises.
`status === "open"` is the second filter, and it matters only once `done` is
visible in view settings: a settled, undated to-do sits in a list column
looking exactly like an open one, and scheduling it would resurrect finished
work into the calendar half.

**The list column itself does not move, and that is structural rather than
guarded.** The day branch `return`s before `planListDrop` is ever reached, so
there is no path through this gesture that writes `List.position`. No
`position` is written on the to-dos either — order in the calendar half is
computed (§4.13), so a fractional key there would be noise.

**Two gates had to open, and the second is the one that fails silently.**
`collisionDetection`'s `listdrag:` branch (§4.2) hard-filtered to list
columns plus tab pills, so a day column was not merely rejected — it was
never offered. Day columns are appended **last** in that precedence, after
the list column and the pill, so every case that resolved before still
resolves identically; a list column and a day column live in different halves
and can never both be under one pointer. Then `handleDragEnd`'s list branch
had `if (target?.kind !== "list") return;` as its first act.

**What `kind === "day"` excludes by omission is as load-bearing as what it
includes**, and all three are the wanted behaviour rather than oversights:

- **Overflow** parses as `{kind:"overflow"}`, never `"day"`, so it refuses a
  list drop exactly as it refuses a card drop (§5.1) — silently, with no
  outline and no toast.
- **A day group** is a `daygroup:` id, outside `parseColumnId` entirely, so
  hovering one resolves up to its containing day column. The arriving to-dos
  then group under their own list. That is right: a group is a statement
  about a list, and a list is what is in flight — but it looks like it should
  mean something else, so it has its own manual check.
- **A collapsed weekend strip** is a `weekend:` id, also outside
  `parseColumnId`. Nothing highlights, nothing writes. The hover-to-expand
  dwell is gated on `activeTodo`; extending it to list drags is a known gap
  (§7), not a decision.

**A day where nothing would move shows no outline at all**, and toasts on
release. `use-board-data.ts`'s `listDayDrop` memo gates the highlight on
`count > 0`, which honours §5.1's "the refusal is visible *before* release"
without inventing a fourth column state. The toast exists because this
refusal is otherwise unexplainable: the column is visibly full of cards, and
every one of them already has a day.

**`landingTodoId` became `landingTodoIds: ReadonlySet<string>` here**, and it
had to. One gesture now commits many to-dos, and with only the dragged id
held back every other mover pops into its destination while the overlay is
still travelling — precisely the failure the landing state exists to prevent
(§4.7). One overlay still flies; the rest wait for it. The write loop clears
the set in a `finally` as well as from `onLand`, because N sequential Dexie
transactions can outlast the `FLIGHT_MS + 250` backstop, and a row revealed
before its write lands reads as data loss.

Undo is one entry with N steps — `UndoEntry.steps` was already `UndoStep[]`,
so no new machinery. Each step carries **its own** `previousDate`; reusing
the list's or another mover's would restore the wrong dates on ⌘Z.

### 4.10d Tab strip legibility cleanup (EI-117 – EI-120)

Four small changes to `tab-strip.tsx` and `board-column.tsx`, none of which
touch drag mechanics — noted here because they live in the same file as
§4.10b/§4.10c and a future drag change should know what else the strip does.

**The filter placeholder names the column's size (EI-117, `board-column.tsx`).**
Idle placeholder reads `Filter N items` instead of a bare `Filter`, built from
`totalCount` (already threaded in for the `n of m` chip) with a `todos.length`
fallback. `aria-label` is untouched — the count is a visual hint, not part of
the accessible name.

**Tab pills show `(lists/items)` (EI-118).** `use-board-data.ts` computes
`tabCounts: Map<tabId, {lists, items}>` from raw `lists` + `nonTemplateTodos`,
not from `board` — `board.lists` only ever holds the ACTIVE tab's columns, and
`buildBoard` moves a scheduled todo out of its list column into a day column
entirely (§4.13), so a board-derived count would be wrong for every inactive
tab and too low for the active one. Backlog (`tabId === null`, pinned into
every tab) is excluded from both halves, same reasoning as
`archived-lists-sheet.tsx`'s `listsPerTab` — counting it everywhere would add
the same constant to every pill. The visible `(2/17)` is `aria-hidden`; a
paired `sr-only` span carries "2 lists with 17 items" as the real text, which
means it also becomes part of the pill button's accessible name — deliberate,
not a bug, since it gets a screen-reader user the count without a hover.

**The Archived button is icon-only (EI-119).** `aria-label="Archived"` on the
`<Button>` fully owns the accessible name. The count sits inline as
`aria-hidden` `(N)` text next to the icon — same shape as every tab pill's
`(lists/items)` — rather than a corner badge: a badge reads as "this needs
your attention," which an archive count is not, and real page feedback said
so. A `Tooltip` spells the count out on hover.

**The strip gets a visible scrollbar, edge fades, and scroll-into-view
(EI-120).** The scroll container already had `overflow-x-auto`; it now also
carries the `column-track` utility (`globals.css`) that every other scrolling
half of the board uses, because plain `overflow-x: auto` renders nothing on
macOS overlay scrollbars until a scroll is already under way. `canScrollLeft`/
`canScrollRight` state, updated on `scroll` and via a `ResizeObserver` on the
container, build a `mask-image`/`-webkit-mask-image` applied to the scroll
container itself — **not** a gradient-filled overlay div. The first attempt
used an overlay (`bg-gradient-to-l from-background to-transparent`), which
has to guess the surrounding background color to blend in, and guessed
wrong: the planning half's actual backdrop is `bg-muted/30`
(`desktop-board.tsx`), not `--background`, so the "invisible" fade rendered
as a visibly mismatched gray box — reported back as "a weird empty button."
A mask fades the alpha of the track's own content instead, so it's correct
against any backdrop with nothing to keep in sync.

That mask fix turned out to only be half of "a weird empty button," reported
again after it shipped. `column-track`'s CSS deliberately leaves
`overflow-y` unset so it computes to `auto` (§4.12's rationale: a genuinely
tall list column should scroll rather than truncate) — fine for a day or
list column, wrong for a strip that's a single row. Any stray 1px of
vertical overflow (a focus ring, a grip's `before:-inset-y-1.5` pseudo-
element) is enough for the browser to park a permanent vertical scrollbar
on the container, and its thumb — rounded via `column-track`'s own
`::-webkit-scrollbar-thumb`, sized to nearly the full row height when the
scrollable range is a single pixel — is what actually looked like a stray
button sitting between the last tab and Archived. Fixed with an inline
`overflowY: "hidden"` on the scroll container (inline so it beats
`column-track`'s class regardless of stylesheet order); the horizontal
scrollbar this section exists for is untouched, since only the vertical
axis was ever the problem.

A separate effect scrolls the active pill (`[data-tab-pill="<id>"]`) into
view with `scrollIntoView({inline: "nearest"})` on every `activeTabId`
change, so switching tabs from `⌘K` or the keyboard can't leave the newly
active pill off-screen. No new auto-scroll-on-drag code was added: dnd-kit's
own auto-scroll (§4.8) already reaches this container during a tab or list
drag.

### 4.14 Multi-select, and dragging a run (EI-194)

Cmd/Ctrl+click several cards, drag any one of them, and the whole selection
lands on the destination. Shift+click extends a range. This closed §7 item 5,
which had read "No multi-select drag" since the board was built.

**Two pieces of state, and the split is the load-bearing part.**
`selectedIds` is what the user has picked and can change *mid-flight* — a live
query lands, a filter effect fires, another device syncs a deletion.
`activeSelectionIds` is the **ordered snapshot taken at lift**, and
`handleDragEnd` reads only that. Same contract as `activeTodo` holding a
record rather than an id: the gesture commits exactly what was picked up, not
whatever the selection has since become.

**The selection is never pruned against the board.**
`selectedTodosInBoardOrder()` (`lib/board.ts`, pure) derives the live set on
every render, so a to-do that is deleted, archived, filtered out by
`visibleStatuses`, or carried to another tab leaves the selection by simply
not appearing. An effect that pruned the set instead would race the live
query, and a stale id reaching `mutate()` throws — that function refuses a
missing row on purpose (the "Untitled list" incident).

**One `onClickCapture` on the row is the entire interception point** — not the
title button, not the checkbox. Each of the three things it could have broken
is already handled by something else, and two of them by dnd-kit rather than
by us:

- **The 4px threshold is untouched.** `onMouseDown` still reaches
  `MouseSensor` first. And if a drag *did* activate,
  `AbstractPointerSensor.handleStart` has registered a capture-phase `click`
  listener **on `document`** that stops propagation and stays attached 50ms
  past `detach()` (§4.9). Document capture runs strictly before the row's, so
  a Cmd+drag can never also toggle selection. That is a guarantee from
  dnd-kit's source, not a timing hope.
- **The detail sheet still opens**, because the unmodified branch
  deliberately does *not* `stopPropagation` — the title's own `onClick` is a
  bubble-phase handler on a descendant.
- **The checkbox still toggles** on a plain click, and on a modified one
  selects instead of ticking. One uniform rule for the whole row, with the
  `after:-inset-x-1` hit-area geometry (§5.4) untouched.

macOS turns Ctrl+click into `contextmenu` and suppresses the `click`, so
`ctrlKey` is effectively the Windows/Linux path. Both are tested.

**A Shift+click range is scoped to the anchor's own column**, and
`rangeSelectionIds()` returns null when the two ends are in different ones so
the caller re-anchors. "Everything between a card in Tuesday and a card in
Backlog" has no answer a user would predict: the two halves are ordered by
different rules entirely (§4.13 — the planning half is arranged by hand, the
calendar half is computed), and the columns between them on screen are not a
sequence you can walk. *Within* a column it is well defined even in the
calendar half, because `DayColumn.todos` is the flat rendered order, groups
and all — so a range sweeping across two group headers selects exactly the
cards the eye passed over.

**The run lands in board order, with N keys in one gap.**
`positionsForDropOnItem()` (`lib/ordering.ts`) is the multi counterpart of
`positionForDropOnItem`, and it is required to agree with it at `count === 1`
— a one-card selection must land exactly where a plain drag of that card
would. There is a test pinning that equality. It also excludes **every** mover
from the neighbour list, not just the one under the cursor: leaving the others
in lets a mover become its own run's neighbour and interleaves the result with
cards that are about to move out from between them.

The pointer decides where the *run* lands, not where within the run the
dragged card sits. Positions are only used for the list and day-group
branches; a day column writes none, because order there is computed (§4.13).

**`handleDragEnd`'s multi branch is a separate branch, and the single-card
path below it is byte-identical to before.** That path is the most-used code
in the app and every bug ever found in it has been invisible to typecheck,
lint and unit tests (§8), so ~40 duplicated lines is the cheaper trade. The
multi branch also **materializes first, then builds the undo entry, then
writes** — the reverse of the single path's "record before awaiting", because
the inverse patches have to describe rows that already exist.

Undo is one entry with N steps, and each step carries **its own**
`previousDate` — reusing the dragged card's would restore the wrong dates.

**N writes = N outbox entries = N sequential Dexie transactions.** There is no
batch helper and adding one would change the single-write-path contract
`mutate.ts` and `lib/sync/wire.ts` are built on. The practical consequence is
that a large selection's writes can outlast the 200ms flight and its
`FLIGHT_MS + 250` backstop, so the write loop clears `landingTodoIds` in a
`finally` as well as from `onLand` — a row revealed before its write lands
reads as data loss. There is no cap on selection size yet (§7).

**When the selection clears:** a plain click on anything that is not a card, a
plain click on another card, `Escape`, a completed drop, and lifting a card
that is *not* in the selection (the gesture is no longer about the selection,
so leaving it highlighted would look armed). A drag **cancel** deliberately
keeps it — Escape cancelled the lift, not the picking; a second Escape clears.
The document listener is registered only while something is selected, and its
`Escape` is guarded by `isTextEntry`, because Escape inside a column filter
already means "clear the filter".

**The overlay grows a count badge, not a fan of stacked cards.** §4.7 measures
the overlay wrapper with `getBoundingClientRect()`, and a chip that changed
size mid-drag would break the flight. The badge is `shrink-0` inside the
existing wrapper.

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
and `board-column.tsx` both split the pointer activators and `onKeyDown` across
two different elements, so each casts the map once at the top rather than at each
site.

> **The listener map is named by the sensors, and getting it wrong fails
> silently.** `listeners` contains one entry per bound sensor activator — with
> `MouseSensor` + `TouchSensor` that is `onMouseDown` and `onTouchStart`, *not*
> `onPointerDown`. Destructuring a name no sensor provides yields `undefined`,
> which React accepts happily, and the result is an element that simply does not
> drag. Nothing type-errors, because the cast asserts the shape. If you change the
> sensors, grep for the activator names at the same time.

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
a seven-day week — still fits a 1440pt laptop without scrolling. A wider floor
means the most common window size opens on a half-clipped Sunday, which reads
as a bug rather than as an affordance. If the day-count toggle ever changes,
that number is the thing to recompute.

**The planning half's wider floor is set on the outer row, not on each
column.** `BoardColumn` reads `--column-min`; the planning track overrides
that one property, so every column inside — including the create-list slot —
widens without a size prop threaded through the component. Backlog's panel
(below) carries the same override, so it lands at this width too even though
it is no longer a child of this row.

**Overflow and Backlog are pinned — fixed-width siblings outside the scroll
track, not part of the fits-at-168px arithmetic above — and each gets its own
raised panel, `PINNED_PANEL` in `board.tsx`.** `BoardColumn`'s `pinned` prop
renders a column at `w-(--column-min) min-h-0 flex-1 overflow-y-auto` inside
that panel: `flex-1` sizes it on the panel's main axis (height, filling the
panel edge to edge) while the fixed width holds regardless. The panel itself
is the fixed-width sibling of the `.column-track` div — `[panel][scrolling
track]`, both inside a non-scrolling outer row/half that carries the shared
background. This is deliberately the one place a column is not transparent:
`PINNED_PANEL` sets `bg-card`, a `border-r`, and a rightward shadow, so pinning
*reads* as pinning rather than just behaving like it — the flat look was P1
feedback in its own right, once the columns were reachable but visually
indistinguishable from the scrolling ones beside them. `bg-card` rather than
`bg-background` because the two are identical in light mode but `bg-card` is
lighter than the page background in dark mode, so "raised" holds in both
themes without a theme-conditional class.

`position: sticky` was considered and rejected. dnd-kit caches each
droppable's rect at drag start and corrects it by the scroll delta of its
scrollable ancestors (see §4.2); a `sticky` element does not move with that
scroll, so its corrected rect drifts off screen and a drop "on" the visually
pinned column silently resolves to whatever is underneath it instead — exactly
the gesture pinning exists to fix. A sibling outside the scroller has no such
drift and does not interact with dnd-kit's auto-scroll. It does now need an
opaque background and a `z-10`, unlike an ordinary column — see above — so its
shadow paints over the scrolling track's columns rather than a transparent gap
showing them through.

**Overflow and Backlog resize independently, each via its own `RailHandle`
(`rail-handle.tsx`) on the panel's right edge.** Deliberately not coupled to
one shared width: a full Backlog next to an empty Overflow is the normal case,
and forcing them to match would mean either a cramped Backlog or an Overflow
that is mostly wasted space. Both still *start* at the same width, because
both read `--list-column-min` from `PINNED_PANEL` until a real drag overrides
it — resizing one for the first time measures its own `BoardColumn` section,
not the panel div (whose rendered width also includes the panel's `px-4`
padding), or the very first drag would jump the width by ~32px.

The drag itself writes `--column-min` straight onto the panel DOM node on
every `pointermove` (`use-rail-resize.ts`), the same reasoning as
`use-day-track.ts`'s direct `track.scrollTo`: a per-pixel value has no business
in React state, which would re-render on every pixel of drag for no visual
gain a synchronous DOM write doesn't already give for free. Only the release
value is committed, once, to `settings.backlogWidth`/`overflowWidth` (nullable
— null means "never resized," so the CSS default stays declared in exactly one
place rather than duplicated as a number that could drift from it). Dragging
narrower than `RAIL_COLLAPSE_THRESHOLD` (`lib/rail.ts`) snaps to a 40px
collapsed strip instead of clamping at `RAIL_MIN` — the VS Code gesture, so
collapsing needs no separate affordance to discover. `RailHandle` is not
rendered at all while its column is collapsed; `BoardColumn`'s collapsed strip
(vertical label, a `{todos.length}` count, `role="button"`) is itself the way
back to expanded.

Both handles go `disabled` (inert, `tabIndex={-1}`) whenever a card or column
drag is active, for the same reason pinning is not `sticky`: resizing mid-drag
would invalidate every droppable rect dnd-kit cached at drag start.

Rail width and collapse state are settings fields, but deliberately excluded
from `SETTINGS_SYNCED_FIELDS` (`lib/sync/wire.ts`) — same treatment as
`activeTabId`. The right width for a laptop is not the right width for a wide
monitor on the same account, so syncing it would fight the user on every
device switch.

**The day track now genuinely scrolls through more than a week, starting on
first load.** `Board` renders `DEFAULT_RENDERED_DAYS` (30) day columns from
the start — deliberately wider than any screen, so the track always has
somewhere to scroll to rather than opening on a dead end — and grows further
to cover both the furthest scheduled todo and however far the user has
navigated, bounded by `Board`'s `cap` state (starts at `DEFAULT_DAY_CAP`,
365 — about a year). See ARCHITECTURE.md §5 for why the window has to grow
this way rather than simply widening with the ⌘K toggle (which still works,
but now only as an explicit "collapse back to N days" action, not the thing
that sizes the default view).

Growth is always an explicit user action, never silent: a "Load N more days"
tile sits at the end of the track (mirroring `create-list-column.tsx`'s slot
at the end of the planning track) for as long as `cap` has not been reached,
and the `Week`/`Month`/`Quarter` jump buttons extend the horizon on demand
when a jump target lands past what is currently rendered — but stay bounded
by `cap` themselves, same as the tile. The calendar-icon date picker is the
one exception: it has no upper bound at all, so picking a day past `cap`
raises `cap` itself to reach it, rather than the picker refusing a deliberate
far-future pick (an 18-months-out reminder, say). `cap` only grows, never
shrinks, and survives a later ⌘K collapse. `use-day-track.ts` owns the pure
scroll-position and jump math for all of these, all of it against the day
track specifically — the pinned columns beside it are unaffected.

The date picker bridges `CivilDate` strings to `Date` objects for
`react-day-picker`, which has no civil-date mode. This is the one place in the
app that touches `Date` objects for a stored/derived date — see the comment
above `civilDateToLocalDate` in `date-nav.tsx` for why it stays safe: both
sides of every comparison are local-time `Date`s built the same way, so
nothing is ever cross-checked against a UTC-parsed civil date.

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

### 4.13 The calendar half is computed, so its columns group instead of sorting

**`position` means an order in the planning half and only a tiebreaker in the
calendar half.** Day columns and Overflow partition their cards by originating
list (`todo.listId`, which survives scheduling), sort the groups **by tab and
then alphabetically** (`byListGroup` — see below), and sort within each group by
`byPriorityThenPosition`. List columns are untouched: they are still arranged by
hand.

`byListGroup` is two-level, and the outer level is the one that matters. A group
header takes its colour from the owning **tab** (a list is born colourless, so
`effectiveListColor` falls through to the tab almost always), which means a day
holding work from three tabs already shows three colours. Sorting on the list
name alone then scattered them — two same-coloured groups either side of a group
of another colour, the colour saying "these belong together" while the order said
otherwise. So groups first sort on the owning tab's `position`, putting each
tab's lists in one contiguous run **in tab-strip order**; the alphabet
(`listSortKey`, which strips a leading "To ", so "To Buy" files under B) then
orders the lists *inside* a run.

Backlog leads every day column, and nothing pins it there. It carries
`tabId: null`, so it falls out of the tab level with an empty sort key, which
sorts ahead of every real fractional index for free — unplanned work at the top,
where it gets addressed first. A list whose `tabId` no longer resolves counts as
untabbed too, joining Backlog rather than forming a one-list run of its own
ordered by a raw uuid.

`DayColumn.todos` is **derived** from `groups` via `flatMap`, never sorted
independently. The arrow keys, the drop path, the filler arithmetic and
`findColumn` all read it, and two arrays sorted by two comparators is exactly how
"the eye sees one order and Tab walks another" gets shipped.

Four facts from the dnd-kit source shape the implementation. All four are load
bearing and none is obvious:

- **`SortableContext` takes `disabled={{droppable: true}}`** and forwards it to
  every `useSortable`'s `useDroppable` (`sortable.esm.js:297,315,480`). That one
  prop makes a grouped column's cards drag *sources* without being *targets*, with
  no fork of `TodoCard`.
- **dnd-kit hands only ENABLED droppables to collision detection**
  (`core.esm.js:2904,2989`), so those disabled card droppables vanish from
  collisions entirely rather than being ignored afterwards. `overTodoId` can never
  name a day-column card again, which is why the per-card insertion line
  disappears from that half for free.
- **`verticalListSortingStrategy` is actively wrong when `over` is a group.** It
  is called with `overIndex: -1`, and at -1 its
  `index < activeIndex && index >= overIndex` branch (`sortable.esm.js:245`) is
  true for *every* card above the dragged one — so the default strategy shoves the
  top of the column downwards for the whole drag. Grouped columns pass
  `NO_SORTING`. This is the most likely "why does the column jump" bug here.
- **`sortableKeyboardCoordinates` does not filter to sortables**
  (`sortable.esm.js:677`), so a keyboard drag finds group droppables for free and
  walks group-to-group.

**Dropping on a group re-assigns the list** — "belongs to list X, still scheduled
for D" — via `dayGroupPatch`. `moveTodoToList` cannot serve it: `listPatch` clears
`scheduledDate` by design, because that *is* the meaning of a drop into a list
column, and softening it would make the two gestures indistinguishable to undo.
The date is rewritten even when it looks unchanged, because it often is not: a
rolled-over todo renders in today's column while carrying an older date, so
dropping it on its own group there is how it gets committed to today. Dropping a
card on the group it already renders in, on that same date, is a **no-op** — order
inside a group is computed, so there is no "move it up" for the gesture to mean.

Group headers are arrow-key stops (`groupStop`), `tabIndex={-1}`. Tabbable headers
would add 28 stops to a seven-day week with four lists, all of them ahead of the
first quick-add. A **collapsed** group contributes its header and none of its
cards: a stop for a card that is not in the DOM makes `useColumnNav` return false
and the arrow key dies silently mid-column.

Collapse is keyed by **list, across the whole calendar half**, not per (day, list):
day columns are transient — 30 rendered against a 365 cap, and the track scrolls —
so per-day state would be hundreds of entries needing garbage collection as
`today` advances. It is not persisted yet, so it resets on reload.

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

### 5.3 Items scheduled past the day cap fall back to their list

Shown dimmed with a date chip (`awayTodoIds`). This used to fire routinely —
the window was always exactly `settings.visibleDays` long — but the board now
opens on 30 days and grows the rendered window to cover any scheduled todo up
to a ~year-long cap (ARCHITECTURE.md §5), so it fires only past that cap,
where a day column is not an option. The 1/3/5/7-day toggle no longer sizes
the default view or moves todos between halves; it is now only an explicit
"collapse to N days" action.

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
  nothing. On a **card** the grip is still leftmost but is absolutely positioned
  in the row's 12px left gutter (`pl-3`) rather than sitting in the flex flow —
  same place to the eye, no width taken from the title (§5.5).
- **12px icon.** Small enough to stay quiet next to the text it precedes.
- **24×24 hit area**, the WCAG 2.2 "Target Size (Minimum)" floor, applied with
  an absolutely positioned `::before` rather than padding. Padding would have
  grown the button's box and pushed the title along with it; the pseudo-element
  costs nothing in layout, and pointer events on it still resolve to the button.
  On a **column** the expansion stops ~2px short of the neighbouring control, so
  **widening it further would start stealing clicks from it.** On a **card** the
  horizontal expansion is switched off entirely (`before:-inset-y-1.5
  before:inset-x-0`), because an out-of-flow grip's 24px box would sit over the
  checkbox — and `opacity-0` elements still receive pointer events, so a hidden
  grip would have eaten checkbox clicks with nothing on screen to explain it.
  Cards can afford to give that up: the whole row is the mouse target and a long
  press anywhere is the touch target (§4.8), so the grip is the keyboard route
  and the affordance, not the primary hit area.

Hover is a color change, not a background fill — a filled box around a 12px
icon undoes the point of making the mark small.

> `before:absolute`, `before:-inset-1.5` and `before:content-['']` were checked
> against the built CSS, per the warning at the end of §6. They emit.

### 5.5 Visible at rest on columns; revealed on hover or focus on cards

On a **column header** the grip is `text-muted-foreground/30`, darkening on
hover — not hidden. A control that only exists on hover is undiscoverable until
you happen to sweep over it, and that was the original complaint that prompted
the affordance work.

On a **card** it is now `opacity-0`, revealed by `group-hover`,
`group-focus-within` or its own `focus-visible`. The trade is deliberate and the
arithmetic is the argument: in flow the grip cost 20px (12px icon + 8px gap) of a
~108px title track at the `--column-min` floor, on every row, forever. Out of
flow it costs nothing, and the row gains 8px net once the 12px gutter is counted.
What is lost is self-advertisement, and three things soften that: the whole row is
grabbable with a mouse, `group-focus-within` means arrowing onto a row reveals the
grip (so the keyboard path teaches itself), and the grip-means-draggable
vocabulary is still taught by columns and tabs — `tab-strip.tsx` has always
revealed its grip on hover, so a card now matches a tab rather than inventing a
third behaviour.

It is still the keyboard activator and still a real focusable control carrying
`aria-roledescription`. It is **no longer** the touch drag surface (§4.9).

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
- A **column** dragged over it likewise finds nothing, so no column highlights
  and the drop is a no-op. The end slot is still reachable the normal way: drag
  rightwards onto the last real column (§4.10).

Its own interaction is a plain button → autofocused field. Enter commits,
Escape abandons, blur commits what was typed — matching the per-column quick-add
inputs rather than inventing a third convention. It records to the undo stack
and toasts with an Undo action, the same shape the palette's creates use.

---

## 6. Visual states

**Card** (`todo-card.tsx`)
- whole row is `cursor-grab` / `grabbing`; the checkbox overrides to
  `cursor-pointer` so it still reads as a control (§4.9)
- `DragGrip` leftmost but absolutely positioned in the row's 12px left gutter,
  `opacity-0` until the row is hovered or anything in it takes focus (§5.5)
- **the row is not a flex container.** The grip and the checkbox are both
  absolutely positioned in the left gutter, so the title block spans the full
  width and its second and third lines run *under* the checkbox rather than
  stopping at a flex column edge. Only the first line clears the checkbox, via
  `indent-6` — `text-indent` applies to the first line only, which is the whole
  trick, and it inherits into the clamp's `-webkit-box` so it survives
  `line-clamp`. The title button needs `block w-full` because a button is
  inline-block by default and would otherwise shrink-wrap its text
- **title wraps, then clamps at 3 lines**, and a tooltip carries the full title
  when — and only when — the clamp is actually cutting it off. That is measured
  with a `ResizeObserver`, not on hover: measuring on hover is what *enables* the
  trigger, so it lands after the `mouseenter` Base UI would have opened on and the
  tooltip only appears the second time you hover. `wrap-break-word` is separate
  from the clamp and not decorative — one unbroken token longer than the track (a
  pasted URL) has no break opportunity without it. The line count lives in
  `lib/title.ts`, shared with the detail sheet's title field, and is the shape of
  a future local-only preference
- **priority is a rail, not a chip** — an `aria-hidden` span, `absolute inset-y-0
  left-0`, 1–3px wide, width and colour from `lib/priority.ts`. Four reasons it
  is not `border-l`: a left border would indent the checkbox and title per level
  (`border-box`), mitre against `border-b` into a coloured wedge, shift where the
  insertion line starts (its position is load bearing, below), and fuse a run of
  same-priority cards into one continuous stripe instead of per-card ticks. The
  level reaches screen readers as `sr-only` text inside the title button
- **location is a pin, not a chip** — a 12px `MapPin` inline at the head of the
  title, with the location in a hover tooltip and in `sr-only` text. The tooltip
  trigger renders as a `span` so it stays non-interactive content inside the
  title `<button>`; Base UI adds no role or tabIndex of its own. That also means
  it is never focusable and `focusin` bubbles the wrong way, so the tooltip is a
  pointer nicety and the `sr-only` text is the real channel. These are **nested**
  tooltip triggers inside the title's own trigger; Base UI handles that by walking
  up to the closest enabled trigger and suppressing the ancestor
- **an upcoming deadline is a `CalendarCheck` marker** in the same inline run,
  tooltip "Due in 5 days: Aug 14" from `formatDeadlineDue()`. A **missed** deadline
  gets no marker — it keeps the loud destructive badge it always had, because two
  indicators for one fact is the clutter this redesign is removing. Quiet marker
  ahead of time, loud badge once it is blown
- the checkbox's `after:-inset-x-1` is load bearing: the shadcn base expands 12px
  horizontally, which from `left-3` reaches back across the whole grip, so a click
  meant for the grip would toggle done. 4px keeps the target at the WCAG 2.2
  24px minimum while stopping clear of the grip's glyph
- badge row is now away-date, missed deadline and labels only
- dragged source stays at **30% opacity** so the column does not collapse under
  the cursor
- insertion line: 2px primary bar + leading dot, absolutely positioned at
  `-top-px`, drawn *above* the hovered card. Carries `data-drop-indicator` —
  it doubles as the drop animation's target (§4.7), so its position is load
  bearing, not just decorative
- landing row held at `opacity-0` while the overlay flies to it

**Column** (`board-column.tsx`) — three mutually exclusive drag states, shared
by card drags and column drags:

| State | Condition | Style |
|---|---|---|
| candidate | card drag active, not hovered | dashed 1px border outline |
| active | card drag hovering it, OR it is the single column-drag drop target | solid 2px primary outline + `bg-primary/5` |
| rejecting | Overflow, card drag hovering it | dashed/solid destructive outline + `bg-destructive/5` |

Candidate and rejecting are **card-drag only** — `isDragActive` is `false`
for every column during a column drag, so neither can fire then. Active is the
one style both gestures reach, from two different conditions
(`isOver && !isColumnDragActive` for a card, `isColumnDragActive &&
isColumnDropTarget` for a column) that are mutually exclusive in practice,
since the board never has both `activeTodo` and `activeList` set at once.

All use `outline-offset-[-2px]` to draw inside the column bounds.

**List group** (`board-column.tsx`, day columns and Overflow — §4.13)
- header is `text-2xs` uppercase, chevron rotating on collapse, count shown only
  when collapsed but always in the accessible name — a screen-reader user has no
  "glance"
- colour rides the header's `border-b` (`edge`) and a faint fill (`tint`), **never
  the text**: a step-9 hue at `text-2xs` fails contrast in one theme or the other
- the cards sit on a `wash()` (~10%) of the list colour, applied to a wrapper
  **behind** them rather than to each row. An inline `style.backgroundColor` on a
  row would beat `hover:bg-accent/50` outright, since inline always wins; behind
  them the 50%-alpha hover simply composites over it
- hovering a group outlines the whole group and puts `data-drop-indicator` at its
  end. That **replaces** the per-card insertion line in this half — a drop means
  "belongs to this list", which is a statement about the group, not about a slot
- headers are **not** sticky. `.column-track` computes `overflow-y: auto` for the
  whole track, so they would pin to the track's viewport and every column's would
  pile up at once — and a sticky element inside a droppable moves relative to the
  rect dnd-kit measured for it

**Deadlines due (`board-column.tsx`, day columns only)** — a destructive-tinted
strip directly under the header, `CalendarCheck` + a count, carrying
`data-due-banner`. The count comes from `use-board-data.ts`'s `dueByDay` map
(grouped, not merely counted, so the banner and the day sheet's Due section can
never disagree), built over **every** visible open todo rather than the
column's own contents: a deadline is independent of placement, so something
due Friday is usually scheduled for Tuesday, and the banner's job is to warn
before Friday arrives. Loud on purpose — it is the one thing on the board that
a plan can be wrong about while everything else still looks right.

It is also a button when the column has an `onOpenInfo` (every day column
does), gated on that same prop rather than one of its own — opening the day
sheet, which renders the due items above Notes. EI-252.

Hovering a column but no specific card renders an end-of-column dot instead of
a per-card line — but only for a **card** drag (`!isColumnDragActive`). Without
that guard the same dot lit up during a column drag too, on whichever column
happened to be hovered, including Backlog (§4.10).

**Column reorder** (`board-column.tsx`)
- the whole header is `cursor-grab`; the same `DragGrip` sits in it immediately
  left of the list name, as the keyboard and touch path. Backlog reserves the
  slot but shows none, and day columns reserve nothing (§5.4)
- the drop target is the single column's **active** outline above, not a
  separate indicator — see §4.10 for why the earlier before/after edge bar was
  dropped, and why Backlog is redirected rather than ever outlined itself
- `data-drop-indicator` sits on that same column's `<section>` now, so the
  chip's drop animation grows to the column's width as it lands, rather than
  collapsing into a hairline the way the old edge bar did
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

> **A Base UI `render` prop will not compose two Base UI components** (EI-196).
> `<TooltipTrigger render={<Checkbox/>}/>` type-checks, renders, keeps every
> prop, and silently drops the trigger's pointer handlers — the tooltip simply
> never opens. Every working tooltip here triggers off a plain `span` or a
> shadcn `Button` (a bare `<button>`); wrap the primitive instead of rendering
> through it. Nothing catches this: happy-dom cannot open a Base UI tooltip,
> and neither can Playwright's `locator.hover()` — see the note in
> `e2e/support/hover.ts` about needing real CDP pointer input, and always
> include a CONTROL case, or "the tooltip did not open" is ambiguous between a
> broken app and a blind harness.

> Tailwind silently drops classes it does not recognize, so a typo leaves an
> outline as an invisible no-op with everything still "passing". Verify new
> utilities actually emit CSS:
> `grep -oE "outline[a-z-]*:[^;]{0,30}" .next-static/_next/static/chunks/*.css | sort -u`
>
> The card redesign added three worth re-checking the same way, two of which are
> arbitrary or newly-named utilities: `wrap-break-word`, `line-clamp-3` and
> `align-[-0.1875em]` (the pin's baseline nudge — a bad arbitrary value leaves a
> misaligned icon with every test still green).

---

## 7. Known gaps / candidate next work

Nothing here is started. (Column reordering used to be item 7 here; it is now
§4.10. The drop animation and whole-row dragging were also delivered from this
list — see §4.7 and §4.9.)

1. ~~Keyboard drag is wired but never exercised end-to-end.~~ Now covered by
   `e2e/keyboard-drag.spec.ts` (EI-74, `desktop` only). Lift (`Space`),
   in-column reorder, and cross-column moves within a single half (day → day)
   all work reliably via arrow keys.
   ~~Two known gaps: arrow-key navigation cannot land on an empty column.~~
   **Fixed, EI-114.** Confirmed with an instrumented `coordinateGetter` against
   real keyboard presses (not guessed at) that TWO separate corner-distance
   biases were stacked on top of each other:
   1. `sortableKeyboardCoordinates`'s own candidate selection (deciding WHERE
      the virtual drag position moves) scores every enabled droppable by
      averaged 4-corner distance — including the dragged card's OWN droppable,
      which never moves during a keyboard drag (only the overlay does), so the
      "closest" candidate on the first press was frequently the card's own
      column or the tab strip immediately below Backlog, not real progress.
   2. `collisionDetection` (deciding WHAT `over` actually resolves to, one
      layer downstream) has the identical bias: `preferPreciseTarget`'s
      "a card always beats a column" precedence assumes a real pointer is
      *inside both at once* (§4.2/§4.3) — true for a mouse, never true for a
      keyboard's `closestCorners` fallback, where it just meant a populated
      neighbor's small card rect pre-empted an empty column's larger one no
      matter how close the column actually was.

   Both are fixed in `use-board-actions.ts`: `collisionDetection` now excludes
   the dragged card's own droppable, and tries a SYNTHETIC pointer at the
   virtual position's center before falling to raw `closestCorners` (§4.2) —
   and `keyboardCoordinates` replaces the bare `sortableKeyboardCoordinates`
   for `Left`/`Right`, scoring same-row column candidates by leading-edge
   distance and landing at a target's center rather than its corner. Verified
   against both reported repros (an empty list column between two populated
   ones, and the pinned Backlog rail crossing into the calendar half) and an
   analogous empty-*day*-column case — `e2e/keyboard-drag.spec.ts` covers all
   three, and the former `test.fixme` converted to a real passing test rather
   than being rewritten from scratch.

   Screen-reader announcements (`announcements` / `screenReaderInstructions`
   on `DndContext`) are still entirely unconfigured — dnd-kit's defaults are
   generic and say nothing about days or lists (EI-84).
2. **Auto-scroll is configured; whether it feels right is still unverified
   (EI-81).** `computeAutoScroll(layout)` (`use-board-actions.ts`) is `true`
   everywhere except phone — dnd-kit's default incremental auto-scroll fights
   phone's `scroll-snap-type: mandatory` pager and judders, so it's off there;
   see the doc comment on `computeAutoScroll` for the mechanism. Unit-tested
   (`use-board-actions.test.ts`). What's still unverified is feel, not
   config: does dragging a card toward the edge on tablet/desktop scroll
   smoothly, and does it visibly judder on phone the way the comment
   predicts? That's a human-at-a-browser check, not something worth an E2E
   assertion — a per-frame scroll-velocity assertion near a container edge
   would be the flakiest thing in this suite.
3. ~~No cross-half scroll affordance.~~ Done, though not the way this entry
   meant: each half has its own persistently-drawn horizontal scrollbar
   (§4.12), so "there is more board this way" is visible without a drag.
4. ~~Touch is untested, but no longer asymmetric.~~ Done, as of the mobile
   plan's M-1 and M1 (docs/MOBILE.md). `e2e/touch-smoke.spec.ts` drives a real
   long-press-and-drag through CDP `Input.dispatchTouchEvent` — an actual
   touch input event as far as the renderer is concerned, not a simulated DOM
   event (`locator.dispatchEvent()` doesn't set `Event.isTrusted` and native
   scroll/`TouchSensor` ignore it) — and confirms a reorder actually commits.
   The grip-only-on-touch asymmetry stays gone: `TouchSensor` lifts from
   anywhere on a row or column header, and nothing relies on
   `touch-action: none` any more (§4.8, §4.9). The 250ms/8px pair *was*
   untested-on-a-real-pipeline guesswork; P1 retuned it to `{delay: 400,
   tolerance: 5}` on a coarse pointer specifically because it no longer had
   to be guesswork — see §4.9b. **Still open:** everything here is Chromium
   via CDP, not an actual phone; §4.9b's numbers are a reasoned default, not
   field-tested, and remain the most likely place a real device surprises
   this app. Revisit once Capacitor (P7) makes that testable.
5. ~~No multi-select drag.~~ **Done, EI-194** — see §4.14. Still open from
   it: no cap on selection size (N writes are N sequential Dexie transactions
   and N outbox entries), and there is no touch equivalent for Cmd+click.
5a. **A list drag has no keyboard path**, so §4.10e ships mouse-only in
    practice — `keyboardCoordinates` falls straight through to the stock
    getter for a `listdrag:` active (see item 7 below, which this inherits).
5b. **A collapsed weekend strip does not expand for a list drag** the way it
    does for a card drag; the dwell effect is gated on `activeTodo`. Symmetry
    says it should, blast radius said not in the same change.
6. **Overlay width vs. cursor.** The overlay is `max-w-xs`; on a narrow column
   it visually overhangs neighbours while only the cursor's column highlights.
   Correct, but arguably reads oddly — worth a look.
7. **Column reorder has no keyboard path.** The header's grip is a focusable
   button carrying dnd-kit's attributes and `onKeyDown`, so Space should start a
   keyboard drag, but the
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
    "discovered" as a missing target later. It *is* reachable outside a drag:
    `→` off the last list column focuses it, via the arrow-key grid in
    `docs/KEYBOARD.md` §11. That grid stands down entirely while a drag is in
    flight, for the reason in §4.2 — dnd-kit owns the arrows once a lift is
    active, and its cached rects are live.

---

## 8. Working on this

```bash
npm run dev        # http://localhost:3000 (or the next free port if taken)
npm test           # vitest run — 1868 tests (see ARCHITECTURE.md §8)
npm run verify     # typecheck + lint + tests + BOTH builds; run before commit
```

`npm run verify` must stay green. It includes a **static-export build** that
guards the future Capacitor target — if it fails, an app route took a dependency
on RSC data fetching, middleware, or `next/image`.

### Testing drag-and-drop

Pure logic — `preferPreciseTarget`, `parseColumnId`, `parseListDragId`,
`planListDrop`, `planListTabDrop`, `landingTransform`, `positionForIndex`,
`buildBoard` — is unit-testable and already covered. **Prefer extracting a
pure function over testing dnd-kit itself**; jsdom/happy-dom has no layout, so
rect-based collision logic cannot be meaningfully tested there.

**Manual checklist — cards**

1. Hover a card — the grip fades in, leftmost, in the row's left gutter, and
   **nothing else moves**. Arrow onto a row and it appears the same way. Its hit
   area extends ~6px above and below the icon but **not sideways**: press the
   checkbox with the grip showing and it must still toggle. That is the whole
   reason the horizontal expansion is off — an `opacity-0` grip still takes
   pointer events, so at rest it would otherwise be eating clicks invisibly.
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
16. **Narrow the window until the day track hits `--column-min`.** A ~60-character
    title wraps to at most 3 lines and clamps after; no card crosses into a
    neighbouring column. Repeat with a title that is one unbroken 60-character
    token — that is what `wrap-break-word` is for, and it fails differently.
    The second and third lines must run **under** the checkbox, not beside it.
17. Four cards, P1 → P4, side by side. The rails differ by **both** thickness and
    hue, and the left edges of all four titles line up. Check in light *and* dark
    (`.dark` on `<html>`): P4 is a 1px cyan line and is meant to be quiet — if it
    disappears against white, widen P4 before changing its hue.
18. A card with a location shows a pin at the head of the title, tooltip on hover,
    and **no location chip**. Check the pin's vertical alignment in Chrome and
    Safari — it sits inside a `line-clamp` element, which is `-webkit-box`.
19. Drag a P1 card: the insertion line still starts flush at the column's left
    edge (the rail must not have pushed it in), and the overlay chip carries the
    same rail and pin as the row.
20. On a touch device or emulator: long-press a card → it lifts. A short swipe
    scrolls the column instead. Same for a column header.
21. Hover a **clamped** title: the tooltip shows it in full, **on the first
    hover**. Hover a short one: no tooltip at all. Then narrow the column until a
    fitting title starts clamping and hover again without reloading — the
    `ResizeObserver` should have caught it.
22. Click the grip on a card with the checkbox showing. It must **not** toggle
    done — that is the `after:-inset-x-1` boundary.
23. Give a to-do a deadline a few days out: an inline calendar marker appears with
    "Due in N days", and `N` counts down correctly across a month boundary. Move
    the deadline into the past: the marker goes and the destructive badge appears.
24. Set deadlines on two to-dos for the same future day, scheduled on *different*
    days. The banner under that day's header reads "2 due" even though neither
    card is in that column. Mark one done — it drops to "1 due".
25. In the detail sheet, paste a long title: the field grows to 3 lines and then
    scrolls, and `Enter` commits rather than inserting a newline.
26. Give two lists colours, then schedule cards from both onto one day. Two group
    headers, priority order inside each so the rails run thick → thin, and a faint
    wash behind each run.
26b. Schedule cards onto one day from **two lists on one tab and one list on
    another**, named so the alphabet would interleave them (say `Admin` and
    `Notes` on one tab, `Errands` on the other). The two same-coloured headers sit
    together, the runs follow the tab strip left to right, Backlog leads the
    column, and names stay A–Z *within* a run. Reorder the tab strip → the runs
    reorder with it.
27. Click a group header: it collapses, the count appears, and **the same list
    collapses in every other day column too**. Click again to expand.
28. Drag a card onto another group's header: its list changes, its date does not,
    and the whole group highlights rather than a line appearing between two cards.
    Drop a card on its own group → no-op, and it flies home.
29. **Watch the top of the column during that drag.** If the cards above the
    dragged one shift downwards, `NO_SORTING` is not wired — see §4.13.
30. Drag inside a **list** column: it still reorders by hand, with the per-card
    insertion line intact. That half did not change.
31. Arrow down through a grouped column — headers are stops, `Enter` collapses one,
    and the arrows keep working past a collapsed group rather than dying.
32. Switch tabs, then look at a day holding a card from the *other* tab's list. It
    must group under **that list's name**, not Backlog. This is what `hiddenLists`
    passing records rather than ids buys.
33. Type an in-column filter, then drag a **visible** card above another
    **visible** card. Clear the filter and confirm it landed exactly where you
    pointed, relative to the cards the filter was hiding — positions come from
    the unfiltered board (`use-board-actions.ts`), not the rendered array, so
    this must always be correct. Then drop a card on empty column space while
    filtered: it lands at the true end, past whatever the filter is hiding,
    even though the end-of-column indicator draws below the last *visible*
    card.

**Manual checklist — column reordering**

16. Grab the last list **by its title, not its grip**, and drop it on the
    leftmost movable column. It lands **immediately after Backlog, never before
    it.** *(This was the requested behaviour.)*
17. Drag a column rightwards onto the last one — it lands **after** it, i.e.
    the end slot is reachable. That column shows the single active-outline
    border while hovered; releasing lands the dragged column just after it.
18. Drag leftwards onto a column — same outline, and the column lands before
    the target this time. The visual does not distinguish before from after;
    only the release position does.
19. Drop a column onto Backlog — lands just after it (the first slot), no
    refusal. **Confirm Backlog itself never shows the outline** — while
    hovering it, the first movable column shows it instead. *(This was the
    reported bug: Backlog reading as a drop target when it structurally
    cannot receive one.)*
20. Confirm **Backlog has no grip**, but that its title still lines up with the
    other list titles — the empty slot is reserved. Day columns have neither.
21. Grab a column anywhere along its header — the grip, the title, the empty
    space between the title and the info button. All start the same drag, and
    the overlay chip shows the list name at roughly column width.
21a. Click the header's info button. It opens the dialog and does **not** start
    a drag; below the 4px threshold nothing activates (§4.9).
21b. Day columns and Backlog: press and drag on their headers — nothing moves.
22. During a column drag, confirm the card-drag-only chrome stays away: no
    dashed candidate outline on the non-hovered columns, no destructive
    styling anywhere (Overflow does not participate in column drags), and no
    end-of-column card dot on the hovered column. **Exactly one column at a
    time should show the active outline, and it should be a single border —
    not a border plus an extra accent on one edge.** *(This was the other
    reported bug.)*
23. Drag a column up over the calendar half and release — nothing happens, no
    crash, no stray reorder.
24. Drop a column on itself — no-op, no spurious write, and no outline shown
    (`planListDrop` returns null for this case).
25. Reload after each reorder — the order persists (it is a real `position`
    write, not view state).

**Manual checklist — carrying a list to another tab (§4.10c, EI-115)**

26. Grab a list column by its header, hold it over another tab's pill — the
    pill shows the pending ring (not the filled column style), and after
    ~600 ms that tab becomes active and its columns render underneath. Sweep
    across the strip on the way past instead of holding — nothing switches.
27. Drop directly on the pill (don't wait to see a column first) — the list
    lands at the **end** of that tab's track, not a no-op.
28. Drop among the destination tab's columns instead — the list lands
    **after** whichever column it was released on, regardless of which
    direction it came from (there is no "before" for an arriving list).
29. Every todo that was in the moved list now shows under it **on the new
    tab**; switch back to the old tab and confirm none are left stranded
    there.
30. Schedule a todo from the moved list onto a day *before* moving the list.
    After the move, that day's group still shows the list's name and colour,
    from either tab — nothing about a scheduled todo's placement should
    change.
31. Drop the list back onto the tab it's already on — via its own pill and
    among its own columns — both are a no-op with no `tabId` write, same as
    an ordinary reorder.
32. Try to drag Backlog — it has no grip, so nothing starts. Drop an ordinary
    list onto Backlog while it's showing a *different* tab's columns — it
    lands first in **that** tab (the one on screen), not the list's own.
33. Move a list to another tab, then ⌘Z — it reappears back on the original
    tab, at its original position, in one step. No intermediate state where
    it's on the right tab but the wrong position, or vice versa.
34. Reload after a cross-tab move — it persists (`tabId` and `position` are
    both real field writes).
35. Drag a list over the "Archived" button, or the "new tab" `+` button —
    nothing highlights, no write, no crash.
36. Move a list into a brand-new tab that has no lists of its own yet (only
    Backlog) — it still lands, at the end (which is also the only slot).
37. During the whole gesture, confirm none of the card-drag-only chrome
    shows: no dashed candidate outlines, no destructive styling, and the
    tab-reorder insertion bar (§4.10b) never appears — that's gated on
    `activeTab`, not `activeList`.

**Manual checklist — a list onto a day (§4.10e, EI-193)**

46. Grab a list header, cross the tab strip, hold over a day. **Only that day
    outlines**, solid. No dashed candidate outlines on any other column, no
    destructive styling, no end-of-column card dot, and the tab-reorder
    insertion bar never appears.
47. Release. Every unscheduled to-do from that list appears under that day,
    grouped under the list's own name and colour. **The list column is still
    in the planning half, in the same slot** — check its neighbours did not
    shuffle.
48. A to-do in that list that already had a different day is still on that
    day, untouched.
49. A to-do in that list scheduled past the day cap — dimmed, with a date
    chip — is untouched. *(This is the case that separates "has a date" from
    "renders in the list column"; they are not the same set.)*
50. With "Completed" on in view settings, put a finished undated to-do in the
    list and repeat. It stays put.
51. Drop the list on a day where **every** one of its to-dos already has a
    date. No outline while hovering, one toast on release, no write.
52. Drop the list onto a *different* list's group header inside a day column.
    It schedules onto **that day**, and the arriving to-dos group under their
    own list's name, not the group you dropped on.
53. Drag the list over Overflow — nothing highlights, nothing happens, no
    toast, the chip flies home.
54. Drag it over a collapsed weekend strip — nothing highlights, and the
    strip does **not** expand (the dwell is card-only; §7).
55. Watch the flight on a list with several movers: exactly one chip flies,
    and **no row appears in the day column before it lands**. None is left
    invisible afterwards either.
56. ⌘Z once — every moved to-do returns to the list unscheduled, in one
    press, with its original dates restored.
57. Reload — the moves persist, and the list's own position is unchanged.
58. Confirm the existing gestures still work: reorder a list within its
    track, and carry one to another tab (§4.10c). Neither should have
    changed.

**Manual checklist — multi-select (§4.14, EI-194)**

59. Cmd+click three cards in one list. Each highlights, **no sheet opens, and
    nothing ticks done**.
60. Cmd+click a fourth card's **checkbox**. It selects and does **not** tick.
61. Shift+click a card several rows below the last one you clicked — the whole
    run between them selects. Shift+click a card in a *different* column — it
    re-anchors on that card instead of selecting across the gap.
62. Shift+click across two group headers inside one day column. The range
    covers exactly the cards the eye swept over, headers included in the
    sweep but not selected.
63. Plain-click one of the selected cards — the selection clears and the sheet
    opens. Plain-click empty board space — it just clears.
64. Escape with four selected — all clear. Then type in a column filter and
    press Escape: the **filter** clears and the selection does not.
65. Drag one of four selected cards onto a day. All four land, grouped under
    their own lists. **None is left invisible, none appears twice**, and the
    overlay chip carried a `4` badge on the way.
66. Same onto a list column — they land contiguously at the pointer, in
    reading order, and the cards already there keep their relative order.
67. Same onto a day **group** header — all four take that group's list and
    that day.
68. Same onto Overflow — **one** toast, not four, and every ghost returns home.
69. ⌘Z once — all four go back in a single press, each to its own previous
    date, not to a shared one.
70. Select four, then drag a **fifth, unselected** card. Only the fifth moves,
    and the selection clears on lift.
71. Select four, press Escape *mid-drag*. The drag cancels and the four stay
    selected; a second Escape clears them.
72. Select four, switch tabs, come back — nothing is selected. Same after
    typing in a column filter.
73. Select two, delete one from its sheet, then drag the other. Only one
    moves, no crash.
74. Arrow onto a row and press `x` twice — it selects then deselects. `Space`
    still toggles done, `Enter` still opens the sheet.
75. Select 20+ and drop. The flight and the writes both finish; no row is
    stuck at zero opacity, and none is revealed before it exists.

**Manual checklist — tab strip legibility (§4.10d, EI-117 – EI-120)**

38. A column with 8+ items shows "Filter N items" in the empty filter input;
    typing replaces it with the value, and the existing "N of M todos" chip
    still appears once a query is active.
39. Every tab pill shows `(lists/items)`; hovering one reads "N lists with N
    items" (or singular for exactly 1). A tab with no lists of its own reads
    `(0/0)`.
40. Move a list to another tab (§4.10c) or complete/reopen a todo — both
    tabs' counts update live, and Backlog never moves either number.
41. The "Archived" button shows only the icon and `(N)` inline next to it —
    no visible word, no corner badge. Hovering it shows a tooltip reading
    "Archived" or "Archived (N)". Its accessible name (VoiceOver/axe) is
    still exactly "Archived".
42. Create enough tabs to overflow the strip at a normal window width — a
    thin scrollbar is visible at rest (not only mid-scroll, per §4.12's
    overlay-scrollbar note), and the pills nearest an edge with more to
    reach visibly fade out, blending into whatever sits behind the strip
    (no visible seam or box at either edge, on either half of the board).
42b. At ANY tab count, including well under overflow, look for a gray oval
    sitting between the last tab and the Archived button — that's a
    vertical scrollbar thumb, and it means the strip picked up vertical
    overflow again. Confirm `getComputedStyle` on the strip's
    `.column-track` reports `overflow-y: hidden` regardless of tab count.
43. Select an off-screen tab via `⌘K` or the keyboard — the strip scrolls it
    into view automatically. With `prefers-reduced-motion` on, the scroll is
    instant, not smooth.
44. With the strip scrolled, start a tab or list drag near an edge — dnd-kit's
    own auto-scroll (§4.8) still carries it, unblocked by the fade overlays
    (`pointer-events-none`).
45. The "New tab" `+` button stays reachable by scrolling the strip; the
    Archived button stays pinned outside the scroll region regardless of tab
    count.

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
35. Drag a list column over it. No column highlights, no write, no crash.

**Manual checklist — the pinned rail (§4.12)**

36. Drag Backlog's handle wider, then Overflow's. Each panel moves
    independently — resizing one must not move the other, or shift the day
    track's width.
37. Reload after resizing both. Both widths persist, and land at exactly what
    was dragged, not off by the panel's padding (this is the first-drag
    measurement bug the panel-vs-section distinction above exists to avoid).
38. Drag a handle past the left edge until it snaps to a 40px collapsed strip.
    Release — the strip shows a vertical label and (if non-empty) a count.
    Click anywhere on it to expand back to the width it had before collapsing.
39. Tab to a handle: arrow keys nudge 16px, Enter/Space collapses, focus ring
    is visible. Double-click resets to the CSS default (218px).
40. Start a card drag, then try to grab a handle mid-drag — inert, no cursor
    change, no resize. Drop the card; the handle works again immediately.
41. Drag a card onto a **collapsed** Backlog — it must still land at the end
    of the column (Backlog stays droppable while collapsed). Try the same onto
    a collapsed Overflow — still refused, same as expanded.

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
