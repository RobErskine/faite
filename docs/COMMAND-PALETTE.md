# Command palette & search — working document

**Self-contained handoff.** Everything needed to extend the ⌘K palette and turn
its search from "finds a to-do by title" into something genuinely powerful,
without reading the rest of the codebase first.

Read §6 before designing anything. The single biggest constraint on search is
not the matcher — it is that **cmdk re-filters everything we render**, and most
interesting ranking ideas are in direct conflict with that.

Status at time of writing: palette does creates, deletes, tab switching, view
settings, substring search over to-do titles/descriptions, row actions
(complete/won't-do/delete a search hit without leaving the palette — §4, §7.3),
and (§5) quick-add tokens — priority, dates, deadlines, times, an `@list`
mention, and a `#label` mention (which can also create the label inline) —
when creating a to-do from typed text. Font pairing moved to Settings → Design
(`src/components/settings/design-section.tsx`); it is no longer a palette
command.

---

## 1. What exists (60 seconds)

One dialog, opened three ways:

| Entry point | Where |
| --- | --- |
| `⌘K` / `Ctrl+K` | hotkey registry in `board.tsx` (`id: "command-palette"`) |
| Header search field | `app-header.tsx` — a `<button>` styled as an input |
| — | no other entry point; there is no in-board search box |

It is a **controlled** component. `Board` owns `paletteOpen`; the palette owns
only its internal mode and input value.

```
Board
 ├─ paletteOpen ────────────────┐
 ├─ AppHeader onOpenPalette ────┤
 └─ CommandPalette ◄────────────┘
      ├─ mode   (root | new-* | delete-*)
      └─ value  (the input text)
```

---

## 2. Files

| File | Role |
| --- | --- |
| `src/components/board/command-palette.tsx` | the whole surface |
| `src/lib/command-registry.ts` | `ROOT_COMMANDS` — the root menu's Create/Manage/View commands as data, plus `commandsByGroup` — see §7.1 |
| `src/lib/command-registry.test.ts` | pure unit tests for the registry — visibility, disabled/label logic, status-toggle math |
| `src/lib/search.ts` | `searchTodos` — the matcher, pure and testable |
| `src/lib/search.test.ts` | matcher unit tests |
| `src/components/board/command-palette.test.tsx` | DOM-level tests, incl. search and §5 |
| `src/components/board/app-header.tsx` | the search-field trigger |
| `src/components/ui/command.tsx` | shadcn `base-nova` wrapper over cmdk — `CommandInput` forwards its ref (§5) |
| `src/components/board/board.tsx` | owns open state, hotkey, and the callbacks |
| `src/lib/quick-add.ts` | §5's token grammar — shared with column quick-add, not palette-specific |
| `src/lib/mention.ts` | §5's `@` trigger detection — shared, see `docs/AT-MENTION.md` |
| `src/components/mention-menu.tsx` | §5's `useMention` hook + popover — shared |
| `src/components/board/quick-add-preview.tsx` | §5's live chip row — shared |
| `src/components/board/todo-row-parts.tsx` | `PriorityRail`/`TitleMarkers`/`TodoMetaBadges` — presentational pieces of `TodoCard`, factored out so a search hit renders priority/deadline/recurrence/labels the same way a board card does. See §10's `TodoCard` gotcha for why the card itself isn't reused directly. |
| `src/components/board/todo-card.tsx` | the board card; now a consumer of `todo-row-parts.tsx`, not the source of it |

Related: `docs/KEYBOARD.md` (how `mod+k` is registered and why it is exempt from
every guard), `docs/ARCHITECTURE.md` (data model, local-first constraints),
`docs/AT-MENTION.md` (the `@` mention system in full — trigger detection,
cursor-tracking contract, positioning tradeoffs; this doc only covers how the
palette wires into it).

---

## 3. The mode machine

The palette reuses one input for everything rather than opening nested dialogs.

```ts
type Mode =
  | { kind: "root" }        // commands + search results
  | { kind: "new-list" }    // ─┐
  | { kind: "new-label" }   //  │ entry modes: input is free text,
  | { kind: "new-project" } //  │ Enter submits, cmdk filtering OFF
  | { kind: "new-tab" }     //  │
  | { kind: "new-todo" }    // ─┘
  | { kind: "delete-list" } // ─┐ picker modes: input filters an existing
  | { kind: "delete-tab" }  // ─┘ set, cmdk filtering ON
```

Three rules that are easy to break:

1. **`shouldFilter={!isEntryMode}`.** In an entry mode the input is a *name being
   typed*, not a query. With filtering on, cmdk hides the single "create" item
   the moment the typed value stops matching its label.
2. **`Escape` in a sub-mode returns to root**, it does not close the dialog.
   Only `Escape` at root closes.
3. **Mode and value reset in `handleOpenChange`**, not in an effect on `open`.
   Syncing state to a prop in an effect causes a cascading render, which the
   React 19 lint rejects. (See `react-hooks/set-state-in-effect`.)

---

## 4. Current command inventory

At root, in render order:

| Group | Items | Notes |
| --- | --- | --- |
| **To-dos** | up to 8 search hits | only when the query is non-empty; each hit renders like a board card (priority rail, deadline/location/recurrence markers, label and scheduled-date badges — via `todo-row-parts.tsx`) and supports the row actions below |
| **Create** | `Create to-do "<query>"` | only when the query is non-empty; parses quick-add tokens — §5 |
| | New to-do / list / label / project / tab | New to-do parses quick-add tokens too — §5; the rest enter a plain entry mode |
| **Tabs** | one row per tab, active marked `current` | hidden when `tabs.length <= 1` |
| **Manage** | Delete a list… / Delete a tab… | each enters a picker mode |
| | Keyboard shortcuts | opens the help sheet (`?`, EI-75) |
| | Activity feed | opens the global activity feed (`⌘⇧A`) — the whole-app event log, `activity-sheet.tsx` |
| **View** | Show 1 / 3 / 5 / 7 days | writes `settings.visibleDays` |
| | Roll over on workdays only ⇄ every day | writes `settings.workdaysOnly` — same setting also lives in Settings → Faite Loop (`loop-section.tsx`, EI-96), which additionally exposes `overflowAfterDays`; see [FAITE-LOOP.md](FAITE-LOOP.md) |
| | Open Overdrive (N) | disabled when Overflow is empty; opens the same full-screen triage overlay as the button at the foot of the Overflow column (EI-97) — see [OVERDRIVE.md](OVERDRIVE.md) |

Every mutating item routes through the shared undo helpers (`recordCreate`,
`deleteListWithUndo`, `deleteTabWithUndo`) so palette actions and their
equivalents elsewhere in the UI cannot diverge.

**Row actions**, keyboard-only and not part of the command list above: with a
to-do hit highlighted, `⌘⏎` toggles done/open, `⌘⌫` marks won't-do, `⌘⇧⌫`
deletes — mirroring `TodoSheet`'s bindings (`todo-sheet.tsx`). They call
`onSetTodoStatus`/`onDeleteTodo`, which `board.tsx` wires to the same
`handleSheetStatus`/`handleDelete` callbacks the sheet uses, so the undo toast
and `materializeIfNeeded` guard (for acting on a virtual recurrence occurrence)
are identical either way. The palette stays open afterward — unlike selecting a
hit, which closes it. One deliberate divergence from the sheet: `TodoSheet`
exempts `⌘⌫` when focus is in a text field, because that combo means "delete
to line start" natively; the palette does not, since its search input is the
only focus target and exempting it would just disable the shortcut.

**The Create/Manage/View commands above are data, not hardcoded JSX** — see
§7.1 (EI-77). To-do results, the Tabs switcher, and the delete pickers stay
bespoke renders, deliberately (§7.1 explains why).

---

## 5. Quick-add tokens & the `@list`/`#label` mentions

Typed text in `Create to-do "<query>"` and `New to-do` is not literal — it is
parsed the same way a column's quick-add row parses a title, so
`buy milk p2 fri 2pm @groceries #urgent` creates one to-do with `priority: 2`,
`scheduledDate` set to the next Friday, `reminderTime: "14:00"`, files it into
the "Groceries" list instead of Backlog, and applies the "Urgent" label.
`quickAdd` (the parsed result) is computed once from `value` and reused by
both creation paths, so root's fallback and `New to-do` can never disagree
about what the same typed text means.

This is the "scoped modes" idea in §8 item 6 below, shipped — but as an
**inline mention inside free text**, not a mode that restricts the whole
palette to a picker. Typing `@` or `#` doesn't leave `mode.kind === "root"` or
`"new-todo"`; it opens a small popover *over* the input, and picking a result
resolves to a hidden field rather than to visible text: `@` sets
`mentionedList` (a single value — picking again replaces it), `#` appends to
`mentionedLabels` (an array — every `#` mention accumulates, rendered as its
own removable chip). A `#` query that matches no existing label offers a
"Create label" row; picking it creates the label on the spot and adds it the
same way. Full mechanics — trigger detection, the cursor-tracking contract,
the `MentionSource`/`onNoMatch` shape, why positioning is a plain anchored
popover rather than portaled — live in `docs/AT-MENTION.md`; this section
only covers what's specific to wiring it into `CommandInput`.

**Grammar** (source of truth: `src/lib/quick-add.ts`'s own comments):
`p1`-`p4` for priority, a weekday/`next <weekday>`/`M/D`/month-day/ISO date,
`!` before any of those for a deadline instead of a scheduled date, and a
time (`2pm`, `14:00`). Tokens are only recognized at the edges of the string
(trailing run for all kinds, leading run for priority only) — see the module
for why: it's what keeps "call mom about p1 stuff" from parsing anything. The
`@`/`#` mentions are **not** part of this grammar — they're a UI pick, not
text the parser sees (see `quick-add-preview.tsx`'s doc comment).

**Where it's live:** root mode's search box (via the `Create to-do` fallback)
and `New to-do`. **Not** `new-list`/`new-label`/`new-project`/`new-tab`/
`delete-*` — those aren't creating a to-do, so `mentionSources` is `[]` there
and the popover never opens (an empty source list is how `useMention` stays
permanently closed, rather than a special case per mode).

**The one cmdk-specific wrinkle:** `useMention` needs the underlying
`<input>` DOM node — to read `selectionStart` for cursor tracking and to
reposition the caret after a mention resolves — so `CommandInput`
(`ui/command.tsx`) now forwards its `ref`. It didn't before this; there was
no other consumer of the component at the time, so this was a safe, additive
change, but check for new consumers before assuming that's still true.

---

## 6. Search as it works today

### 6.1 The matcher

`searchTodos(query, todos, limit = 8)` in `src/lib/search.ts`. Four tiers,
best first:

| Tier | Match |
| --- | --- |
| 0 | title starts with the query |
| 1 | any word in the title starts with the query |
| 2 | title contains the query |
| 3 | description contains the query |

Ties break by status (`open` before `done`/`dropped`), then `updatedAt`
descending. Soft-deleted rows are excluded. Empty query returns `[]` — the
palette shows its command list until you actually type.

### 6.2 The constraint that shapes everything — cmdk double-filters

**cmdk applies its own subsequence scorer to every item we render.** The
displayed result set is the *intersection* of our matcher and cmdk's, and cmdk
also **re-sorts** the rows, so our tier order is advisory at best.

Two consequences currently worked around:

- **Substring matching is deliberate, not lazy.** A substring match is always a
  subsequence match, so every row `searchTodos` returns survives cmdk's filter.
  A fuzzier or token-reordering matcher (`"milk buy"` matching `"Buy milk"`)
  would score 0 in cmdk and vanish — search would look broken, not strict.
- **Description hits travel as cmdk `keywords`.** cmdk cannot score text we do
  not render, so `keywords={[todo.description]}` is what keeps a
  description-only hit alive. The test `"finds to-dos by description, which
  cmdk's own filter cannot see"` is the guard on this.

Also: rows use `value={`${todo.title} ${todo.id}`}` because titles repeat
("Follow up") and cmdk keys selection off `value`. Title comes first because
cmdk scores the value string.

### 6.3 The create-from-query fallback

When a query matches no command and no to-do, `Create to-do "<query>"` files it
straight into Backlog with a full undo entry. This is the reason search exists
at all — a dead end should still be one keystroke from being captured.

### 6.4 What is searchable

**To-dos only.** Lists, labels, projects, and tabs are *not* searched — tabs
appear as a static switcher group, and the rest have no navigation target. Rows
that do nothing on Enter are worse than absent rows.

---

## 7. Known limits

### 7.1 Commands are JSX, not a registry — RESOLVED (EI-77)

~~Every command is inline JSX with an inline `onSelect`. Nothing can enumerate,
score, reorder, or filter them programmatically.~~ The root menu's "Create",
"Manage", and "View" groups now render from a data structure —
`ROOT_COMMANDS` in `src/lib/command-registry.ts` — instead of hardcoded JSX.
Each `PaletteCommand` is a plain object:

```ts
interface PaletteCommand {
  id: string
  group: "Create" | "Manage" | "View"
  label: (ctx: PaletteCommandCtx) => string
  value?: (ctx) => string   // cmdk match value override — only the
                             // create-from-query fallback needs one
  shortcut?: (ctx) => string | undefined
  when?: (ctx) => boolean   // omit to always show
  disabled?: (ctx) => boolean
  className?: string
  run: (ctx: PaletteCommandCtx) => void | Promise<void>
}
```

`commandsByGroup(ctx)` filters by `when` and buckets by group in render
order; `command-palette.tsx` builds one `PaletteCommandCtx` per render (query
state, settings, the mode-switching/mutation callbacks) and maps each
group's commands through a small `renderCommand` helper. The registry module
itself never imports `mutateSettings`/`createTodo`/etc — every side effect is
injected through `ctx`, so it stays pure and importable without pulling in
`cmdk` or any of the palette's dialog machinery. This is what unblocks the
planned `/capture` quick-add window (separate effort): it can import
`ROOT_COMMANDS` and supply its own `ctx` rather than reimplementing the
command list.

**Deliberately still bespoke, not registry entries** — see the doc comment
at the top of `command-registry.ts` for the full reasoning:
- to-do search results and the Tabs switcher (existing entities, not
  commands, one row per record)
- the delete-list/delete-tab picker bodies (same reason)
- the multi-step entry modes themselves (`new-list`, `new-todo`, …) — a
  registry command only *switches into* one via `ctx.enterMode`; the mode
  body (free-text input + its Enter-to-create row) stays a distinct concept
  per the EI-77 brief, not force-fit into a single-shot command shape.

This unblocks command ranking, frecency, "recently used", scoped modes,
aliases, per-command keywords, and any custom filtering that requires
`shouldFilter={false}` — the rest of §8 is still open, this was only the
prerequisite.

### 7.2 Performance

`useTodos()` holds **every** to-do in memory and `searchTodos` linearly scans
them on every keystroke. Synchronous, no debounce, no index. Fine at hundreds of
rows; it will not hold at tens of thousands. There is no full-text index in
Dexie — options when it matters: a `multiEntry` token index, an in-memory
inverted index rebuilt on write, or SQLite FTS5 server-side after sync (P3).

### 7.3 Everything else missing

- Result cap is a hard 8 with no "show more" and no pagination.
- No highlighting of the matched substring in results.
- No query syntax for *filtering search results* — no `list:`, `label:`,
  `is:done`, `due:`. (Not the same thing as §5's quick-add tokens, which
  apply when *creating* a to-do, not searching for one.)
- No search of description *content* beyond substring, no markdown awareness.
- No recent searches, no empty-state suggestions, no zero-result guidance
  beyond the create fallback.
- Query does not persist across open/close.
- Row actions are complete/won't-do/delete only (§4) — no "schedule it for
  tomorrow" or other edits without leaving the palette.
- Search is client-only and local-first; it must stay that way on the
  interaction path even after sync lands.

---

## 8. Ideas for a more powerful search

Roughly ordered by value-to-effort. Each notes what it depends on.

### Tier 1 — high value, contained

1. **Own the filtering.** Set `shouldFilter={false}` and score both commands and
   results ourselves. Removes the double-filter constraint entirely and unlocks
   fuzzy matching, token reordering, and honest ranking. *Requires §7.1.*
2. **Match highlighting.** Bold the matched range in each result. Trivial once
   we own the scorer and it returns match offsets.
3. **Search lists, labels, projects, tabs.** Needs a destination for each:
   selecting a list could scroll-and-flash its column, a label could apply a
   board filter. *Requires a board-level filter or focus mechanism.*
4. **Result actions.** `⌘Enter` to complete, `⌘→` to schedule for tomorrow,
   without leaving the palette. Reuses existing mutation helpers.

### Tier 2 — query language

5. **Filter tokens** — `list:groceries`, `label:urgent`, `is:done`, `due:today`,
   `overdue:`, `tab:work`. Parse into a structured query, apply as predicates,
   free text is the remainder. Worth a dedicated parser module with its own
   tests (`src/lib/query.ts`), kept pure like `search.ts`.
6. **Scoped modes** — typing `>` restricts to commands, `#` to labels, `@` to
   lists, mirroring Slack/Linear. `@` for lists and `#` for labels both
   shipped (§5) — but as inline mentions that resolve to hidden fields (or, on
   the `#` side, an inline label-creation row) on a to-do being created, not a
   mode that restricts the whole palette to a picker. Only `>` (command
   filtering) as described here is still open. Cheap once there is a registry
   and a parser.
7. **Ranking on more than text** — frecency (recently opened, frequently
   opened), deadline proximity, current tab first. Needs a small usage-log
   table, or reuse of `updatedAt`/`completedAt`.

### Tier 3 — scale and polish

8. **Indexed search** — see §7.2. Only worth it with real data volume;
   measure first.
9. **Saved searches / smart lists** — a saved query rendered as a column. This
   is a product feature, not a search feature, but it falls out of §6 for free.
10. **Semantic search** — embeddings over titles + descriptions. Only sensible
    post-sync (P3) with a server to compute them; must degrade to lexical
    search offline.

---

## 9. Testing

Three layers, all required:

- **`src/lib/command-registry.test.ts`** — pure, node environment. Which
  commands `commandsByGroup` returns per `ctx` (create-fallback visibility,
  entry-mode ids), and the `label`/`disabled`/`run` logic on the View group
  (current-day marker, last-status-can't-turn-off guard, status-toggle
  ordering, Overdrive's count/disabled state).
- **`src/lib/search.test.ts`** — pure matcher. Node environment, no DOM. Tier
  ordering, status ordering, recency tiebreak, soft-delete exclusion, limit.
- **`src/lib/quick-add.test.ts`** / **`src/lib/mention.test.ts`** — pure,
  §5's token grammar and `@`/`#` trigger detection. Not palette-specific, but
  the palette's behavior is only as correct as these.
- **`src/components/mention-menu.test.ts`** — pure-ish (`renderHook`),
  `onNoMatch`'s append-after-slice behavior and multi-source arbitration.
- **`src/components/board/command-palette.test.tsx`** — happy-dom, asserts on
  what actually reaches the DOM. This layer is not optional: the matcher can be
  perfectly correct while cmdk scores the row to zero and hides it. Any new
  matcher behaviour needs a DOM test proving it survives cmdk. The
  `"CommandPalette — @list mention"` block covers §5's list half: the popover
  opening in both root and `New to-do` modes, selection stripping the token
  and showing the chip, and the no-match case staying closed. The
  `"CommandPalette — #label mention"` block covers the label half, including
  accumulation, exclusion of an already-picked label, and the inline
  create-label row.

Conventions: `// @vitest-environment happy-dom` pragma on line 1, explicit
imports from `vitest` (no globals), explicit `afterEach(cleanup)`, plain
`.toBeTruthy()` / `.toBeNull()` assertions (no jest-dom).

Gate: `npm run verify` — typecheck (app + worker), eslint, vitest, `next build`,
and `BUILD_TARGET=static next build`. The static leg protects the Capacitor
target; palette work must stay client-only.

---

## 10. Gotchas that have already bitten

- **`CommandDialog` does not wrap children in `<Command>`.** shadcn renders them
  straight into `DialogContent`, so the `<Command>` must be established manually
  or `CommandInput` has no store and throws on open. Guarded by the
  "mounts open without throwing" test.
- **Base UI is not Radix.** This project uses the `base-nova` shadcn style over
  `@base-ui/react`. Parts are stricter about context: `Menu.GroupLabel` throws
  outright without a `Menu.Group` ancestor. Closed-menu assertions cannot see
  this class of crash — open the surface in the test.
- **cmdk hides non-matching items by unmounting them**, so `queryByText` on a
  filtered-out row correctly returns null. Useful for assertions.
- **cmdk's root, not `CommandInput`, owns ArrowUp/ArrowDown/Enter** — it
  listens on the `cmdk-root` div, and its source explicitly skips its own
  switch statement when `e.defaultPrevented` is already true (not
  documented; read the source). React bubbles one synthetic event
  target-to-root, and `CommandInput` is the deeper element, so
  `e.preventDefault()` inside `CommandInput`'s own `onKeyDown` — which fires
  first — is enough to suppress cmdk's reaction. `e.stopPropagation()` is
  not needed. This is what lets the §5 mention popover own arrow keys while
  it's open without a fight over the same keystroke; assume the same trick
  works for any future keydown-intercepting feature on this input.
- **`CommandInput` didn't forward its `ref` before §5 needed one.** If a
  future feature needs the DOM node again, it's already wired — but if
  `ui/command.tsx` ever gets a second consumer, re-check that forwarding a
  ref there doesn't collide with something that component also needs a ref
  for.
- **`TodoCard` cannot be rendered inside the palette.** Tried when adding
  card-shaped result rows (§4). Three separate reasons:
  - It calls `useSortable({ id: todo.id })` unconditionally — `draggable={false}`
    only drops the grip and cursor classes, it does not gate the hook. The
    palette renders *inside* the board's `<DndContext>`
    (`board.tsx`, opened well before `<CommandPalette>` and closed after it —
    `<DaySheet>` is deliberately mounted *outside* it for the same reason, see
    the comment at its call site). A second `useSortable` registration under
    an id the board already owns silently replaces the real card's dnd-kit
    entry for as long as the palette stays open.
  - The card nests a `<button>` (title), a `Checkbox`, and a grip `<button>`
    inside what would need to be a `CommandItem` — itself a selectable row
    with its own `onSelect`. Nested interactive controls swallow clicks before
    cmdk's selection sees them.
  - The card owns arrow keys via `onNavigate`/`data-nav-stop`; cmdk owns arrow
    keys for its own list navigation.

  Fix was to factor the presentational pieces — priority rail, deadline/
  location/recurrence markers, label/date badges — out into
  `todo-row-parts.tsx` and have both `TodoCard` and the palette's result rows
  consume them. Same look, none of the card's drag/nav machinery.
- **The highlighted result for row actions is read off the DOM, not from a
  controlled `<Command value>`.** `listRef.current.querySelector('[cmdk-item][aria-selected="true"]')`
  mirrors cmdk's own internal lookup. Controlling `value` was tempting but
  wrong: cmdk only auto-selects the first item when `value` is *unset* — a
  controlled value that stops matching any rendered item (e.g. after a status
  change removes/re-sorts rows) would leave nothing selected instead of
  falling back. The `e.preventDefault()` trick two bullets up is what keeps
  `⌘⏎` from also firing cmdk's own Enter-selects-the-highlighted-row
  behavior.
- **`CommandList` isn't wrapped in `forwardRef`, and doesn't need to be.**
  React 19 passes `ref` as a plain prop to function components; `CommandList`
  spreads `...props` onto cmdk's (still-`forwardRef`'d) `List`, so
  `<CommandList ref={listRef}>` reaches the DOM node with no change to
  `ui/command.tsx`. Same caveat as the `CommandInput` bullet above: if this
  component gains logic that reads its own props more explicitly, re-check
  that `ref` still passes through the spread.
