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
| `src/components/board/board-column.tsx` | `useDroppable` + `SortableContext`; drop-target visual states |
| `src/components/board/todo-card.tsx` | `useSortable`; grip handle, insertion line |
| `src/lib/board.ts` | Column grouping, drop-target id codec, `preferPreciseTarget()` |
| `src/lib/ordering.ts` | Fractional index helpers (`positionForIndex`) |
| `src/lib/board.test.ts` | Tests for id codec + target selection |

---

## 4. How it works

### 4.1 Droppable ids are encoded strings

Columns register droppables with encoded ids, so a drop can be decoded back into
an intent:

```
day:2026-08-03     a day column
day:overflow       the Overflow column
list:<listId>      a list column
<uuid>             a todo card (no prefix)
```

`parseColumnId(id)` returns `{kind:"day"|"overflow"|"list", ...}` or `null`.
**`null` means the id is a card**, which is how the code distinguishes the two
everywhere. `isColumnId()` wraps that check.

### 4.2 Collision detection — pointer first

This is the most important part of the file, and it was a bug fix.

```ts
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  const collisions = underPointer.length > 0 ? underPointer : closestCorners(args);
  const target = preferPreciseTarget(collisions);
  return target ? [target] : collisions;
};
```

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
| `onDragStart` | sets `activeTodo` |
| `onDragOver` | sets `overId` — needed for the insertion indicator |
| `onDragEnd` | resolves target, computes position, writes |
| `onDragCancel` | clears state (Escape mid-drag must not strand outlines) |

`overTodoId` is derived: null if `over` is a column, and **null if `over` is the
dragged card itself** — an indicator above the item being moved would imply a
no-op drop.

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

### 4.7 Sensors

```ts
useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
```

The 4px activation distance keeps clicks distinguishable from drags — without
it, clicking a card's title to open the detail sheet starts a drag instead.

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

### 5.4 The grip is faintly visible at rest

`text-muted-foreground/30`, darkening on hover — not hidden. A control that only
exists on hover is undiscoverable until you happen to sweep over it. This was
the original complaint that prompted the affordance work.

---

## 6. Visual states

**Card** (`todo-card.tsx`)
- grip faintly visible at rest → darker on hover; `cursor-grab` / `grabbing`
- dragged source stays at **30% opacity** so the column does not collapse under
  the cursor
- insertion line: 2px primary bar + leading dot, absolutely positioned at
  `-top-px`, drawn *above* the hovered card

**Column** (`board-column.tsx`) — three mutually exclusive drag states:

| State | Condition | Style |
|---|---|---|
| candidate | drag active, not hovered | dashed 1px border outline |
| active | hovered, accepts | solid 2px primary outline + `bg-primary/5` |
| rejecting | Overflow | dashed/solid destructive outline + `bg-destructive/5` |

All use `outline-offset-[-2px]` to draw inside the column bounds.

Hovering a column but no specific card renders an end-of-column indicator
instead of a per-card line.

**Overlay** (`board.tsx`) — tilted `rotate-2`, `scale-[1.02]`, ring + shadow, so
the item reads as lifted off the board rather than sliding along it.

> Tailwind silently drops classes it does not recognize, so a typo leaves an
> outline as an invisible no-op with everything still "passing". Verify new
> utilities actually emit CSS:
> `grep -oE "outline[a-z-]*:[^;]{0,30}" .next-static/_next/static/chunks/*.css | sort -u`

---

## 7. Known gaps / candidate next work

Nothing here is started.

1. **Keyboard drag is wired but never exercised end-to-end.** Sensors and the
   `closestCorners` fallback exist; the actual flow (Tab to grip → Space → arrows
   → Space) has not been verified. Screen-reader announcements
   (`announcements` / `screenReaderInstructions` on `DndContext`) are entirely
   unconfigured — dnd-kit's defaults are generic and say nothing about days or
   lists.
2. **No auto-scroll while dragging to a column off-screen.** Both halves scroll
   horizontally (`overflow-x-auto`); dragging toward the edge does not scroll.
   Blocks moving a todo to a day outside the current viewport.
3. **No cross-half scroll affordance** for the same reason.
4. **Touch is untested.** `activationConstraint: {distance: 4}` may need
   `delay`+`tolerance` on touch so a drag does not fight page scroll. Matters
   for Capacitor (P7).
5. **No multi-select drag.**
6. **Overlay width vs. cursor.** The overlay is `max-w-xs`; on a narrow column
   it visually overhangs neighbours while only the cursor's column highlights.
   Correct, but arguably reads oddly — worth a look.
7. **No drag-to-reorder for columns themselves** (reordering lists).
8. **`onDragOver` sets state on every move.** Fine now; if the board grows to
   hundreds of todos, profile before adding more per-move work.

---

## 8. Working on this

```bash
npm run dev        # http://localhost:3000 (or 3001 if taken)
npm test           # vitest run — 64 tests
npm run verify     # typecheck + lint + tests + BOTH builds; run before commit
```

`npm run verify` must stay green. It includes a **static-export build** that
guards the future Capacitor target — if it fails, an app route took a dependency
on RSC data fetching, middleware, or `next/image`.

### Testing drag-and-drop

Pure logic — `preferPreciseTarget`, `parseColumnId`, `positionForIndex`,
`buildBoard` — is unit-testable and already covered. **Prefer extracting a pure
function over testing dnd-kit itself**; jsdom/happy-dom has no layout, so
rect-based collision logic cannot be meaningfully tested there.

Manual checklist:

1. Hover a card — grip visible before hover, darkens on hover.
2. Start a drag — **every** column outlines dashed at once.
3. Straddle two day columns — the column under the **cursor** highlights solid,
   even though the card overlaps its neighbour. *(This was the reported bug.)*
4. Cross a boundary slowly — highlight switches cleanly, no dead zone or flicker.
5. Hover empty space low in a column — still highlights; indicator at the end.
6. Hover a specific card — indicator jumps to that card.
7. Drag over Overflow — red-tinted; drop is refused with a toast.
8. Escape mid-drag — all outlines clear.
9. List → day: item leaves the list column, appears under the day.
10. Day → list: item returns, `scheduledDate` cleared.
11. Keyboard: Tab to grip → Space → arrows → Space.

### A caution

Every drag-and-drop bug found so far — the invisible grip, the dead zone between
columns — was invisible to typecheck, lint, and unit tests. They only appear
when a human drags something. **Do not report drag work as verified on the
strength of a green test run.** Say what was and was not exercised by hand.
