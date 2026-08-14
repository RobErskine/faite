# Reminder presets

**Named times, picked instead of typed.** Reminders shipped in EI-88 as a
bare `<input type="time">` in the todo sheet, gated behind `scheduledDate` —
every reminder was a clock time typed from scratch. EI-106 adds **reminder
presets**: named times ("In the morning", "Lunchtime") you pick, type past
("gym 9:30am" in quick-add), or fall back to a plain custom time whenever a
preset doesn't fit. Custom times never go away — presets are the fast path,
not a requirement.

Five phases, EI-107 through EI-110 and EI-113, each independently shippable
after EI-107:

| Phase | What it built |
|---|---|
| EI-107 | `reminderPreset` — the 10th sync kind — and the pure core (`lib/reminder-presets.ts`) |
| EI-108 | `ReminderPicker` — the typeahead in the todo sheet, replacing the raw time input |
| EI-109 | Settings → Reminders (preset manager) + the first-run seed of five defaults |
| EI-110 | Quick-add and the ⌘K palette learn preset names as vocabulary |
| EI-113 | The card badge, this doc, and end-to-end coverage |

---

## 1. The data model

`reminderPresetSchema` (`src/lib/schema.ts`) mirrors `labelSchema` —
syncable fields, `decorationSchema` (color/emoji/iconUrl), `name`, `position`
— plus one field of its own:

```ts
time: z.string().regex(/^\d{2}:\d{2}$/),  // "HH:MM", same convention as Todo.reminderTime
```

A first-class synced entity, **not** a JSON column on `settings`. `settings`
is flat by design so each edit is its own outbox entry (`store/mutate.ts`);
a JSON array of presets would clobber across devices on concurrent edits.
Labels already proved the entity path end to end — this is the same shape,
the same repository pattern (`createReminderPreset`/`updateReminderPreset`/
`deleteReminderPreset` in `store/repositories.ts`), the same
`useReminderPresets()` hook.

### Decision 1 — todos bind to a preset BY VALUE, never by reference

`Todo.reminderTime` stores the literal `"HH:MM"` a preset resolved to.
There is no `reminderPresetId`. Picking *Lunchtime* writes `12:30`; nothing
on the todo remembers which preset produced it.

**Consequence:** retiming a preset relabels every reminder currently sitting
on the old time — it does not move them. Retime *Lunchtime* from 12:30 to
13:00, and a todo still reminding at 12:30 keeps firing at 12:30, just
displayed as a plain `12:30 PM` instead of `🥪 Lunchtime` from then on
(`reminderLabelFor` no longer finds a match). This is the safer failure: a
stored reference would silently reschedule every already-set reminder the
moment someone edits a preset, and would cost a `todos` column, a migration,
and a resolution step inside the 30-second poll (`use-reminders.ts`) that a
literal value never needs.

**Consequence 2:** deleting a preset touches no todo at all —
`deleteReminderPreset` is `remove("reminderPreset", id)` and nothing more,
deliberately unlike `deleteLabel`, which strips the id from every
`labelIds` array. There is no reference to clean up. The reminder survives
the preset and renders as a plain clock time.

### The seed — five defaults, once, ever

`seedReminderPresetsIfNeeded()` (`store/repositories.ts`) writes:

| Name | Time | Emoji |
|---|---|---|
| Morning | 08:00 | 🌅 |
| Lunchtime | 12:30 | 🥪 |
| Afternoon | 15:00 | ☕ |
| End of day | 17:00 | 🌇 |
| Evening | 20:00 | 🌙 |

Guarded by `settings.reminderPresetsSeeded`, **not** an empty-`reminderPresets`
check — an empty-table check would resurrect the five defaults the instant a
user deliberately deletes all of them (decision 6 in the original design).
Deterministic ids (`seed:reminderpreset:<slug>`), same convention as
`seedIfEmpty`'s lists, so two devices independently reaching "not yet seeded"
before their first sync converge on the same five rows rather than creating
ten.

**Not folded into `seedIfEmpty()`.** That function only fires for a
genuinely empty database (`lists.count() === 0`) — a fresh install. An
account that existed before EI-106 shipped already has lists, so it would
never reach a preset seed living there. `seedReminderPresetsIfNeeded()` runs
on every boot instead, exactly like `ensureDefaultTab()`, wired into the same
`useBootstrap()` chain (`store/hooks.ts`).

---

## 2. The pure core — `src/lib/reminder-presets.ts`

Two functions, no store access, no React:

- **`reminderLabelFor(time, presets)`** — the single source of reminder
  display text. A preset whose `time` matches renders `"🌅 Morning"`
  (emoji + name, or bare name with no emoji); no match falls back to
  `formatReminderTime(time)`, a plain `"9:30 AM"`. Used by the picker's
  placeholder, the card badge, and nowhere else needs to know how to render
  a reminder.
- **`parsePresetQuery(query, presets)`** — the picker's row logic, a
  discriminated union:

  | Typed | Result | What the picker offers |
  |---|---|---|
  | *(empty)* | `{ kind: "match", presets }` | every preset |
  | `morn` | `{ kind: "match", presets: [...] }` | name-substring hits |
  | `9:30am`, `14:00` | `{ kind: "time", time }` | "Remind at 9:30 AM" — applies, creates nothing |
  | `gym 9:30am` | `{ kind: "create", name, time }` | "Create preset 'gym' at 9:30 AM" |
  | anything else | `{ kind: "none" }` | "No reminder presets match." |

`formatReminderTime` is a re-export of `quick-add.ts`'s `formatTimeLabel`,
and the `"9:30am"`/`"14:00"` grammar above is `quick-add.ts`'s exported
`matchTime` — one time tokenizer, reused, not reimplemented. (The reuse only
goes one direction: `quick-add.ts` cannot import back from
`reminder-presets.ts`, or the two modules would form an import cycle. Preset
chip labels are inlined in `quick-add.ts` for that reason — see §4.)

---

## 3. `ReminderPicker` — the todo sheet's typeahead

`src/components/board/reminder-picker.tsx` replaces the raw
`<input type="time">`. Built on `Combobox` (`ui/combobox.tsx`) in **single**
mode — the first single-select consumer of that primitive; `LabelPicker`
(`docs/PICKERS.md`) is `multiple`, with `Chips`/`Chip`/`ChipRemove` this
component doesn't use at all.

No chips means no persistent place to show "what's currently set" outside
the input, so the current value renders as the input's **placeholder**
(`reminderLabelFor(todo.reminderTime, presets)`) instead — the same
"current state as resting text" role `LabelPicker`'s own placeholder plays
("Type to add a label…" vs "Add a label…").

Owns no selection state beyond the in-progress query string —
`todo.reminderTime` is the single source of truth, read fresh on every
render, exactly like `LabelPicker` derives `appliedLabels` from
`todo.labelIds` rather than keeping its own copy.

Carries over `LabelPicker`'s non-negotiables (`docs/PICKERS.md` §2/§3):

- `filter={null}` — filtering happens in the `items` array (via
  `parsePresetQuery`), not Base UI's own filter.
- The create sentinel's `name`/`time` are baked in **at render time**, not
  read back from `query` state at pick time — `onValueChange` and
  `onInputValueChange` fire out of the same click, and a shared `query`
  closure risks racing whichever handler clears it first.
- `ComboboxEmpty` stays **always mounted**. Unmounting it lets Escape bubble
  past the popup and close the whole Sheet instead of just the dropdown.
- `empty:hidden` on that wrapper, or a non-empty result list gets a blank
  ~48px band above it.

Still gated behind `todo.scheduledDate` (EI-106 decision 5, unchanged from
EI-88) — a preset is a time of *day*; with no date there is nothing for
`zonedInstant` (`lib/zoned.ts`) to resolve against.

---

## 4. Vocabulary — quick-add and the ⌘K palette

`parseQuickAdd(input, today, presets = [])` takes an optional third
argument (EI-106 P4). The trailing-word scanner (see the file's own header
comment on the two-pass left/right scan) tries the numeric `matchTime` first,
unchanged; failing that, it tries `matchPresetTime` — a **case-insensitive,
word-bounded** match against preset names, the same "match against the
name's own words" model `parsePresetQuery`'s `"match"` branch uses for the
picker.

**Word-bounded, not a bare substring.** A first version of `matchPresetTime`
used `name.includes(word)`, and a code review before this shipped caught
what that actually does against the real seeded defaults: `"on"` matches
inside `"Afternoon"`, `"mo"` inside `"Morning"`, `"it"` inside `"Lunchtime"`
— so `"call mo"` silently became the title `"call"` with an 8am reminder
attached, no ambiguity to catch it because exactly one preset happened to
contain the substring. The fix requires a trailing word to equal, or be a
prefix of, one of the preset name's own space-separated words — `"morn"`
still resolves `"Morning"`, `"lunch"` still resolves `"Lunchtime"`, but
`"on"`/`"mo"`/`"it"` resolve nothing. `PRESET_WORD_MIN_LENGTH` (3) floors out
the shortest common words (`"at"`, `"in"`, `"on"`) before they ever reach the
name comparison. A whole real word that's also part of a multi-word preset
name — `"day"` matching `"End of day"` — still resolves; that's a defensible
match on an actual word in the name, not the original bug.

**An ambiguous word (matches more than one preset) resolves to nothing.**
Quick-add has no disambiguation UI mid-parse the way the picker's dropdown
does, so an ambiguous trailing word falls through to plain title text — the
same behaviour as any other token the scanner doesn't recognize. Note
`parsePresetQuery` (§2) is deliberately **not** word-bounded the same way —
it drives a dropdown the user chooses from, so a looser substring match
there is a feature (typing `"noon"` still surfaces `"Afternoon"`), not a
silent title-mangling risk the way it was in quick-add.

Threaded through every place `parseQuickAdd` is called — all optional,
defaulting to `[]`, so every pre-existing call site keeps working exactly as
before with no presets in scope:

| Call site | Presets come from |
|---|---|
| `use-board-actions.ts`'s `handleQuickAdd` (the actual write) | `data.reminderPresets` |
| `board-column.tsx`'s live preview chips (both desktop and phone boards) | `reminderPresets` prop, threaded from `desktop-board.tsx`/`phone-board.tsx` |
| `command-palette.tsx` — both "Create to-do…" and its own preview | `reminderPresets` prop |
| `todo-sheet.tsx`'s inline title quick-add (`commitTitle` + its preview chips) | `reminderPresets` prop |

---

## 5. The card badge

`TodoMetaBadges` (`board/todo-row-parts.tsx`) renders a `Bell`-icon badge
whenever `todo.reminderTime` is set, using `reminderLabelFor` — so a card
reads "🌅 Morning" when the time matches a preset, or a plain "3:45 PM" when
it doesn't. `reminderPresets` is an optional prop throughout the chain
(`TodoCard` → `TodoMetaBadges`, `OverdriveCard` → `TodoMetaBadges`,
`command-palette.tsx`'s result rows → `TodoMetaBadges`) — omitting it still
renders the badge, just always as a formatted clock time rather than a
preset label.

Threaded from `data.reminderPresets` at every `TodoCard`/`OverdriveCard`
render site: `board-column.tsx` (all eight `<BoardColumn>` mounts across
`desktop-board.tsx`/`phone-board.tsx`, including the two Overflow columns
that have no quick-add row at all — cards still render there and still
deserve the badge), `day-sheet.tsx`'s timeline, and `overdrive-overlay.tsx`.

---

## 6. What's still deferred, and why

Both tracked as their own tickets rather than folded in here — see
`docs/SCHEMA-CHANGES.md` on why "while it's easy" is not a reason to build
something nobody asked for yet:

- **Relative offsets** ("30 min before") — nothing to be relative *to*.
  Todos have a date, not an event time; this needs a schema change of its
  own before the feature even makes sense.
- **A default preset per list or tab** — the first feature here that would
  set a reminder the user didn't explicitly ask for, and the first case
  that would actually want a stored reference rather than a literal time
  (decision 1 would need re-examining, not just a field added).

Also not built: `color`/`iconUrl` on a preset carry no UI yet. The Zod shape
includes them (via `decorationSchema`) for free, matching every other
decorated entity, but only `emoji` has a field in Settings → Reminders. Wiring
`ColorPicker` (`ui/color-picker.tsx`) for preset chips is a small, contained
follow-up whenever tinted preset chips are worth building.

---

## 7. Verification

- **Unit** — `reminder-presets.test.ts` (pure core), `quick-add.test.ts`'s
  preset-vocabulary block, `repositories.test.ts`'s `seedReminderPresetsIfNeeded`
  block, `reminder-picker.test.tsx`, `reminders-section.test.tsx`,
  `todo-card.test.tsx`'s reminder-badge block.
- **Schema** — `npm run schema:check`, expects migration id 11
  (`add-reminder-presets`).
- **E2E** — `e2e/reminders.spec.ts`, every project: fresh-boot seeding
  visible in Settings, picking a preset (placeholder + card badge, reopened
  through search rather than hunted for in a day column — `PhoneBoard`
  shows one day at a time), quick-add resolving a preset name, clearing a
  reminder.
- **Manual smoke** — fresh profile shows five seeded presets in
  Settings → Reminders. Todo sheet → set a date → Reminder field → type
  `morn` → pick *Morning* → card badge reads "🌅 Morning". Type `gym 9:30am`
  → creates and applies in one keystroke flow. Retime *Lunchtime* in
  Settings → an existing 12:30 reminder keeps firing at 12:30 and relabels
  to plain `12:30 PM`. Delete a preset → todos using its time are
  unaffected. ⌘Z undoes a reminder change like any other field write.
