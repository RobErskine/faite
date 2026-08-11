# Day sheet: timeline filter + notes editor — decisions log

**Self-contained handoff.** What shipped on `feat/day-details-sheet` in this
session, why each call was made, and the exact numbers behind the ones that
aren't obvious from the diff. Read this before touching the day sheet's
Timeline filter or the BlockNote-based Notes field again.

---

## 1. Timeline kind filter

The day sheet's Timeline section always rendered every event kind (`created`,
`scheduled`, `done`, `dropped`). Added a checkbox dropdown — same shape as the
board's `ViewSettings` status filter — to hide kinds you don't care about.

**`DayEventKind` now has one source of truth.** It was a bare TS union in
`day-timeline.ts`. Added `dayEventKindSchema` (zod enum) next to
`todoStatusSchema` in `src/lib/schema.ts`, and `day-timeline.ts` now does
`export type { DayEventKind }` from there instead of declaring its own.

**New setting: `visibleEventKinds`.** Defaults to all four kinds. Touches five
places — this is exactly the "a field is declared in four places, three more
derive from it" problem `docs/SCHEMA-CHANGES.md` warns about:
- `src/lib/schema.ts` — the zod field + default
- `src/lib/sync/wire.ts` — `SETTINGS_SYNCED_FIELDS` (it's an account
  preference, same bucket as `visibleStatuses`, not device-local)
- `src/server/db/user-schema.ts` — drizzle column, JSON-encoded text,
  `DEFAULT '["created","scheduled","done","dropped"]'`
- `src/server/sync/columns.ts` — added to `JSON_ENCODED_FIELDS` (hand-maintained
  list; the auto-derived `COLUMNS_BY_KIND` check doesn't catch this one)
- `src/server/db/migrations.ts` — migration **id 6**, `settings-add-visible-event-kinds`,
  `NOT NULL DEFAULT` matching the Zod default (`docs/SCHEMA-OPS.md`'s
  "prefer nullable, but a matched default is fine" case)

**Empty selection is allowed — deliberately unlike `ViewSettings`.** The board's
status filter refuses to uncheck the last status (an empty board looks
identical to a broken one). Here, unchecking every kind is fine: instead of a
blank list, `HiddenByFilterNotice` (`day-sheet.tsx`) renders "N entries/entry
hidden by the view filter · Show all" — either replacing the list entirely (all
hidden) or as a footer line under it (some hidden). One component for both
spots so the count and the reset action can't drift apart.

**Menu label "Assigned", row label "Assigned here" — not a typo, two different
strings on purpose.** The timeline row's `EVENT_LABEL` says "Assigned here"
because "here" refers to the day the sheet is open on. A dropdown checkbox item
has no such referent, so `KIND_FILTER_OPTIONS` labels the same kind "Assigned".

---

## 2. Sheet width: a pre-existing CSS specificity bug

Widening `DaySheet`/`TodoSheet` (`sm:max-w-md` → wider) appeared to do nothing
at first. Root cause, unrelated to anything we were changing: the base
`SheetContent` component (`src/components/ui/sheet.tsx`) sets
`data-[side=right]:w-3/4` and `data-[side=right]:sm:max-w-sm` — both gated on
an attribute selector, which beats a plain class in CSS specificity regardless
of source order. A plain `sm:max-w-md` override was **silently losing that
fight** — the sheets were rendering at the base component's 384px cap, not the
448px the code appeared to ask for. This bug predates this session.

**Fix: match the modifier chain.** Both sheets now use
`data-[side=right]:w-full data-[side=right]:sm:max-w-[75ch]`. Lesson for any
future `SheetContent` override: check what data-attribute-gated classes the
base component already sets, and match them — a plain utility class can't win
against one.

---

## 3. BlockNote notes field — sized and themed for a form field, not a page

`src/components/ui/markdown-field.tsx` wraps `@blocknote/shadcn`'s
`BlockNoteView`. BlockNote ships styled for a full document editor; every
override below exists to make it read as a compact field instead. All CSS
lives in `src/app/globals.css`, in the unlayered `.bn-field` block (BlockNote's
own stylesheet loads unlayered too, at runtime, so anything in
`@layer components` would lose to it regardless of source order).

- **Notes field height:** `min-h-[50vh]` on both sheets (was `min-h-32/-24`).
  No max-height was ever added — BlockNote has none by default, so the field
  already grows unbounded with content and the outer sheet just scrolls,
  pushing Timeline down. Verified live by typing 25 lines; no code change was
  needed for "let it grow," only for the floor.
- **Heading sizes:** BlockNote's default `--level` custom property is 3em/2em/1.3em
  for h1/h2/h3 (48px/32px/20.8px at a 16px base) — sized for a page, absurd in a
  field. Compressed to `1.25em/1.15em/1.08em/1em` (h1 through h4-6). This is a
  CSS-only override (`.bn-field [data-content-type="heading"]`); see §4 for the
  side effect that had.
- **Heading top padding:** BlockNote gives every heading `padding-top: 18px` on
  top of every block's own `padding: 3px 0` — every other block type only gets
  the 3px. Flattened to 3px so vertical rhythm is uniform regardless of block
  type.
- **Left gutter for the drag-handle/"+" menu:** BlockNote's hover menu anchors
  flush against the block's own left edge, sized for its own ~52px default
  padding. Our field's padding was much tighter, so the menu rendered up to
  42px **outside the field's own border** on hover. Fixed two ways together:
  the menu itself is scaled down (`.bn-side-menu { transform: scale(0.75);
  transform-origin: right center; }`, right-anchored so it doesn't drift off
  the block edge as it shrinks), and `.bn-editor`'s `padding-left` is set to
  just enough (2.5rem) to contain the now-smaller menu — recalculate this pair
  together if either value changes; they're coupled.

---

## 4. Heading grab-handle misalignment — the interesting bug

**Symptom** (reported with a screenshot): hovering a heading showed the
drag-handle/"+" menu aligned with the block *below* the heading, not the
heading itself.

**Root cause, found by reading BlockNote's source (not guessable from
CSS alone):** `@blocknote/react`'s `SideMenuController` vertically centers the
menu on a block via a **hardcoded per-heading-level pixel offset** —
`getBlockOffset()` in `node_modules/@blocknote/react/src/components/SideMenu/SideMenuController.tsx`
returns `39` / `27` / `18.5` for h1/h2/h3, "ported from the per-block-type CSS
height rules" of BlockNote's own **default** (large) heading sizes. It is a
constant baked into their JS, computed once from *their* metrics — not measured
live from the DOM, and not aware that §3 shrank our headings to a fraction of
that size. The constant overshot by roughly one block's height, which is
exactly "menu next to the wrong block."

**Fix: don't fight their constant, replace the whole middleware with a live
measurement.** `BlockNoteView` accepts `sideMenu={false}` to disable the
default `<SideMenuController>`, and you can mount your own as a child — this is
supported, documented API, not a hack. `markdown-editor.tsx` now does exactly
that, with a `floating-ui` `offset()` middleware computed from the **actual**
reference/floating rects at position time:

```ts
offset(({ rects }) => ({
  crossAxis: (rects.reference.height - rects.floating.height) / 2,
}))
```

This is the same formula their own code comment describes
(`(first line height - menu height) / 2`) — just evaluated live instead of
hardcoded per level, so it self-corrects if heading sizes ever change again.
Verified against h1/h2/h3 and a plain paragraph: vertical center offset ≤ 0.2px
in every case (measured via `getBoundingClientRect()` in a live browser, not
inferred).

**New direct dependency: `@floating-ui/react`.** It was already installed
transitively (via `@blocknote/react`), but we now import `offset` from it
directly in application code, so it's declared in `package.json` rather than
relied on as a phantom dependency.

---

## Files touched, if you need the full list

Client: `src/lib/schema.ts`, `src/lib/day-timeline.ts`, `src/lib/sync/wire.ts`,
`src/components/board/day-sheet.tsx`, `src/components/board/todo-sheet.tsx`,
`src/components/board/board.tsx`, `src/components/ui/markdown-editor.tsx`,
`src/app/globals.css`.

Server: `src/server/db/user-schema.ts`, `src/server/db/migrations.ts`,
`src/server/sync/columns.ts`.

Deps: `package.json`/`package-lock.json` (`@floating-ui/react`).

Tests: `src/components/board/day-sheet.test.tsx` gained a full "kind filter"
describe block; four other test files needed a one-line fixture update for the
new required `visibleEventKinds` field on `Settings`.
