# Command palette & search — working document

**Self-contained handoff.** Everything needed to extend the ⌘K palette and turn
its search from "finds a to-do by title" into something genuinely powerful,
without reading the rest of the codebase first.

Read §5 before designing anything. The single biggest constraint on search is
not the matcher — it is that **cmdk re-filters everything we render**, and most
interesting ranking ideas are in direct conflict with that.

Status at time of writing: palette does creates, deletes, tab switching, view
settings, typography, and substring search over to-do titles/descriptions.

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
| `src/components/board/command-palette.tsx` | the whole surface (~485 lines) |
| `src/lib/search.ts` | `searchTodos` — the matcher, pure and testable |
| `src/lib/search.test.ts` | matcher unit tests |
| `src/components/board/command-palette.test.tsx` | DOM-level tests, incl. search |
| `src/components/board/app-header.tsx` | the search-field trigger |
| `src/components/ui/command.tsx` | shadcn `base-nova` wrapper over cmdk |
| `src/components/board/board.tsx` | owns open state, hotkey, and the callbacks |

Related: `docs/KEYBOARD.md` (how `mod+k` is registered and why it is exempt from
every guard), `docs/ARCHITECTURE.md` (data model, local-first constraints).

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
| **To-dos** | up to 8 search hits | only when the query is non-empty |
| **Create** | `Create to-do "<query>"` | only when the query is non-empty |
| | New to-do / list / label / project / tab | each enters an entry mode |
| **Tabs** | one row per tab, active marked `current` | hidden when `tabs.length <= 1` |
| **Manage** | Delete a list… / Delete a tab… | each enters a picker mode |
| **View** | Show 1 / 3 / 5 / 7 days | writes `settings.visibleDays` |
| | Roll over on workdays only ⇄ every day | writes `settings.workdaysOnly` |
| **Typography** | one row per font pairing | each row previews itself via `data-font` |

Every mutating item routes through the shared undo helpers (`recordCreate`,
`deleteListWithUndo`, `deleteTabWithUndo`) so palette actions and their
equivalents elsewhere in the UI cannot diverge.

**The commands are hardcoded JSX, not data.** That is the main structural
obstacle to everything in §7 — see §6.1.

---

## 5. Search as it works today

### 5.1 The matcher

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

### 5.2 The constraint that shapes everything — cmdk double-filters

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

### 5.3 The create-from-query fallback

When a query matches no command and no to-do, `Create to-do "<query>"` files it
straight into Backlog with a full undo entry. This is the reason search exists
at all — a dead end should still be one keystroke from being captured.

### 5.4 What is searchable

**To-dos only.** Lists, labels, projects, and tabs are *not* searched — tabs
appear as a static switcher group, and the rest have no navigation target. Rows
that do nothing on Enter are worse than absent rows.

---

## 6. Known limits

### 6.1 Commands are JSX, not a registry

Every command is inline JSX with an inline `onSelect`. Nothing can enumerate,
score, reorder, or filter them programmatically. This blocks: command ranking,
frecency, "recently used", scoped modes, aliases, per-command keywords, and any
custom filtering that requires `shouldFilter={false}`.

**A command registry is the prerequisite for most of §7.** Shape it roughly as:

```ts
interface PaletteCommand {
  id: string
  group: "Create" | "Manage" | "View" | "Typography" | …
  label: string
  keywords?: string[]
  hotkey?: string          // reuse the Hotkey table in board.tsx
  when?: (ctx) => boolean  // e.g. hide "Delete a tab" when only one exists
  run: () => void | Promise<void>
}
```

### 6.2 Performance

`useTodos()` holds **every** to-do in memory and `searchTodos` linearly scans
them on every keystroke. Synchronous, no debounce, no index. Fine at hundreds of
rows; it will not hold at tens of thousands. There is no full-text index in
Dexie — options when it matters: a `multiEntry` token index, an in-memory
inverted index rebuilt on write, or SQLite FTS5 server-side after sync (P3).

### 6.3 Everything else missing

- Result cap is a hard 8 with no "show more" and no pagination.
- No highlighting of the matched substring in results.
- No query syntax — no `list:`, `label:`, `is:done`, `due:`.
- No search of description *content* beyond substring, no markdown awareness.
- No recent searches, no empty-state suggestions, no zero-result guidance
  beyond the create fallback.
- Query does not persist across open/close.
- No actions on a result — Enter opens the sheet, that is all. No "schedule it
  for tomorrow" without leaving the palette.
- Search is client-only and local-first; it must stay that way on the
  interaction path even after sync lands.

---

## 7. Ideas for a more powerful search

Roughly ordered by value-to-effort. Each notes what it depends on.

### Tier 1 — high value, contained

1. **Own the filtering.** Set `shouldFilter={false}` and score both commands and
   results ourselves. Removes the double-filter constraint entirely and unlocks
   fuzzy matching, token reordering, and honest ranking. *Requires §6.1.*
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
   lists, mirroring Slack/Linear. Cheap once there is a registry and a parser.
7. **Ranking on more than text** — frecency (recently opened, frequently
   opened), deadline proximity, current tab first. Needs a small usage-log
   table, or reuse of `updatedAt`/`completedAt`.

### Tier 3 — scale and polish

8. **Indexed search** — see §6.2. Only worth it with real data volume;
   measure first.
9. **Saved searches / smart lists** — a saved query rendered as a column. This
   is a product feature, not a search feature, but it falls out of §5 for free.
10. **Semantic search** — embeddings over titles + descriptions. Only sensible
    post-sync (P3) with a server to compute them; must degrade to lexical
    search offline.

---

## 8. Testing

Two layers, both required:

- **`src/lib/search.test.ts`** — pure matcher. Node environment, no DOM. Tier
  ordering, status ordering, recency tiebreak, soft-delete exclusion, limit.
- **`src/components/board/command-palette.test.tsx`** — happy-dom, asserts on
  what actually reaches the DOM. This layer is not optional: the matcher can be
  perfectly correct while cmdk scores the row to zero and hides it. Any new
  matcher behaviour needs a DOM test proving it survives cmdk.

Conventions: `// @vitest-environment happy-dom` pragma on line 1, explicit
imports from `vitest` (no globals), explicit `afterEach(cleanup)`, plain
`.toBeTruthy()` / `.toBeNull()` assertions (no jest-dom).

Gate: `npm run verify` — typecheck (app + worker), eslint, vitest, `next build`,
and `BUILD_TARGET=static next build`. The static leg protects the Capacitor
target; palette work must stay client-only.

---

## 9. Gotchas that have already bitten

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
