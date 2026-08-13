# Inline mentions — "@list" and "#label"

A reusable inline picker: type a sigil ("@" or "#") in a text field, get a
filtered popover of things to pick from, select one, done. First use was
quick-add's "@list" mention; "#label" followed the same shape, accumulating
rather than replacing, plus an inline "create new" row when nothing matches.
Three fields wire it today — the column quick-add row, the ⌘K palette, and the
to-do sheet's title (see §5).

The pieces are split so the next field that wants this (day notes, todo
description) doesn't rebuild it:

- **`src/lib/mention.ts`** — pure trigger detection, text-splicing, and
  ranking. No React, no DOM. Fully unit tested (`mention.test.ts`).
- **`src/components/mention-menu.tsx`** — the `useMention` hook (turns a
  field's value + cursor + one `MentionSource` per sigil into open/closed
  state, filtered results, and keyboard-nav plumbing) and `<MentionMenu>`
  (the popover itself).

## 1. How the trigger works

`findMentionTrigger(value, cursor, sigil = "@")` looks backward from the
cursor for the given `sigil` character starting a word (string start, or
preceded by whitespace) with no whitespace between it and the cursor. That's
the whole rule — matches Slack/Linear/Notion: `foo@bar.com` never triggers,
nor does `C#`; `buy milk @groc` triggers the moment the cursor sits right
after `groc`, and typing a space ends it.

The trigger is **recomputed from scratch on every call**, from `value`,
`cursor`, and `sigil` alone. There's no separate "is a mention active" state
to fall out of sync — if you can produce those three things accurately, the
trigger is always correct.

**Two sigils can never both be live at the same cursor position**, and it
falls out of this rule rather than needing an explicit tiebreak: a live run
has no whitespace in it, and the *other* sigil needs whitespace immediately
before it to trigger at all. In `"buy @groc #urg|"`, the `@` run is
`"groc #urg"` — it contains a space, so it's dead; only `#` is live.

## 2. The cursor-tracking contract

This is the one thing a caller has to get right, and the only real cost of
adopting this in a new field: **you must track the field's cursor position
in state**, updated on both `onChange` (typing) and `onSelect` (the DOM
event that fires on click-to-reposition and arrow-key caret movement,
independent of any value change).

```tsx
const [cursor, setCursor] = useState(0);
const syncCursor = (el: HTMLInputElement) => setCursor(el.selectionStart ?? el.value.length);

<input
  onChange={(e) => { setValue(e.target.value); syncCursor(e.target); }}
  onSelect={(e) => syncCursor(e.currentTarget)}
/>
```

Missing the `onSelect` half is the usual bug: without it, moving the caret
away from an "@word" with the arrow keys (no text change) leaves the popover
open against a stale cursor position.

## 3. Wiring a field — the reference implementation

`board-column.tsx`'s quick-add row is the pattern to copy. One `useMention`
call takes a `sources: MentionSource<T>[]` — one entry per sigil the field
supports — rather than a flat `items` list, so a single popover and keydown
block arbitrate every sigil the field wants:

```tsx
type Pick = { kind: "list"; list: List } | { kind: "label"; label: Label } | { kind: "create-label"; name: string };

const sources = useMemo((): MentionSource<Pick>[] => [
  {
    trigger: "@",
    items: lists.map((l) => ({ id: l.id, label: l.name, data: { kind: "list", list: l } })),
  },
  {
    trigger: "#",
    items: labels
      .filter((l) => !alreadyPicked.has(l.id))
      .map((l) => ({ id: l.id, label: l.name, data: { kind: "label", label: l } })),
    // Optional — see §3a. Omit entirely for a source with no "create" affordance.
    onNoMatch: (query) => ({
      id: "__create__",
      label: `Create label "${query}"`,
      data: { kind: "create-label", name: query },
    }),
  },
], [lists, labels, alreadyPicked]);
const mention = useMention({ value: draft, cursor, sources });

// In onKeyDown, BEFORE any of the field's own key handling:
if (mention.isOpen) {
  if (e.key === "ArrowDown") { e.preventDefault(); mention.moveHighlight(1); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); mention.moveHighlight(-1); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    const resolved = mention.resolveHighlighted();
    if (resolved) void applyMention(resolved); // your own state update — see below
    return;
  }
  if (e.key === "Escape") { e.preventDefault(); mention.dismiss(); return; }
}
// ...the field's normal key handling continues here.

// In the JSX, next to the input, inside a `relative` wrapper:
{mention.isOpen && (
  <MentionMenu
    results={mention.results}
    highlightedIndex={mention.highlightedIndex}
    onHighlight={mention.setHighlightedIndex}
    onSelect={(item) => void applyMention(mention.resolve(item))}
    side="up" // or "down" — see §4
    ariaLabel={mention.sigil === "#" ? "Labels" : "Lists"}
  />
)}
```

`mention.resolve(item)` / `resolveHighlighted()` return
`{ text, caretIndex, item }` — `text` is the field's value with the
sigil-plus-query span removed (or replaced, see below), `caretIndex` is
where the caret should land, `item` is whichever `{id, label, data}` was
picked. `mention.sigil` (`"@"`, `"#"`, or `null` when closed) tells the
caller which source is live — useful for the popover's `ariaLabel` and
nothing else; the hook never needs to know what a list or a label *is*.
What you do with `item.data` is entirely up to the field:

- **Quick-add's `@list`** treats it as a *hidden field override*: the text
  disappears, `mentionedList` state holds the picked `List`, and it's
  threaded through `onQuickAdd(title, listId, labelIds)` to override which
  list the todo files into (see `board.tsx`'s `handleQuickAdd`). Nothing
  about the mention survives as visible text.
- **Quick-add's `#label`** works the same way but **accumulates** instead
  of replacing: `mentionedLabels` is an array, appended to on each pick, and
  the label source's own `items` filters out anything already in it — a
  second pick of the same label would otherwise read as a no-op bug. Each
  pick renders as a removable chip (`quick-add-preview.tsx`'s `onRemove`) —
  unlike a mis-picked list, a stray label can't be corrected by picking again.
- **The to-do sheet's title** (§5) resolves *immediately* as a real field
  write — `onSave(id, { listId })` for `@`, `onToggleLabel(id, labelId)` for
  `#` — rather than staging anything, since that field is always editing a
  todo that already exists.
- **A future visible-reference field** would instead call
  `mention.resolve(item, "@" + item.label)` — passing a non-empty
  `replacement` keeps the "@Grocery List" text in place rather than
  removing it, so it reads as an inline link rather than vanishing.

After calling `setValue(resolved.text)`, move the DOM caret to
`resolved.caretIndex` in a `useEffect` (React doesn't reliably preserve
caret position across a mid-string splice) — `board-column.tsx`'s
`pendingCaretRef` pattern is the template: a `ref`, not `state`, since
nothing needs to *render* off it, only one imperative `setSelectionRange`
call after the value commits.

### 3a. The `onNoMatch` "create new" row

A source can offer to create a new item when the query matches nothing.
`useMention` appends the built item to `results` **after** the real matches
are filtered and capped to `filterMentionItems`'s limit — so it's never the
thing pushed out of the list by real matches, and it's never shown when an
existing item's label matches the query exactly, case-insensitively (a
partial match like `"urg"` against `"Urgent"` still offers to create `"urg"`
verbatim, since that's not the same item).

Because creating something is an async write, the one branch of
`applyMention` that has to await is the `onNoMatch` pick — `void
applyMention(...)` at both call sites (Enter and click) already tolerates
this the same way `void handleQuickAdd(...)` does elsewhere in this
codebase. The text splice and caret move happen synchronously regardless;
only the confirmation (a chip appearing, or the sheet's toggle lighting up)
lags by one write.

Only the label source sets `onNoMatch` today. The list source doesn't:
creating a list has more shape to it (which tab, Backlog placement) than
fits a one-line mention pick.

## 4. Positioning — read this before reusing in a new field

`<MentionMenu>` is a **plain anchored popover** (`position: absolute`
against the nearest `relative` ancestor), not portaled, not
viewport-aware. That's a deliberate simplification, not an oversight, and
it only works because every field that uses it today is pinned at a
**known edge** of its container — quick-add's input is always the last row
in a scrolling column (`side="up"`), the palette's input sits at the top of
a fixed-position dialog (`side="down"`), and the sheet's title sits in a
non-scrolling header (`side="down"`).

A field that can be scrolled to **anywhere** on screen — a long note, a
description textarea scrolled mid-way — doesn't have that luxury. Before
wiring mentions into one:

- Either constrain the field the same way (pin the mention-bearing row to a
  container edge), or
- Give `<MentionMenu>` real positioning: measure the caret's actual pixel
  position (there's no native API for this on a `<textarea>`; the standard
  trick is a hidden mirror `<div>` with identical font metrics) and render
  through a portal, closer to what `ui/autocomplete.tsx`'s Base UI
  `Positioner`/`Portal` already do for the Location field's typeahead. Base
  UI's own `Autocomplete` wasn't reused here because it owns the entire
  input's value as the query — wrong shape for a token embedded mid-sentence
  — but its positioning primitives are the ones to reach for.

Don't reuse `side="up"`/`side="down"` for a field where you haven't checked
which edge it's pinned to; the wrong side clips silently rather than erroring.

See `docs/PICKERS.md` for the sibling family of fields — `LocationField` and
`LabelPicker` — built directly on Base UI's `Autocomplete`/`Combobox` rather
than this inline-mention system, including why each picked the primitive it
did and a gotcha (`empty:hidden`) worth knowing before styling either.

## 5. What's built vs. what's next

**Built**, all three sharing `src/lib/mention.ts` and `mention-menu.tsx`:

| Field | Sigils | Resolves as |
| --- | --- | --- |
| Quick-add row (`board-column.tsx`) — list/day columns, Backlog | `@` list, `#` label | Staged (`mentionedList`/`mentionedLabels`), applied on commit |
| ⌘K palette, root + "New to-do" (`command-palette.tsx`) | `@` list, `#` label | Staged, applied on create |
| To-do sheet title (`todo-sheet.tsx`) | `@` list, `#` label | Immediate field write (`onSave`/`onToggleLabel`) |

`#label` also offers inline creation (§3a) on all three; `@list` does not.

**Deliberately not built:** mentions inside the day-note textarea or a
todo's markdown description. Those need a real design pass, not just
rewiring — they're a *visible, persistent* reference (§3's "future
visible-reference field" case) rather than a resolve-to-a-hidden-field or
resolve-to-a-write pick, which raises questions this doc doesn't answer yet:

- What survives in the stored markdown — a `@Grocery List` literal string,
  or a markdown link syntax (`[Grocery List](list:<id>)`) that can survive a
  rename?
- Does clicking a rendered mention navigate somewhere? These fields aren't
  markdown-rendered today (plain `<textarea>`), so a mention would only ever
  render as plain inline text until that's true.
- Projects, places, other todos? The `T` in `MentionItem<T>` and
  `filterMentionItems<T>` are already generic over any `{label}` shape, and
  a source is just `{ trigger, items, onNoMatch? }`, so adding a fourth
  sigil is mechanical — the hard part is the two questions above, not the
  plumbing.

Answer those before extending mentions past quick-add/palette/sheet.
