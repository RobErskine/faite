# Right-click context menus

Right-clicking a to-do card or a list column header opens a menu of quick
actions (EI-281). Built on `@base-ui/react/context-menu`, styled by
`src/components/ui/context-menu.tsx`.

Rationale that belongs to the data model or the drag system lives in
`ARCHITECTURE.md` and `DRAG-AND-DROP.md`; this file is the procedure and the
constraints particular to menus.

---

## 1. What has a menu

| Target | Items |
| --- | --- |
| To-do card (`todo-card-menu.tsx`) | Edit · Mark done / not done · Won't do · Reschedule ▸ · Delete |
| List column header (`list-column-menu.tsx`) | List settings… · Color ▸ · Archive · Delete |
| Tab pill (`tab-pill-menu.tsx`) | Tab settings… · Color ▸ · Archive · Delete |

Nothing else, yet. Day/Overflow/Backlog headers, archived-list rows,
attachment rows and sheet subtask rows are all plausible and all unbuilt.

The Color ▸ submenu is shared (`color-submenu.tsx`) — two call sites is what
earns the extraction; the item lists are not.

Two targets were considered and **declined**, which is worth writing down so
they are not "fixed" later:

- **`create-list-column.tsx`** — there is nothing to act on.
- **The empty board background.** Suppressing the native menu across a large
  empty region costs Reload, Inspect and Back, in exchange for actions the
  header and ⌘K already provide. This is the one place the browser's menu is
  worth more than ours.

---

## 2. Four rules

**Every item duplicates an existing route.** The checkbox, the sheet footer,
⌘K, a drag. This is Base UI's own guidance — a context menu is an accelerator,
never the only way to do something — and it is what lets the feature ship with
no visible `⋯` button on a card and no accessibility regression. An action that
is *only* reachable by right-click does not belong here; give it a home first.

**Fine pointers only.** See §3.

**An open menu counts as a modal.** See §4.

**Never make a subtree containing a text input a trigger.** Base UI's
document-level listener calls `preventDefault` on `contextmenu` anywhere inside
a trigger, so a field inside one loses cut/copy/paste/spellcheck. This holds
today by construction — the column filter sits below the header, quick-add is
in the column body — and `e2e/context-menu.spec.ts` has the assertion that
notices if either moves.

---

## 3. Why there is no long-press menu on touch

`board.tsx` wraps the shells in `<ContextMenusEnabled value={!coarse}>`, so
touch-primary devices get no context menus at all.

This is a constraint, not a preference. Long-press is already spoken for:

- dnd-kit's `TouchSensor` lifts a card at **400 ms** on a coarse pointer
  (`use-board-actions.ts`).
- Base UI's `LONG_PRESS_DELAY` is a hardcoded **500 ms** module constant with
  no prop to change it (`context-menu/trigger/ContextMenuTrigger.js`).
- Base UI clears its timer only on a `touchmove` over 10 px — **never** on drag
  activation.

So a still finger gets both: a lifted card, and a menu over it. Retuning the
sensor does not fix this, it only chooses which of the two breaks — push
dnd-kit past 500 ms and its timer still fires, now behind an open menu.

The replacement for phone is `MOBILE.md`'s M4 row `⋯` action sheet, which is
also where `GESTURES.md` already sends swipe-actions. **When M4 lands, it and
the card menu should share one item list** — that is the point at which
extracting an action registry pays for itself, and not before (§6).

`disabled` is honored by the primitive in both `handleContextMenu` and
`handleTouchStart`, so the single flag closes off right-click and long-press
together.

The guard against someone quietly re-enabling this is a negative assertion in
`e2e/touch-affordances.spec.ts`, which runs on tablet and all three phone
projects: a 700 ms press opens no `role="menu"`. Flip
`ContextMenusEnabled value={!coarse}` to `true` and it fails.

---

## 4. An open menu blocks board hotkeys

Base UI owns focus and Escape inside its popup. It does **not** own ⌘Z: that
keydown bubbles to `document`, `react-hotkeys-hook` runs undo, and the board
rewrites itself behind a menu whose items still describe the pre-undo card.
Worse for a reschedule — undo can tombstone the row between the menu opening
and an item being clicked, and `mutate()` throws on a missing row by design.

So `BoardOverlayState` carries `contextMenuOpen`, fed by `useAnyMenuOpen()`
from `src/lib/menu-open-store.ts`. See `KEYBOARD.md` §4.3 for the guard model
in general.

The store is module-level rather than state threaded through the tree, because
the alternative is a callback prop on every card and column so the shell can
learn one boolean. `ui/context-menu.tsx`'s root registers once, so every
context menu — including ones added later by someone who never reads this file
— is covered with no wiring. Only `board.tsx` subscribes, so opening a menu
re-renders the shell and not 200 cards.

It **counts** rather than holding a boolean: menus overlap, and a submenu over
its parent would flip a bare boolean to the wrong value on close. Subscribers
are notified only on the zero crossing, so interior transitions cost no
renders.

**Known asymmetry:** `DropdownMenu` does *not* register. The same footgun
exists there today and predates this work. Worth fixing; out of scope here.

**Escape** needs no special handling. Base UI consumes it, so the
selection-clearing listener in `use-board-ui-state.ts` never sees it — verified
with a document-level keydown spy, and again in the browser.

---

## 5. Traps

**`w-(--anchor-width)`.** `dropdown-menu.tsx` sizes its popup from the trigger.
A context menu's anchor is a synthetic `DOMRect` of width 0 for a mouse (10 for
touch), so copying that class renders a zero-width popup — which presents as
"the menu never opened", sending you to look in entirely the wrong place. Use
`min-w-44`. There is a test.

**The tab pill composes two `useRender` components.** It is both a
`TooltipTrigger` and a `ContextMenuTrigger`, which is precisely the shape of
L747 — where the outer one silently swallowed the inner's handlers and eleven
happy-dom assertions still passed. Three assertions in
`e2e/context-menu.spec.ts` cover it in a real browser: the tooltip still opens
(under `realHover`, since `locator.hover()` cannot open a Base UI tooltip at
all — that test is the CONTROL), the menu still opens, and a nested button
inside the trigger still receives a plain click. Add a third composed
primitive anywhere and write the same three.

**The row IS the trigger.** `ContextMenuTrigger` renders a plain `<div>` and
takes every div prop, so a card's existing root element becomes the trigger
rather than gaining a wrapper. This keeps `setNodeRef`, the drop indicator's
geometry, `data-todo-row`, `data-nav-stop` and the arrow-key focus target on
the element that already carried them. It is also why `.ai/lessons.md` L747
cannot repeat: that bug needed two composed Base UI `useRender` components, and
there is one here. `board-column.tsx` is the exception — its header must stay a
`<header>`, so it uses `render={<header />}`, with the ref on the trigger.

**macOS Ctrl+click.** It arrives as `mousedown` with button 0 and `ctrlKey`,
which dnd-kit's `MouseSensor` tracks happily — so without a guard a 4 px twitch
lifts the card out from under the menu it just opened. `startsDrag()` in
`todo-card.tsx` is that guard. dnd-kit refuses button 2 on its own, so a plain
right-click was never the problem. Note that the `ctrlKey` branch in the
multi-select capture handler has always been dead code on macOS, because the OS
suppresses the `click` — a context menu takes nothing away there.

**The portaled popup is not "outside" the row.** The selection-clearing
listener in `use-board-ui-state.ts` treats a click outside `[data-todo-row]` as
"clicked elsewhere". A menu item is portaled to `<body>`, so without a
`[role="menu"]` bail-out, clicking "Mark done" clears the very selection it is
about to act on, before it acts.

---

## 6. Why there is no action registry

`command-registry.ts` is data because its rows are homogeneous and a second
consumer is planned. Neither holds here: the card menu needs a date submenu,
the list menu needs a color radio group, and a registry covering both is a
small renderer framework for two call sites. Per-target components are the
smaller answer as well as the simpler one.

Revisit when M4's `⋯` sheet lands (§3) — two genuinely different render targets
sharing one item list is the case that justifies it.

The other thing that would force a registry is the performance fallback: if one
`Menu.Root` per card ever measures badly, the replacement is a single
board-level root with a virtual anchor driven by `onContextMenu` and a
`{kind, id, x, y}` in `useBoardUiState`, which needs the items as data. That is
why the cheap path is worth measuring rather than assuming.

---

## 7. Batching

A card's menu never learns what else is selected. It passes its own `todo` and
a `selectionCount`, and `use-board-actions.ts` decides whether that means one
row or the whole selection (`targetsFor`).

Right-click **inside** the selection acts on all of it; right-click **outside**
clears it. That is the rule `handleDragStart` already applies to a lift, and
one rule for both gestures beats two.

`targetsFor` reads `selectedTodos` — the derived, board-ordered list — never
`selectedIds`. A to-do that has been deleted, archived, filtered out or carried
to another tab leaves that list by simply not appearing, and a stale id
reaching `mutate()` is how it throws.

The three writes (`handleContextStatus`, `handleContextDelete`,
`handleReschedule`) are new rather than reuses of the existing single-row
handlers, which each raise their own toast: a batch of five would stack five
toasts and five undo entries, and ⌘Z would reverse one fifth of what happened.
One `pushUndo` with N steps is what makes a single ⌘Z put all of them back.

**Unresolved, inherited from EI-195:** there is no selection size cap. N
actions are N sequential Dexie transactions and N outbox entries, and a menu
makes large selections likelier than dragging does. Whether to cap, warn, or
confirm above some N is open.

---

## 8. Tests

`src/components/ui/context-menu.test.tsx` is the control case, and it is the
reason the rest of the suite can be trusted: it proves happy-dom can open this
primitive **at all** before anything depends on that. It can — unlike the
tooltip in L747.

Two things happy-dom cannot see, both learned the hard way here:

- **dnd-kit's `MouseSensor` never activates under happy-dom**, not even for a
  plain left-drag. Three assertions of the form "a right-click starts no drag"
  were written, passed, and deleted — they passed whether or not the guard
  existed. The guard is now a pure function (`startsDrag`) tested directly, per
  `KEYBOARD.md` §9.
- **⌘Z does not fire in the Playwright harness**, a pre-existing gap documented
  in `multi-drag.spec.ts`. So `e2e/context-menu.spec.ts` deliberately does not
  assert "undo did nothing while a menu was open" — that would pass regardless.
  The guard is covered in `board-guards.test.ts` instead.

`e2e/context-menu.spec.ts` runs on **`desktop` only**, which is the feature
rather than a shortcut (§3); the negative touch case lives in
`touch-affordances.spec.ts`, which already runs everywhere else. See
`E2E.md` §8.
