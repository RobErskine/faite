# Typeahead pickers — `LocationField` and `LabelPicker`

Two fields in the to-do sheet type ahead against a filtered list: `Location`
(`location-field.tsx`, saved `Place`s) and `Labels` (`label-picker.tsx`,
`Label`s, replacing an earlier flat grid of toggle badges that stopped being
usable once a workspace has more than a handful of labels). Both are built on
Base UI primitives — `ui/autocomplete.tsx` and `ui/combobox.tsx` respectively
— that look interchangeable at a glance and are not. Read §1 before reaching
for either on a new field.

---

## 1. Autocomplete vs. Combobox — pick by what a selection does to the input

Base UI's own guidance: "Use Combobox instead of Autocomplete if the
selection should be remembered and the input value cannot be custom." In
practice the deciding question is narrower and more mechanical: **does
picking a suggestion consume the query, or replace it?**

| | `Autocomplete` (`ui/autocomplete.tsx`) | `Combobox` (`ui/combobox.tsx`), `multiple` |
|---|---|---|
| Used by | `LocationField` | `LabelPicker` |
| The input's value IS | the record (`todo.location`) | free text — a query, not stored anywhere |
| Picking a suggestion | fills the input with the picked item's text | **clears** the input; the pick renders as a chip instead |
| Selection count | one (the field itself) | many, accumulated as `Combobox.Chip`s |
| `value`/`onValueChange` | the input's own text | an array of the actually-selected item objects |

**`Autocomplete` hardcodes `fillInputOnItemPress: true`** — this is not
configurable through the props `AutocompleteRootProps` exposes; it is set
internally in `AutocompleteRoot.js` alongside `selectionMode: "none"`. That
is exactly right for `LocationField` (`selectPlace` in that file just calls
`setText(place.address)`, which is what the fill was about to do anyway) and
exactly wrong for a field meant to clear itself after every pick so the next
label can be typed immediately — `LabelPicker` was first built on
`Autocomplete`, and every pick landed as literal text in the input instead of
becoming a chip, no matter what the app code did in `onClick`. There is no
prop to turn this off; the fix was switching primitives, not fighting it.

**`Combobox` in `multiple` mode is the actual intended shape for a tag
input**: it ships `Chips`/`Chip`/`ChipRemove` as first-class parts, its
`value` is the array of currently-selected item *objects* (not the input
text), and it clears the input on a pick by design — `onInputValueChange`
reports `reason: "item-press"` for exactly that transition. `LabelPicker`
does not own any selection state at all: `value` is `appliedLabels`, a
projection of `todo.labelIds` through the `labels` prop, so the todo is the
single source of truth and `onValueChange` only ever *diffs* the array Base
UI hands back against `appliedLabels` and calls `onToggleLabel` per
difference — see that function's body for the diff.

## 2. The `Empty` gap — `empty:hidden` is load-bearing

Both `AutocompleteEmpty` and `ComboboxEmpty` wrap a Base UI part whose own
doc comment requires the root element to **stay mounted even when there are
real matches** — only its `children` toggle to `null`. That constraint exists
for consistent screen-reader announcements (`aria-live="polite"` on a node
that never unmounts) and for a second, sharper reason: without it in the
tree, Escape on a query that matches nothing bubbles past the popup and
closes whatever it's nested in (a Sheet, a Dialog) instead of just the popup
— see `combobox/root/AriaCombobox.js`'s `escape-key` handling.

The trap: styling that root element with plain padding (`py-6`) applies
whether or not it has content. With real matches, `children` is `null` but
the div still renders at full padded height with nothing inside — a blank
~48px band sitting above every non-empty result list. **`empty:hidden`**
(Tailwind's `:empty` CSS pseudo-class — zero child nodes) is what collapses
it exactly when `children` is `null`, without ever unmounting the element
itself. Both wrappers carry this class; any new consumer of either primitive
inherits the fix for free, but a bespoke one built from the raw Base UI parts
would need to add it by hand.

## 3. The "create new" sentinel

Neither primitive has a built-in "the query matched nothing, offer to create
it" affordance, and this codebase wants that in three places now: `#label`
mentions (`mention-menu.tsx`'s `onNoMatch`, see `docs/AT-MENTION.md` §3a),
`LocationField`'s "Save as a place," and `LabelPicker`'s "Create label." The
shared trick, one Base UI `Item` shy of a real list entry:

```ts
const CREATE_SENTINEL = { kind: "create" } as const; // or a factory closing over the query
type Entry = RealItem | typeof CREATE_SENTINEL;
const isCreateEntry = (e: Entry): e is typeof CREATE_SENTINEL => "kind" in e && e.kind === "create";
```

Appended to the filtered `items` array only when the query is non-empty and
matches nothing — a real `Autocomplete.Item`/`Combobox.Item` with `value={sentinel}`,
so it stays keyboard-reachable (↓↓ Enter) exactly like every other row, rather
than a sibling node needing a separate keydown branch.

**`LabelPicker` closes over the query per-render (`createSentinel(name)`)
rather than reading a shared `query` state variable at pick time.**
`onValueChange` and `onInputValueChange` both fire out of the same click, and
by the time the former runs it is not guaranteed the query state a closure
captured is still the value that was on screen when the item was rendered —
baking the name into the entry itself removes that race entirely, since
`items` is recomputed fresh every render from the *current* query.

**Exact-match suppression is shared, too:** none of the three offers to
create something that already exists under that name, case-insensitively —
typing `#urgent` when "Urgent" exists shows "Urgent" in the results but no
create row. Checked against every label, not just the ones offered (i.e. not
just the unapplied ones) — creating a second "Urgent" because the first is
already applied would be a confusing way to fail.

## 4. Testing these

Neither has an established test file to copy verbatim before `LabelPicker`'s
— `location-field.tsx` has none. `label-picker.test.tsx` and
`list-field.test.tsx` (a Base UI `Select`, same underlying interaction
model) are the templates now. Three gotchas, all Base UI–specific rather than
these components':

- **`fireEvent.change` never opens the popup.** `ComboboxInput`'s (shared by
  both `Autocomplete` and `Combobox` — `Autocomplete` wraps `Combobox`
  internally) `onChange` reads `event.nativeEvent.inputType` to tell real
  typing apart from an autofill; `fireEvent.change` dispatches a plain
  `Event`, which has no `inputType`, so the popup silently never opens.
  `fireEvent.input(el, { target: { value }, inputType: "insertText" })`
  constructs a real `InputEvent` (testing-library's event map maps `"input"`
  to `InputEvent`, `"change"` to plain `Event`) and works.
- **A bare `fireEvent.click()` on an item is ignored.** Base UI distinguishes
  a real mouse interaction (`pointerdown` originating on the item, then
  `click`) from a synthetic/assistive-tech click. `fireEvent.pointerDown(el,
  { pointerType: "mouse" })` immediately before `fireEvent.click(el)` is
  required for a selection to commit — this is the same requirement
  `list-field.test.tsx` already documented for `Select`.
- **`openOnInputClick` did not open the popup under `fireEvent.click` or
  `fireEvent.pointerDown` + `fireEvent.click` in `happy-dom`**, unlike a real
  browser. Untraced further since typing a real query (via `fireEvent.input`
  above) is a fine substitute for what a test needs to prove — filter instead
  of relying on the click-to-browse-everything path.

## 5. Where each is wired

| Field | File | Items | Free text allowed | Multi |
|---|---|---|---|---|
| Location | `location-field.tsx` | `places: Place[]` | yes — any address, not just saved ones | no |
| Labels | `label-picker.tsx` | `labels: LabelRecord[]` minus `todo.labelIds` | no — every entry is a real (or about-to-be-created) label | yes, via `Combobox.Chip` |

`LabelPicker` is used only in `todo-sheet.tsx`. It does not attempt to also
support inline `#label` creation-while-typing-a-title — that is a separate,
already-shipped mechanism (`docs/AT-MENTION.md`) with its own accumulate/chip
state (`mentionedLabels` in `board-column.tsx`/`command-palette.tsx`, or an
immediate `onToggleLabel` write in the sheet's own title field). The two
never appear in the same input.
