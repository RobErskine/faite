# Keyboard shortcuts — working document

**Self-contained handoff.** Everything needed to add a keyboard shortcut to
Faite without reading the rest of the codebase. Read §4 before writing any
handler — the guard model is the entire difficulty of this problem, and getting
it wrong breaks typing rather than merely failing to fire.

Keyboard is a headline feature, not a convenience layer. The target is that a
planning session never needs the mouse.

**The rule in one line:** a global shortcut is a row in the registry, never a
`keydown` listener.

---

## 1. The map as it stands

**Global** — declared in the `hotkeys` registry in
`src/components/board/board.tsx`, bound by `<Hotkeys>` (§6):

| Chord | Action | Guards opted out of |
|---|---|---|
| `⌘K` / `Ctrl+K` | Toggle the command palette | all three |
| `⌘Z` / `Ctrl+Z` | Undo the last board action | none |
| `⇧⌘Z` | **Deliberately unbound.** Redo does not exist; see ARCHITECTURE §2.11 | — |

**Local** — `onKeyDown` on the element that owns the behaviour:

| Where | Keys |
|---|---|
| `command-palette.tsx` | `Enter` submits an entry mode, `Escape` returns to root |
| `board-column.tsx` | `Enter` commits a quick-add, `Escape` clears the draft, `←→↑↓` navigate (§6) |
| `create-list-column.tsx` | `Enter` commits, `Escape` cancels, `←→↑↓` navigate off the idle button (§6) |
| `list-info-dialog.tsx` | `Enter` saves the list name |
| `todo-sheet.tsx` | `Enter` blurs the title (commit-on-blur does the write) |
| `todo-card.tsx` | `←→↑↓` navigate (§6), `Enter` opens the sheet, `Space` toggles done; dnd-kit's keyboard drag activator, on the grip |
| `board.tsx` load-more tile | `←→↑↓` navigate (§6) |
| `rail-handle.tsx` | `←`/`→` resizes the rail 16px, `Enter`/`Space` collapses it, double-click resets to the CSS default |

**Owned by libraries — do not re-bind:**

- **cmdk** owns `↑ ↓ Enter` inside the palette list.
- **Base UI** Dialog/Sheet own `Escape` to close, plus focus trap and restore.
- **dnd-kit** owns `Space` to lift, arrows to move, `Space` to drop, `Escape` to
  cancel — but only while a drag is active, and only from the grip.

Binding a global chord any of these already claims is the most likely way to
break something invisibly. Check this table first.

---

## 2. Two layers, and how to choose

**Local (`onKeyDown` on an element)** — the default. Use it when the shortcut
only makes sense while a specific control has focus: `Enter` to commit a draft,
`Escape` to cancel one. No registration, no guards, no cleanup. It cannot leak,
because it only fires when focus is already inside.

**Global (the registry)** — only when the shortcut must work with focus anywhere
on the board. `⌘K` and `⌘Z` qualify: both are useless if you first have to click
the right element.

> Prefer local. Every global shortcut is a claim on a chord across the whole
> app, and it has to answer all of §4. A local handler answers none of those
> questions — it just works.

---

## 3. Chord conventions

- **Always require a modifier for a global shortcut.** A bare letter collides
  with typing the moment focus lands somewhere unexpected. Single letters are
  fine *locally*.
- **Write `mod`, never `ctrl` or `meta`.** `mod` resolves to ⌘ on macOS and Ctrl
  elsewhere. Hand-rolling `metaKey || ctrlKey` is wrong in both directions: it
  fires `Ctrl+K` on macOS, where the OS uses that for "delete to end of line" in
  text fields.
- **Do not bind `⌥`/`Alt` chords.** On macOS `Alt` is a character composer —
  `⌥N` produces `˜`, so the produced character is not the letter you wrote.
- **Match platform meaning.** `⌘Z` undo, `⌘K` command palette, `⌘Enter` submit,
  `Escape` dismiss. Inventing a meaning for a chord the OS already owns costs
  more than the shortcut is worth.
- **Reserved, never bind:** `⌘W ⌘T ⌘N ⌘Q ⌘R ⌘L` (browser/OS), plus anything in
  the §1 library table.

---

## 4. The guard model — read this one

A global handler runs on **every** keystroke in the app, including every
keystroke typed into a text field. Four questions must be answered before it
acts. The registry answers them for you, but only if each entry declares its
opt-outs honestly — so understand what you are opting out of.

Guards default to **ON**. A shortcut must opt in to firing in a context that
belongs to something else.

### 4.1 Is focus in a text field? → `allowInTextEntry`

Native text undo (`⌘Z`), select-all, and caret motion have to keep working.
Stealing them breaks typing in exchange for a feature nobody wanted there.

Handled by the library's `enableOnFormTags` / `enableOnContentEditable`. The
same question is asked in plain code by `isTextEntry(target)` in
`src/lib/undo.ts`:

```ts
target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")
```

`closest` rather than a tag check, because the event target can be a node
*inside* a contenteditable. Note it returns `false` for `<button>` — Base UI's
`Checkbox` renders a button, so shortcuts stay live when focus sits on a card's
checkbox, which is correct.

### 4.2 Is a drag in flight? → `allowDuringDrag`

While `activeTodo` or `activeList` is set, dnd-kit holds a snapshot of the board
that a mutation would invalidate — the pending drop computes its insertion point
from stale siblings. **Anything that writes must bail mid-drag.** A read-only
shortcut (open a panel) is usually fine.

### 4.3 Does an open surface own the keyboard? → `allowWhenModalOpen`

Every modal surface belongs in `GuardContext.modalOpen`. Today: the palette, the
todo sheet, the list-info dialog, and the archived-lists sheet.

Two distinct reasons, both real:

- The todo sheet seeds `title` and `description` as local drafts on a keyed
  remount, so a store write cannot reach those inputs — an undo would move the
  data while the fields kept showing the old text.
- `isTextEntry` only covers focus sitting *in* a modal's input. With focus on a
  button, an unguarded shortcut would quietly rewrite the board behind whichever
  surface is covering it.

> **When you add a modal, add it to `guardContext`.** This is the single easiest
> thing to forget, and the failure is silent.

### 4.4 Is this chord actually mine?

Check the modifiers you *don't* want, not just the ones you do. `⇧⌘Z` must fall
through rather than being swallowed by a `⌘Z` handler that never checked
`shiftKey` — otherwise pressing redo silently performs an undo.

`hasExactModifiers` in `src/lib/keyboard.ts` enforces this for every entry, so
you get it for free. It is ours rather than the library's because whether
`react-hotkeys-hook` fires `mod+z` for `⇧⌘Z` is undocumented (§7), and that
failure mode is invisible.

Swallowing a chord you don't handle is worse than not binding it: it does
nothing, and it makes adding the real behaviour later a change in behaviour.

---

## 5. How to add a shortcut

1. **Can it be local?** If the behaviour needs focus on a control, put
   `onKeyDown` on that control and stop here.
2. **Check §1 and §3** — is the chord claimed by cmdk, Base UI, dnd-kit, or the
   OS?
3. **Add a row to the registry** in `board.tsx`. Never a new `keydown`
   listener — the `label` is what makes it discoverable, and one binding path is
   easier to reason about than several racing ones.
4. **Give it a real `label` and `group`.** These are not decoration; §8 renders
   them. A shortcut with a vague label is a shortcut nobody will find.
5. **Declare guard opt-outs deliberately.** Default to none. Anything that
   writes must not opt out of `allowDuringDrag`.
6. **Add it to the §1 table.**
7. **Test the guard, not the keypress** (§9).

Do **not** call `preventDefault()` yourself — the binding sets
`preventDefault: true` for every entry.

---

## 6. The registry

Two global shortcuts fit in one `useEffect`. Ten do not: they become ten
listeners with ten copies of the guard logic, no shared record of what is bound,
and no way to render a help screen.

The crucial property is that the table is **data**, so one source drives the
handler, the `⌘K` palette hints, and the `?` help sheet. That single source of
truth is why this exists even though combo matching is easy — and it is exactly
what a hotkey library does *not* give you (§7).

| File | Role |
|---|---|
| `src/lib/keyboard.ts` | Pure: types, `parseCombo`, `hasExactModifiers`, `isEligible`, `formatCombo`, `detectPlatform`. No DOM. |
| `src/components/hotkeys.tsx` | `<Hotkeys>` — binds the registry via `react-hotkeys-hook`. The only file that imports it. |
| `src/lib/keyboard.test.ts` | 18 cases over the pure layer. |
| `src/components/board/board.tsx` | Declares the registry and `guardContext`. |

```ts
export interface Hotkey {
  id: string;
  /** Canonical: lowercase, `+`-separated. `mod` = ⌘ on macOS, Ctrl elsewhere. */
  combo: string;
  /** Shown in the help sheet and palette. Required — see §5.4. */
  label: string;
  group: "Board" | "Editing" | "Navigation";
  /** Guard opt-outs. All default to false; see §4. */
  allowDuringDrag?: boolean;
  allowInTextEntry?: boolean;
  allowWhenModalOpen?: boolean;
  run: () => void;
}

export interface GuardContext {
  dragging: boolean;
  modalOpen: boolean;
}

export function Hotkeys(props: { registry: Hotkey[]; context: GuardContext }): ReactNode;
```

**A component, not a hook.** One library `useHotkeys` call is needed per entry,
and React forbids hooks in a loop; rendering one child per hotkey keyed by `id`
gives each its own call site and lets the registry grow without touching the
binding code.

Call site (`board.tsx`):

```tsx
const hotkeys = useMemo<Hotkey[]>(() => [
  { id: "command-palette", combo: "mod+k", label: "Open the command palette",
    group: "Navigation",
    allowDuringDrag: true, allowInTextEntry: true, allowWhenModalOpen: true,
    run: () => setPaletteOpen((o) => !o) },
  { id: "undo", combo: "mod+z", label: "Undo the last action", group: "Board",
    run: () => void handleUndo() },
], [handleUndo]);

const guardContext = useMemo<GuardContext>(() => ({
  dragging: !!activeTodo || !!activeList,
  modalOpen: paletteOpen || !!openTodoId || !!infoListId || archivedOpen,
}), [activeTodo, activeList, paletteOpen, openTodoId, infoListId, archivedOpen]);

<Hotkeys registry={hotkeys} context={guardContext} />
```

`⌘K` opts out of **every** guard: the palette is how you escape a dead end, so
it must work from wherever the user is — including while it is already open,
where it toggles closed. The cost is that it shadows macOS's `Ctrl+K` in text
fields; that is a deliberate trade, matching Linear and Notion. `⌘Z` opts out of
nothing.

**Two matching details the library already handles**, worth knowing so nobody
re-litigates them:

- **Matching is on physical key `code`, not the produced character.** With a
  modifier held, `event.key` varies by layout — on Dvorak, `⌘Z` reports
  `event.key === ";"`. Code-matching is `react-hotkeys-hook` v5's default (it
  was a headline breaking change from v4) and is what every native app does.
- **`mod` resolves per-platform**, so `metaKey || ctrlKey` never appears in app
  code.

---

## 7. On `react-hotkeys-hook`

**Adopted: `^5.3.3`.** Verified against the sources in §13 — published
2026-06-26, peer dep `react >=16.8.0`, actively maintained, no React 19
constraint.

The split is deliberate: **the library owns combo matching; we own the registry
and the guards.**

### What it gives us

- **`mod`** — "triggers on either `ctrl` or `meta`, regardless of platform…
  `ctrl` on Windows/Linux and `cmd` on macOS."
- **Key-code matching by default** (v5), with `useKey: true` to opt into the
  produced character instead.

Both are fiddlier than they look, and both were bugs in the hand-rolled handler
this replaced.

### What it does not give us

**No enumeration.** There is no built-in way to list registered hotkeys. There
is a `metadata` option and a `description` field, but the docs are explicit that
you "must manually maintain registries" to render shortcut documentation. So the
§6 table has to exist regardless — which is the whole argument for building it.

**The §4 guards are still ours.** `enableOnFormTags` /
`enableOnContentEditable` cover §4.1, and `enabled` is a clean hook for
§4.2–4.3 — but nothing general knows about `activeTodo`, `openTodoId`, or
dnd-kit's stale snapshot.

### How it is wired

```ts
useLibHotkeys(hotkey.combo, (event) => {
  if (!hasExactModifiers(hotkey.combo, event)) return;   // §4.4, ours
  hotkey.run();
}, {
  enabled: isEligible(hotkey, context),                  // §4.2–4.3, ours
  enableOnFormTags: hotkey.allowInTextEntry ?? false,    // §4.1
  enableOnContentEditable: hotkey.allowInTextEntry ?? false,
  preventDefault: true,
}, [hotkey.run, hotkey.combo]);
```

`src/components/hotkeys.tsx` is the only file importing the library. If the
dependency ever has to go, hand-writing combo matching on `event.code` plus a
platform `mod` check is ~40 lines, and no call site changes.

**Do not adopt its `scopes` feature** without re-reading §1 — scopes overlap
with Base UI's and cmdk's own `Escape` handling.

---

## 8. Discoverability

A shortcut nobody knows about is dead code. The registry carries `label` and
`group` precisely so these can be generated rather than maintained by hand:

- **`?` opens a help sheet**, grouped by `Hotkey.group`, rendered from the
  registry so it cannot drift from what is actually bound.
- **The `⌘K` palette shows the chord** next to any command that has one. There
  is a `<kbd>` treatment to copy — see the Commands button in `app-header.tsx`.
- **Render chords with `formatCombo(combo, detectPlatform())`** — `⌘K` on
  macOS, `Ctrl+K` elsewhere, with macOS's `⌃⌥⇧⌘` modifier ordering.

Neither consumer is built yet (§12). Until one exists, every new entry's `label`
is a promise being deferred, not decoration.

---

## 9. Testing

Follow the `drop-animation.test.ts` precedent: **extract the pure function and
test that.** Simulating key events through Testing Library tests the browser
more than it tests the code. `src/lib/keyboard.test.ts` covers:

- `parseCombo` — modifier/key split, alias normalisation, case and whitespace.
- `hasExactModifiers` — `mod` matches either Ctrl or Meta but **not both**;
  rejects an unrequested extra modifier (the `⇧⌘Z` case); distinguishes an
  explicit `ctrl+` combo from `meta`.
- `isEligible` — each guard blocks unless opted out; several guards at once
  require every relevant opt-in.
- `formatCombo` — platform glyphs vs words, macOS `⌃⌥⇧⌘` ordering regardless of
  how the combo was written, named non-letter keys.
- `isTextEntry` lives in `src/lib/undo.test.ts`, including the `<button>` case
  (Base UI's Checkbox) and nested contenteditable.

Component-level tests only for wiring pure functions cannot reach, using the
`// @vitest-environment happy-dom` pragma per existing convention.

---

## 10. Accessibility

- A shortcut is an **accelerator, never the only route**. Every action needs a
  focusable control too — this is why `⌘Z` does not remove the toast's Undo
  button.
- **Never trap focus** outside a real modal. Base UI already handles the modals.
- **Do not bind single printable characters globally** — screen readers use them
  for quick-nav in browse mode. (`?` in §8 is the standard exception, and needs
  `allowInTextEntry: false` so typing a question mark still works.)
- Announce results rather than relying on visual change alone. The "Undone"
  toast does this today.

---

## 11. Arrow-key navigation across the board

The one large local shortcut, and the worked example for §2. It is what makes
"a planning session never needs the mouse" true rather than aspirational: from
a quick-add field you can reach every other quick-add field, every card, and
both end-of-track tiles without touching Tab.

### 11.1 The model — a grid of stops

The board is two rows of columns (§ARCHITECTURE 1), and **every column is an
ordered list of *stops* running top to bottom** — its to-do cards, then its
quick-add field:

```
calendar   [ Overflow ] | [ today ] [ +1 ] [ +2 ] … [ Load N more days ]
planning   [ Backlog  ] | [ list  ] [ list ] …      [ Create list      ]
```

| Column | Stops |
|---|---|
| Overflow | its cards only — **no quick-add**, so an empty Overflow has no stops |
| day column | its cards, then its quick-add |
| Backlog / list column | its cards, then its quick-add |
| Load more / Create list | one stop each |

A stop is a place you can **create or act on** something. That is why Overflow
has none when it is empty: nothing can be scheduled *into* Overflow, only out of
it, so a field there would discard whatever you typed. (It used to render one,
wired to a no-op `onQuickAdd`. `onQuickAdd` is now optional and Overflow omits
it.) A collapsed rail renders neither cards nor a quick-add, so it drops out of
its row entirely.

Four rules resolve a keypress, and they are all in `resolveNavTarget`:

1. **`↑`/`↓` walk the column.** `↓` on a planning quick-add is the bottom of the
   board; `↑` on a calendar column's first card is the top.
2. **Past those ends, vertical crosses halves.** The target is the column you
   were **last in** on that row, falling back to the row default — today going
   up, Backlog going down — and then to the first column with any stops. Tried
   in that order, not collapsed: a remembered column goes stale when a list is
   archived or a day scrolls past the horizon, and falling straight through
   would land on Overflow instead of today.
3. **`←`/`→` move one column, no wrapping.** A column with no stops is a **wall,
   not something to skip** — `←` from today with an empty Overflow does nothing
   rather than vaulting over it.
4. **Anchor preservation.** Leaving a quick-add lands on the target's quick-add;
   leaving a card lands on the same card index, clamped. Without this, `→` out
   of an empty column into a thirty-card one would dump you on card one instead
   of the field you were typing in — which is the whole feature.

### 11.2 Why this is not in the registry

It is the clearest case §2 describes, and the reasons are worth stating so
nobody "tidies" it into `board.tsx`'s table:

- `hotkeys.tsx` sets `preventDefault: true` **unconditionally** for every entry.
  A global arrow binding would therefore break caret motion in every text field
  on the board, the rail handle's 16px nudge, dnd-kit's keyboard drag, and
  cmdk's `↑ ↓` inside the palette — all four are in the §1 table.
- §3 forbids bare-key globals for exactly this reason, and permits them locally.
- The behaviour is meaningless without a focused stop, which is §2's test for
  "local".

The registry stays for chords that must work from anywhere. This is the other
half of the map.

### 11.3 The three guards that matter

- **Empty draft only.** The quick-add has `onBlur={commit}`, so navigating away
  mid-draft would **silently create the to-do you were still typing**. With text
  in the field arrows move the caret as normal; `Enter` already clears the draft
  and keeps focus, so type → `Enter` → `→` is the intended loop. This is a data
  bug, not a focus bug, which is why `column-nav.test.tsx` guards it.
- **Bare arrows only.** `navKeyOf` rejects any modified arrow, in the spirit of
  `hasExactModifiers` (§4.4): `⌥←` is word-jump, `⌘←` is line-start, `⇧←`
  extends a selection.
- **Not during a drag.** `useColumnNav` bails while `dragging`, the same
  reasoning as `railDisabled` — dnd-kit owns the arrows once a lift is active
  and its cached droppable rects are live (§4.2).

`onNavigate` returns a **boolean**, and callers only `preventDefault()` when it
comes back true. A press that resolves to nowhere falls through untouched rather
than being swallowed — §4.4's rule, applied to a local handler.

### 11.4 Focus, and how the DOM is reached

Every stop carries `data-nav-stop="<id>"`; the hook queries for it. A ref
registry was the alternative and lost: four render groups across two halves
would each have to thread a registration callback, versus one attribute per call
site with nothing to clean up. Ids are `todo:<id>`, `add:<columnId>`,
`nav:create-list`, `nav:load-more` — all generated ids, ISO dates or literals,
so the quoted attribute selector needs no `CSS.escape`.

To-do card rows are `tabIndex={-1}`: focusable **programmatically but not by
Tab**, so the existing tab order (grip → checkbox → title) is unchanged and
`todo-card.tsx`'s "no `role` on the row, or we nest interactive controls inside
a button" constraint still holds. `Enter`/`Space` on a card are guarded by
`e.target === e.currentTarget`, or a press on the checkbox or grip would fire
twice as it bubbled through.

Scrolling is deliberate, never native: the hook calls
`focus({ preventScroll: true })`, then either `jumpToIndex` — when the target day
falls outside `useDayTrack`'s `[anchorIndex, anchorIndex + visibleCount)` — or
`scrollIntoView({ block: "nearest" })`. Letting the browser scroll the day track
would land it between columns and fight the anchor the next `jumpBy` reads.

### 11.5 Files

| File | Role |
|---|---|
| `src/lib/column-nav.ts` | Pure: the grid, `resolveNavTarget`, `navKeyOf`, stop ids. No DOM. |
| `src/lib/column-nav.test.ts` | The grid arithmetic — every edge, both anchors, the fallback chain. |
| `src/components/board/use-column-nav.ts` | Finds the node, moves focus, scrolls. |
| `src/components/board/column-nav.test.tsx` | happy-dom: the attributes reach the DOM, and a draft keeps its caret. |
| `src/components/board/board.tsx` | Builds the grid and hands one `navigate` to every stop. |

**When you add a column kind or an end-of-track tile, add it to
`buildNavGrid`** — the failure is silent: the column simply cannot be reached,
and nothing warns.

---

## 12. Open work

- **No help sheet, no chord hints in the palette (§8).** The registry carries
  `label` and `group` for exactly this; nothing consumes them yet. This is the
  highest-value next step — every shortcut added before it ships is
  undiscoverable.
- **Only the board has a registry.** If shortcuts are wanted outside `Board`,
  `guardContext` needs to move up the tree rather than being duplicated.
- **`HotkeyGroup` has three values** (`Board` / `Editing` / `Navigation`) chosen
  before there was much to group. Revisit when the help sheet exists and the
  real clusters are visible.
- **`hasExactModifiers` may become redundant** if a future version documents
  exact matching. It costs one comparison and removes a silent-failure mode, so
  it earns its keep either way.
- **Navigation (§11) has no announcements.** Focus moves and the ring shows it,
  but nothing tells a screen reader which column you landed in. §10 asks for
  results to be announced rather than shown; a live region naming the column
  would close it.
- **No keyboard route to the tab strip or the rails.** §11's grid covers the two
  column tracks only. Reaching a tab, or a rail handle, is still Tab.

---

## 13. Sources

Verified August 2026. Re-check before changing §7 — the v4 → v5 migration
changed matching behaviour, so version-specific claims go stale.

- [react-hotkeys-hook on npm](https://www.npmjs.com/package/react-hotkeys-hook)
  — v5.3.3, published 2026-06-26, peer dep `react >=16.8.0`.
- [useHotkeys API](https://react-hotkeys-hook.vercel.app/docs/api/use-hotkeys)
  — signature, `useKey`, `enableOnFormTags`, `enabled`, `metadata`; confirms no
  enumeration API.
- [Basic usage](https://react-hotkeys-hook.vercel.app/docs/documentation/useHotkeys/basic-usage)
  — the `mod` alias.
- [Scoping hotkeys](https://react-hotkeys-hook.vercel.app/docs/documentation/useHotkeys/scoping-hotkeys)
  — scopes, `HotkeysProvider`, `useHotkeysContext`.
- [Releases](https://github.com/JohannesKlauss/react-hotkeys-hook/releases) —
  v5 breaking changes: code-matching by default, `enabledScopes` → `activeScopes`,
  `splitKey` → `delimiter`.
