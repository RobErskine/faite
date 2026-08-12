# "@" mentions

A reusable inline picker: type "@" in a text field, get a filtered popover of
things to pick from, select one, done. First use is quick-add's "@list"
mention (`board-column.tsx`) — type `buy milk @groc fri` in any quick-add
row, pick "Grocery List" from the popover, and the todo files there instead
of the column you were typing in.

The pieces are split so the next field that wants this (day notes, todo
description — see §5) doesn't rebuild it:

- **`src/lib/mention.ts`** — pure trigger detection, text-splicing, and
  ranking. No React, no DOM. Fully unit tested (`mention.test.ts`).
- **`src/components/mention-menu.tsx`** — the `useMention` hook (turns a
  field's value + cursor into open/closed state, filtered results, and
  keyboard-nav plumbing) and `<MentionMenu>` (the popover itself).

## 1. How the trigger works

`findMentionTrigger(value, cursor)` looks backward from the cursor for an
"@" that starts a word (string start, or preceded by whitespace) with no
whitespace between it and the cursor. That's the whole rule — matches
Slack/Linear/Notion: `foo@bar.com` never triggers, `buy milk @groc` does
the moment the cursor sits right after `groc`, and typing a space ends it.

The trigger is **recomputed from scratch on every call**, from `value` and
`cursor` alone. There's no separate "is a mention active" state to fall out
of sync — if you can produce those two things accurately, the trigger is
always correct.

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

`board-column.tsx`'s quick-add row is the pattern to copy:

```tsx
const items = useMemo(() => lists.map((l) => ({ id: l.id, label: l.name, data: l })), [lists]);
const mention = useMention({ value: draft, cursor, items });

// In onKeyDown, BEFORE any of the field's own key handling:
if (mention.isOpen) {
  if (e.key === "ArrowDown") { e.preventDefault(); mention.moveHighlight(1); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); mention.moveHighlight(-1); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    const resolved = mention.resolveHighlighted();
    if (resolved) applyMention(resolved); // your own state update — see below
    return;
  }
  if (e.key === "Escape") { e.preventDefault(); mention.dismiss(); return; }
}
// ...the field's normal key handling continues here.

// In the JSX, next to the input:
{mention.isOpen && (
  <MentionMenu
    results={mention.results}
    highlightedIndex={mention.highlightedIndex}
    onHighlight={mention.setHighlightedIndex}
    onSelect={(item) => applyMention(mention.resolve(item))}
    side="up" // or "down" — see §4
  />
)}
```

`mention.resolve(item)` / `resolveHighlighted()` return
`{ text, caretIndex, item }` — `text` is the field's value with the
"@query" span removed (or replaced, see below), `caretIndex` is where the
caret should land, `item` is whichever `{id, label, data}` was picked. What
you do with `item.data` is entirely up to the field:

- **Quick-add** treats it as a *hidden field override*: the text
  disappears, `mentionedList` state holds the picked `List`, and it's
  threaded through `onQuickAdd(title, listId)` to override which list the
  todo files into (see `board.tsx`'s `handleQuickAdd`). Nothing about the
  mention survives as visible text.
- **A future visible-reference field** (§5) would instead call
  `mention.resolve(item, "@" + item.label)` — passing a non-empty
  `replacement` keeps the "@Grocery List" text in place rather than
  removing it, so it reads as an inline link rather than vanishing.

After calling `setValue(resolved.text)`, move the DOM caret to
`resolved.caretIndex` in a `useEffect` (React doesn't reliably preserve
caret position across a mid-string splice) — `board-column.tsx`'s
`pendingCaretRef` pattern is the template: a `ref`, not `state`, since
nothing needs to *render* off it, only one imperative `setSelectionRange`
call after the value commits.

## 4. Positioning — read this before reusing in a new field

`<MentionMenu>` is a **plain anchored popover** (`position: absolute`
against the nearest `relative` ancestor), not portaled, not
viewport-aware. That's a deliberate simplification, not an oversight, and
it only works because quick-add's input is pinned at a **known edge** of
its scroll container (always the last row in the column, so `side="up"`
keeps the popover from being clipped by the column's `overflow-y-auto`).

A field that can be scrolled to **anywhere** on screen — a long note, a
description textarea scrolled mid-way — doesn't have that luxury. Before
wiring `@mentions` into one:

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

## 5. What's built vs. what's next

**Built:** quick-add's `@list` mention, in list columns, day columns, and
Backlog (`board-column.tsx`). Not yet wired into the command palette's
"New to-do" entry (its `CommandInput` is a `cmdk` component, not a bare
`<input>` — the DOM ref plumbing above needs a different approach there).

**Deliberately not built:** mentions inside the day-note textarea or a
todo's markdown description. Those need a real design pass, not just
rewiring — they're a *visible, persistent* reference (§3's second case)
rather than a resolve-to-a-hidden-field pick, which raises questions this
doc doesn't answer yet:

- What survives in the stored markdown — a `@Grocery List` literal string,
  or a markdown link syntax (`[Grocery List](list:<id>)`) that can survive a
  rename?
- Does clicking a rendered mention navigate somewhere? These fields aren't
  markdown-rendered today (plain `<textarea>`), so a mention would only ever
  render as plain inline text until that's true.
- Is it lists only, or also labels/projects/places/other todos? The `T` in
  `MentionItem<T>` and `filterMentionItems<T>` are already generic over any
  `{label}` shape, so widening the item source isn't the hard part — the
  hard part is the questions above.

Answer those before extending `@mentions` past quick-add.
