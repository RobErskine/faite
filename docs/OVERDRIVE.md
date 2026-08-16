# Overdrive

**The user-facing name for the way out of Overflow.** The Faite Loop
(`docs/FAITE-LOOP.md`) delivers missed to-dos into Overflow, but delivering
them there was never the point — the point is a verdict. Overdrive is a
one-card-at-a-time overlay that turns a pile of stale to-dos into a
keyboard-driven (or thumb-driven) burn-down: won't do, done, back to a list,
or scheduled forward. It renders as a centred dialog with the board live
behind it — see §9 for why, and for the short-viewport fallback. Ticket:
EI-97.

Nothing about the loop itself changes here. Overdrive writes only through the
same repository functions every other surface uses (`setTodoStatus`,
`moveTodoToList`, `scheduleTodo`); Overflow stays derived, never stored
(`docs/ARCHITECTURE.md` §2.2). No schema change, no migration, no new sync
field.

---

## 1. Entry

`OverdriveButton` (`components/board/overdrive-button.tsx`) is passed as the
Overflow column's `footer` slot (`BoardColumn`'s `footer` prop, mirroring its
existing `actions` header slot) from both `desktop-board.tsx` and
`phone-board.tsx`. It renders nothing until the column reaches
`OVERDRIVE_MIN_TODOS` (`lib/overdrive.ts`, currently **5**). The count is
`board.overflow.todos.length`, the **unfiltered** total — the same
convention the in-column filter already uses for its own reveal threshold
(`FILTER_MIN_TODOS`, `board-column.tsx`), so narrowing the column with a
search string can never hide the button on a pile that's still there.

> **A constant, not a setting, for now.** A user-adjustable threshold is a
> deliberate follow-up (EI-103), not an oversight — v1 needed one number that
> works reasonably for everyone before it's worth building UI to change it
> per-user. It lives in `lib/overdrive.ts`'s tunables block specifically so
> that follow-up is a small change: one constant becomes one read of a
> settings field, nothing structural.

Also reachable from ⌘K — see `docs/COMMAND-PALETTE.md`.

**Floats, stuck to the column's bottom edge — round 4.** `BoardColumn`
wraps the `footer` slot in `sticky bottom-0` (`board-column.tsx`), not a
separate layout region: a `pinned` column's own `<section>` (Overflow's
`overflow-y-auto`, see `desktop-board.tsx`'s comment on why it's `sticky`-
positioned rather than truly `fixed`) IS the scrolling container the button
lives in, so pinning it against that box is exactly what keeps it in view
as the card list scrolls underneath it, with no coordination needed with
anything outside this component. Originally it just sat after the last
card, in normal flow — scroll far enough down a real pile and the one way
out of it was the thing that had scrolled out of view; live use called this
out directly.

## 2. The queue

`buildQueue()`/`createSession()` (`lib/overdrive.ts`) snapshot
`board.overflow.todos` — **in board order**, the same flattened list-group
order Overflow already renders — into a plain array of ids, once, at the
moment the overlay opens. This is deliberate: `useLiveQuery` re-renders on
every write, and a queue that re-sorted itself after each verdict would
reshuffle under the user's hands mid-session. Entering Overdrive should feel
like walking the pile you were just looking at.

The **current card's data** stays live, though — `OverdriveOverlayContent`
looks its id up in `todosById` on every render, so a concurrent edit (a label
added from another device, say) is always what's shown, and undo always
reverses the todo's actual current fields rather than a stale snapshot.

A card that vanishes mid-session (deleted elsewhere, synced away) is skipped
silently — there's nothing left to write a verdict against.

### 2a. Fresh state on every open, via unmount rather than reset

`OverdriveOverlay` (`overdrive-overlay.tsx`) is a thin gate: while `open` is
false it renders `null`; the moment it's true it mounts a whole separate
`OverdriveOverlayContent`, which is where `session`, `transitioning`, and
every other piece of state actually live.

That split — rather than always mounting `OverdriveOverlayContent` and
toggling a `hidden` class on it — is what makes "frozen at open" (above)
true for free. `createSession(todos)` runs as `useState`'s lazy initializer,
which only ever runs once **per mount**. Closing Overdrive unmounts
`OverdriveOverlayContent` entirely, and React discards every hook's state
along with it — `session`, `transitioning`, `pickerOpen`, all of it. Opening
it again is a genuinely fresh mount, with a fresh `useState` call building a
new snapshot from whatever `board.overflow.todos` looks like *now*. There is
no explicit "reset the session" code path anywhere to get wrong or forget —
the reset is just what mounting already does. `TodoSheet`'s `key={todo.id}`
plays the identical trick for the identical reason, just keyed on identity
rather than presence.

## 3. The verdicts

| Key | Button | Commits | Write |
| --- | --- | --- | --- |
| `←` | Won't do | immediately **if nothing is staged** — see §3a | `setTodoStatus(id, "dropped")` |
| `↑` | Done | immediately | `setTodoStatus(id, "done")` |
| `↓` | Back to *its own list* | immediately | `moveTodoToList(id, todo.listId ?? backlogId)` |
| `⇧↓` | — | immediately | `moveTodoToList(id, backlogId)`, forced |
| `→` | Schedule | **stages only** | — |
| `⇧→` | — | **stages only**, by a week | — |
| `D` / 📅 button | — | **stages only** | — |
| `Enter` / Confirm | — | only if staged | `scheduleTodo(id, date, todo.scheduledDate)` |
| `⌫` / `⌘Z` / `Ctrl+Z` | the toast's Undo | reverses the previous verdict | replays its `pushUndo` entry |
| `Esc` | — | clears a stage, or exits if nothing is staged | — |

`↓` targets the todo's **own** list, not Backlog — the button names it
("Back to Brain Dump") so it's never a guess. `⇧↓` is the escape hatch when
Backlog really is where it belongs. A todo with no list already falls back to
Backlog on `↓` with no shift needed.

Every write goes through one call site, `handleOverdriveVerdict`
(`use-board-actions.ts`), which `materializeIfNeeded`s the todo first (a
forced-into-Overflow recurring occurrence may have no row yet —
`recurrence-expand.ts`), then `pushUndo`s **before** awaiting the write —
same ordering convention `handleToggle` uses, so the undo entry (and the
label + id the toast and `⌫`/`⌘Z` need) exists synchronously.

### 3a. `←` is stage-aware — round 2

Originally `←` committed won't-do unconditionally, staged or not. Live use
surfaced the failure mode: ramp forward with `→ →`, overshoot, hit `←` out
of habit expecting "go back one day" — and the card was gone instead,
discarded along with the stage. `reduce()`'s `"wontDo"` case (`lib/
overdrive.ts`) is now symmetric with how `"ramp"` stages forward:

- A picked date staged → `←` clears the pick.
- A ramp offset staged (`> 0`) → `←` decrements it by one.
- A ramp offset of exactly `0` ("Today") staged → `←` clears the stage
  entirely, back to nothing staged — one more `←` past this point is what
  finally commits.
- Nothing staged → `←` commits won't-do, same as it always did.

**Shared by both the `←` key and the "Won't do" button** — a fat-fingered
click mid-stage carries the identical accidental-commit risk a stray
keypress does, so both go through the same `reduce()` case rather than
diverging by input method.

## 4. Why scheduling alone requires a confirm

Every other verdict is binary — there's nothing to get wrong by committing
instantly. Scheduling has a variable (which day), and a timer that commits
while you're still deciding writes the wrong one. So `→` only **stages** a
day; nothing is written until `Enter` or a click on **Confirm**. `←` `↑` `↓`
`Esc` all clear a stage rather than leaving it to rot — pressing any of them
mid-ramp is "never mind, do something else instead," not "confirm this by
accident."

The staged-day chip is the loudest thing on screen while it's up (a 2px
primary border, no dimming) precisely so a staged day never *reads* as
already committed — that confusion is the one failure mode this design
exists to avoid. The other three verdict buttons dim to `opacity-60` at the
same moment, for the same reason in reverse: while something is staged, they
are not the obvious next action.

> **Deferred, not rejected**: an opt-in auto-confirm delay once the ramp is
> muscle memory (EI-103). The commit path is already one call site, so
> adding a timer later is small — the constraint above is why it didn't ship
> in v1.

## 5. The ramp

`rampDate(offset, ctx)` (`lib/overdrive.ts`) walks forward from `ctx.today`
by chaining `rolloverTarget` — the exact primitive the Faite Loop itself
rolls a missed to-do forward with (`lib/scheduling.ts`). Offset `0` is
**always** `ctx.today`, never advanced by `workdaysOnly` — "today" means
today even on a Sunday. Offset `1` and up **skip non-eligible days** when
`workdaysOnly` is on, so ramping from a Friday lands on Monday, consistent
with how a real rollover would land.

`rampLabel(date, today)` names the near cases — `"Today"`, `"Tomorrow"` —
and falls back to `"Fri, Aug 15"` beyond that. `⇧→` jumps `WEEK_STEP` (7)
offsets at once. Ramping past `RAMP_MAX` (30) **clamps**, it does not wrap —
silently landing back on today after enough presses would be the worst
possible failure here, since nothing about the UI would tell you it happened.

## 6. The date picker does NOT skip non-eligible days

`D` (or clicking the calendar button) opens the same `Calendar`/`Popover`
pair `DateNav`'s "Jump to date" uses (`date-nav.tsx`). A picked date **stages
exactly like a ramp does** — same Confirm step, no special case — but,
unlike the arrow ramp, it is **not** snapped to an eligible day. An
explicitly chosen Saturday stays on Saturday, matching the rule
`docs/FAITE-LOOP.md` §2 documents for `rolloverTarget`: only an *automatic*
placement respects `workdaysOnly`; a deliberate human choice is never
second-guessed.

## 7. `⌫` / `⌘Z` — step back, not undo-everything

Pops the most recent `Decision`, replays its stored `pushUndo` entry via
`undoById` (id-based, not "undo the last thing" — `lib/undo.ts`'s own doc
comment on why that distinction matters once several toasts could be
stacked), and returns the queue to that card with nothing staged. Bounded by
the session itself: `⌫` on the first card, or with nothing yet decided, is a
no-op — step-back never reaches past the moment the overlay opened, and it
has no opinion about anything you did on the board before that.

**`⌘Z`/`Ctrl+Z` does the same thing, round 2** — bound locally in the
overlay's own `onKeyDown`, dispatching the identical `"stepBack"` action.
Needed because the board's *global* `⌘Z` (the `Hotkeys` registry,
`lib/keyboard.ts`) is correctly held off the whole time Overdrive is open —
`overdriveOpen` sits in `computeModalOpen` (`use-board-ui-state.ts`,
`board-guards.test.ts`) specifically so a board-wide undo can never fire
out from under a modal — so without a local binding, `⌘Z` would silently do
nothing while the overlay owned the keyboard.

## 7a. The persistent decision toast

Round 1 shipped silent — "ten toasts in fifteen seconds is noise." Using the
feature reversed that call: silence read as "did that actually register?"
rather than as calm.

**One toast, not one per decision.** Every commit calls `toast.success(
label, { id: OVERDRIVE_TOAST_ID, duration: Infinity, action: { label: "Undo",
onClick: … } })` in `overdrive-overlay.tsx` — a **stable, module-level id**,
so sonner replaces the existing toast in place rather than stacking a new
one. `duration: Infinity` stops it from auto-expiring; nothing removes it
except a fresh decision replacing it, or the overlay closing.

This was a deliberate simplification during planning: a growing stack of
one-toast-per-decision raises a real question — does undoing an *older*
toast further down the pile also reverse every decision made after it, to
keep the queue's position consistent? Sonner-stack UX makes that genuinely
hard to reason about for a case nobody would reach for on purpose. With
exactly one toast always showing the *most recent* decision, its Undo button
is simply identical to `⌫`/`⌘Z` — no cascade, no "which decision am I
undoing" ambiguity, because there is only ever one answer.

**Staying in sync.** `⌫`/`⌘Z`/the toast's own Undo all funnel through the
same `syncToast()` helper after they run: it re-reads whichever `Decision`
is now `session.decided.at(-1)` and either updates the toast to that
decision's `label`, or dismisses it outright once `decided` is empty. The
toast's `label` text is never recomputed independently — `Decision` (`lib/
overdrive.ts`) carries the exact string `handleOverdriveVerdict` built for
`pushUndo`, so the toast can never say something different from what undo
would actually reverse.

**A stale-closure trap worth knowing about if you touch this code**: the
toast's `onClick` is a plain callback, captured once by sonner at
`toast.success()` call time — sonner never re-creates it. Closing over
`dispatch` directly there would freeze the click on whichever `session` was
current in the render that fired the toast, forever, even after later
decisions produce a newer `dispatch` closing over a newer `session`.
`dispatchRef` (a `useRef`, reassigned via a plain effect after every render
— never during render itself, which the `react-hooks/refs` lint rule
enforces) is what lets the toast always reach the *current* `dispatch`
no matter how old the captured closure is.

**On overlay close**: a `useEffect` cleanup (empty deps, so it only runs on
unmount — exactly when the overlay closes, regardless of how) dismisses
`OVERDRIVE_TOAST_ID`.

## 8. Finishing

When the queue empties, the overlay shows a tally built by `summarize()`
(`lib/overdrive.ts`) from `session.decided` — "Cleared 10 — 4 won't do, 3
done, 2 scheduled, 1 back to lists." A **Done** button closes. `Enter` does
the same thing (round 4 feedback) — `handleKeyDown` special-cases it ahead
of the normal `ACTION_BY_KEY` table: `confirm` (Enter's usual action) is
always a no-op on this screen since there's no card and nothing staged to
confirm, so it was otherwise a dead key exactly where a keyboard user would
most expect Enter to work, forcing a reach for the mouse to leave. `⌫`/`⌘Z`
are deliberately NOT part of that special case — `reduce`'s `"stepBack"`
only looks at `session.decided`, not `isComplete`, so stepping back into the
last card from the finish screen already worked and still reaches the
ordinary key table.

Reaching the end is not the only way out: `Esc` with nothing staged exits at
any point, and whatever wasn't decided simply stays in Overflow — no nag, no
confirmation dialog. The whole thesis of the Faite Loop, and of Overdrive, is
that it's okay to stop.

## 8a. The flick — round 3

**A genuinely blocking transition, not a decorative overlay.** Rounds 1–2
tried a few variations on "show a departing echo of the card while the real
next one is already interactive underneath it" (a title-only echo, then a
full-card one) and none of them read right — live use kept calling the
result laggy or wonky no matter how the echo itself was tuned. The actual
problem was the model, not the numbers: an index card being flicked off a
stack doesn't coexist with the next card already being interactive
underneath it. So round 3 replaces the overlay entirely. When a verdict
commits:

1. The write and the toast happen **immediately** — `onVerdict` and
   `syncToast` run synchronously, same as always. There's no reason data
   integrity or feedback should wait on a flourish.
2. The **queue does not advance yet.** `applyDecision` computes the next
   `OverdriveSession` as a plain value, but `setSession` is deferred —
   `session` (and therefore `currentTodo`) still points at the card that
   was just decided.
3. `transitioning` is set to a snapshot of that outgoing card (`todo`,
   `list`, `index`, `total`, `direction`) and the ONE card slot in the JSX
   (`overdrive-overlay.tsx`) switches to rendering it with `animate-out` —
   the verdict button row goes `invisible` and every button `disabled` in
   the same render.
4. `dispatch()` refuses every action — `←↑↓→`, `Enter`, `⌫`, `⌘Z`, even `D`
   — for as long as `transitioning` is set. Nothing is interactive.
5. When the card's own **`animationend`** fires (`finishFlick`), `setSession`
   finally runs and `transitioning` clears. The SAME card slot now renders
   the (already-computed) next card, buttons re-enabled — this is "once the
   animation is done the next card can be interacted with," verbatim, and
   `animationend` is what makes it literally true rather than approximately
   so (see round 4, below).

Never two cards mounted at once, no `relative`/`absolute` positioning, no
`aria-hidden` clone to keep out of test locators — the entire round-2
apparatus this section used to describe is gone. One `<div>`, one
`OverdriveCard`, swapping between `animate-out` (mid-flick) and `animate-in`
(freshly current).

**The flick itself** is a real flick, not a slide: `slide-out-to-{left,
right,top,bottom}` at an arbitrary `150vw`/`150vh` (**not** the bare
utility's default 100%, and not a plain numeric suffix either — see below)
combined with a few degrees of rotation on the horizontal verdicts
(`spin-out-12`/`-spin-out-12`) — the way an actual index card twists when
flicked off a stack by hand. Vertical verdicts stay rotation-free; a card
tossed straight up or dropped down doesn't spin the way one flicked
sideways does. `ease-in` on exit (accelerating away), `ease-out` on the
next card's entrance (decelerating into place) — standard motion-design
convention for what's leaving versus what's arriving.

**Under `prefers-reduced-motion`, `transitioning` is never set at all** —
`prefersReducedMotion()` short-circuits `triggerFlick` straight to the
`advance()` callback. The alternative (still holding the block open for the
animation's full length, just with no visual) would trade a moving card for
a blank pause of the same length — worse, not more accessible. It also
means the `animationend` the flick normally waits on can't become a
liveness risk: where there's no animation, there's no wait either.

### Round 4a: the card never actually left the screen

"Make it more seamless… animate the cards farther, with more time" (round 4
feedback) turned out to have a real mechanical cause, not just a feel that
needed tuning up. `slide-out-to-*`'s bare form moves an element by **100% of
its own box**, not 100% of the screen — and the card sits centered with
room on either side of it. Do the arithmetic for a 576px-wide card centered
in an ~1129px dialog: translating left by its own width (576px) moves its
*right* edge only as far as where its *left* edge started — about a quarter
of the screen's width was **still on screen** at the animation's declared
end. So the "departed" card was, in fact, only ever partway gone, which
reads exactly like "still feels wonky" regardless of how duration or easing
get tuned. Distance was the actual bug; earlier rounds had been tuning the
wrong knob.

Fixed by moving off the bare/numeric-suffix utilities (both scaled to the
card's own box) onto an **arbitrary value** — `slide-out-to-left-[150vw]`,
`slide-out-to-top-[150vh]`, etc. — sized to the *viewport*, which guarantees
full clearance no matter the card's size or the screen's. Paired with a
longer animation (260ms → `duration-320`, and `duration-220` on the next
card's entrance) so the now-genuinely-farther travel has enough time to read
as a deliberate motion rather than a blur — distance without more time to
watch it cross the screen wouldn't have looked any different. Rotation went
from 10° to 12° to match.

### Round 4b: "sometimes it flies off, sometimes it moves 20px"

Even with the right distance, the flick was **inconsistent** run to run.
The cause was a synchronization bug, and it's worth recording how it was
found, because the symptom ("tune the animation") pointed away from it.

Instrumenting a real browser — recording, per flick, when the element was
inserted, when its CSS animation actually *started*, when it *ended*, and
how far it travelled — showed:

| | insert→animStart | animStart→animEnd | travel |
| --- | --- | --- | --- |
| before | **31–111ms** (varies) | never reached | **957–1945px** |
| after | 8–13ms | 309–316ms (full) | **exactly 150vw / 150vh** |

The flick used to end on a `setTimeout` started when `dispatch` ran. But a
CSS animation doesn't start when its element is inserted — it starts when
the browser next paints it, and sitting in between are the verdict's
IndexedDB write, the toast mounting, and the board's own `useLiveQuery`
re-render behind the overlay. That gap swung between 31ms and 111ms
depending on how much of that work landed first, so a fixed 340ms timer
handed the 320ms animation somewhere between 230ms and 310ms to run. The
animation was cut off **every single time**, at a different point each time.
Hence identical keypresses producing anywhere from 957px to 1945px of
travel — a 2× spread with no user-visible cause.

Fixed by ending the flick on the card's own **`animationend`**
(`finishFlick`, wired via `onAnimationEnd` on the flicking wrapper) rather
than a wall clock. `animationend` fires relative to the animation's own
start, so the two cannot drift apart by construction — the measurements
above show travel collapsing to exactly one value per axis afterwards.
Three details make it safe:

- **`FLICK_FALLBACK_MS` (1000ms) is kept purely as a safety net**, for the
  case where `animationend` never arrives at all (CSS failed to load, the
  tab is backgrounded) and the alternative is an overlay wedged forever. It
  is set well clear of the real animation plus any plausible start delay, so
  it never wins the race in normal operation. `finishFlick` is idempotent
  (`pendingAdvance` is nulled by whoever gets there first), so both firing
  is harmless. **It is also a hard ceiling on how long the block can ever be
  observed**, which matters to anything that stretches the animation to look
  at the mid-flick state: past 1s the safety net, not `animationend`, is
  what lifts the block. See §11 for the e2e test that has to live under it.
- **`e.target === e.currentTarget`** — `animationend` bubbles, so without
  this a future animation on anything *inside* the card would end the flick
  early.
- **`fill-mode-forwards`** holds the card at its final off-screen position
  in the gap between `animationend` firing and React unmounting it. The
  default `fill-mode: none` snaps it back to dead center at full opacity for
  those frames — a visible flash of the card you just decided reappearing.

`e2e/overdrive.spec.ts` regression-tests this directly by stretching
`.animate-out` via `addStyleTag` and asserting the block holds for the
animation's whole length: a clock-driven implementation would advance ~340ms
in regardless, so the test fails loudly if this ever regresses. The stretch
has to stay **under `FLICK_FALLBACK_MS`** to keep testing that — see §11.

### A real bug this surfaced: focus escaping the dialog

Building this exposed a genuine keyboard bug, not just a testing one. The
verdict buttons the user's focus naturally lands on (from a click, or from
Tab) get `disabled` and `invisible` the instant a flick starts — and a
browser force-blurs any element that becomes non-focusable. With nothing
re-claiming it, focus fell to `document.body`, a DOM **sibling** of the
dialog, not a descendant — so no keypress dispatched there ever reached
`onKeyDown` (which lives on the dialog popup) again. First press worked, every
press after it silently did nothing: a real keyboard user would hit this
identically, not just an e2e test with no mouse.

Fixed with a ref on the dialog popup (Base UI forwards one,
React 19's plain-prop `ref` needs no `forwardRef` wrapper) and an effect
that calls `.focus()` on it every time `transitioning` changes — both when a
flick starts (reclaiming focus the instant the button loses it) and when it
ends. The popup already carries `tabIndex={-1}`, the same "focusable on
request, never in the natural Tab order" contract Base UI itself uses to
auto-focus the dialog on open — this reuses exactly that.

## 8b. The decision toast's position

Sonner's `<Toaster>` (`app/layout.tsx`) sets no `position`, so every other
toast in the app renders at sonner's own default corner. The Overdrive
decision toast (§7a) overrides it per-call — `position: "bottom-center"` in
the `toast.success()` options — so it sits directly under the card and
button row it's reporting on, rather than in the ambient corner where an
unrelated toast (a "Seeded N to-dos" confirmation from Settings, say) might
also be sitting. Sonner renders both positions from the one `<Toaster>`
instance without conflict; nothing else in the app needed to change.

### A real bug this surfaced: the toast could eat a button's clicks

Chasing an unrelated e2e failure on `phone-iphone-landscape` (round 4)
turned up a second real bug, not just a flaky test: on a short landscape
phone, "directly under the card and button row" (the point of `bottom-
center`, above) isn't under it at all — it's ON it. Two compounding causes:

1. **The content column was silently taller than the dialog.** The flex
   item wrapping the card/staged-box/button-row (`overdrive-overlay.tsx`)
   had `flex-1` but no `min-h-0` — a flex item's default `min-height: auto`
   wins over `flex-1` the moment its own content is taller than the
   available box, which is exactly the classic "flex child won't shrink"
   trap. The popup is `position: fixed` with an explicit height, so it
   never grew to match — its child just quietly rendered past its bottom
   edge (`overflow: visible`, so nothing clipped it either), landing the
   button row wherever the browser's default "distribute overflow evenly
   around the centered box" behavior happened to put it, which on this
   viewport was squarely inside the toast's footprint.
2. **Even once genuinely constrained**, the button row and the toast are
   both anchored to the same physical bottom edge, and reserving room
   *after* the button row only helps if the box is actually clamped to the
   viewport in the first place — which needed fix #1 before it could do
   anything.

Fixed with `min-h-0` (makes the flex item respect the popup's real, fixed
height instead of growing to fit its own content) plus `overflow-y-auto` (so
a card that still doesn't fit scrolls internally rather than rendering
off-canvas), plus `pb-[calc(var(--safe-bottom)+6rem)]` on the same element —
extra trailing space reserving enough room below the button row that it
can't be scrolled into the toast's band.

Round 5 re-scoped that padding rather than removing it. It now applies to
the **full-bleed branch only** (`tall:py-8` overrides it once there's room
for the centred dialog, §9): the reservation is only needed where the
surface actually reaches the screen's bottom edge, which is exactly the
short viewports that still render full-bleed. This bug is also why the
dialog is gated on viewport *height* — shrinking Overdrive to a centred box
on a 343px-tall screen reintroduces the collision wholesale.

## 9. Where it renders, and why outside `DndContext`

Mounted once in `board.tsx`, next to `DaySheet`, **outside** the board's
`DndContext` — same reasoning as that sheet (see its own comment there):
`OverdriveCard` renders todo content but, unlike `TodoCard`, calls no
dnd-kit hook at all, so there's nothing for the context to protect either
way. Keeping it outside is just consistency with every other full-board
overlay, not a functional requirement here.

### A centred dialog, not a full-screen sheet — round 5

Overdrive shipped as a full-screen `Sheet`, on the theory that triage wants
maximum focus. Live use argued the opposite, and it's right: **the board is
the scoreboard.** Every verdict writes through the same repository functions
every other surface uses, and the board renders off `useLiveQuery` — so with
the board simply *visible*, the Overflow column drains and scheduled cards
land on their day columns in real time, for free, with no new wiring at all.
A full-screen sheet was covering the only view that shows the burn-down
actually happening. Verified live: deciding one card drops Overflow's count
in the rail behind the dialog on the same frame, and a `→ Enter` puts the
card on its day column while you watch.

The trade is deliberate — a little less isolation for a lot more context.
It stays **modal**: Base UI's focus trap still holds, and `overdriveOpen`
still feeds `computeModalOpen` (below), so the board behind is *visible, not
usable*. Nothing about the queue changes either; it's still frozen at open
(§2), so a live-updating board can't reshuffle the pile under you.

Built on `Dialog` (`ui/dialog.tsx`) rather than `Sheet`, with three
overrides worth knowing about:

- **`overlayClassName` drops the backdrop blur.** `DialogOverlay`'s default
  carries `supports-backdrop-filter:backdrop-blur-xs`, which would smear the
  exact thing this change exists to show. Overdrive passes
  `backdrop-blur-none` and a lighter scrim. That prop is a new escape hatch
  on `DialogContent`, mirroring the one `SheetContent` already had.
- **`overflow-hidden` clips the flick at the dialog's edge**, which is what
  forced `FLICK_CLASS`'s travel to become responsive (§8a) — the clipping
  box changed, so the unit had to. The date picker is unaffected:
  `PopoverContent` portals out (`ui/popover.tsx`).
- **`tall:` gates the whole thing on viewport height ≥40rem** (a custom
  variant, `globals.css`). Below that Overdrive keeps its full-bleed
  presentation verbatim. Height, not width and not `touch:`, because a
  landscape phone is 734px wide — past `sm`, so a width breakpoint reads it
  as a desktop — while being 343px tall, which is the dimension that leaves
  no room for a dialog AND the decision toast under it (§8b's collision,
  which shrinking the surface reintroduces exactly). An iPad, meanwhile, has
  no hover but plenty of height, so `touch:` would cramp it for nothing.
  Note `sm:max-w-none` in the full-bleed branch: `DialogContent`'s own base
  list ends in `sm:max-w-sm`, so a bare `max-w-none` loses to it on anything
  past 640px wide and the "full-bleed" surface silently renders 384px wide.

Escape is intercepted at the `Dialog`'s `onOpenChange` —
`eventDetails.reason === "escape-key"` calls `eventDetails.cancel()` and
hands the keypress to the same `reduce()` every other key goes through, so
Base UI's own close-on-Escape never fires ahead of "clear the stage first."
`showCloseButton={false}`: Esc and the finish screen's Done button are the
ways out, and a stray ✕ invites a click `reduce` never sees.

Arrow/Enter/Backspace/D handling is a **local `onKeyDown` on the dialog
popup**, not the global `Hotkeys` registry (`lib/keyboard.ts`) —
same precedent as `use-column-nav.ts`'s grid navigation. The registry's
guards (`allowWhenModalOpen`, etc.) exist for shortcuts meaningful from
anywhere; these are meaningless anywhere but here.

## 10. Touch

Every verdict button and the date-picker trigger carry `pointer-coarse:
min-h-11` — the same 44px WCAG/HIG floor `ui/button.tsx`'s own small sizes
already apply to themselves. The button row switches from a centered,
wrapping flex row (mouse) to a two-column grid (`touch:`, `@media (hover:
none)`, `globals.css`) — a wide row of five targets is not reachable
one-handed, and a grid anchored near the thumb is. The keyboard-only
`"Enter to confirm"` hint hides on `touch:` — it has nothing to say on a
device with no keyboard.

**Swipe gestures are deliberately out of scope for v1** (EI-104) — the
button layout should be lived with first; a swipe that fires the wrong
verdict on a stale to-do is a more annoying mistake than a mis-tap.

## 11. Testing and dev tooling

- `lib/overdrive.test.ts` — the whole decision core (`reduce`, `rampDate`,
  `rampLabel`, `stagedDate`, `applyDecision`, `summarize`), including the
  stage-aware `"wontDo"` case (§3a), with no DOM at all, per
  `docs/KEYBOARD.md` §9's own convention of testing the pure layer directly.
- `components/board/overdrive-overlay.test.tsx` — the DOM-touching half:
  every key, the staged-preview text, the date picker opening, step-back,
  the finish tally, `⌘Z`/`Ctrl+Z`, the persistent toast (fires once,
  replaces in place, its Undo matches `⌫`, dismissed on unmount), and the
  flick transition (§8a) — one describe block per direction, a test that
  every key and button is inert for the duration, the button row going
  `invisible`/`disabled` and back, a mid-flick click being a no-op, and the
  `prefers-reduced-motion` path never setting `transitioning` at all.

  Two helpers, matching the flick's two completion paths (§8a, round 4b).
  `endFlickByAnimation()` fires the `animationend` a real browser would, on
  the flicking wrapper itself — that's the path users actually get, and its
  own describe block covers it advancing the queue with no timer involved,
  ignoring an `animationend` bubbled up from a child, and `fill-mode-
  forwards` being present. `flushFlick()` (`vi.advanceTimersByTime(1100)`,
  under `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })`)
  drives the `FLICK_FALLBACK_MS` path instead — jsdom runs no CSS
  animations, so `animationend` never arrives on its own here and the
  fallback is what completes every other test's flick. Button state is
  checked via the raw `.disabled` property — this project's vitest setup has
  no jest-dom, so `toBeEnabled`/`toBeDisabled` aren't available. Note the
  `await
  import("./overdrive-overlay")` at the top rather than a static import —
  `vi.mock("sonner", …)` is hoisted above every static import in the file,
  so a static one would reach the component's own `import { toast } from
  "sonner"` before the mock's backing spies are assigned (same fix
  `developer-section.test.tsx` uses).
- `components/board/board-column.test.tsx` — the `footer` slot itself
  (renders, hidden while collapsed).
- `e2e/overdrive.spec.ts` — seeds through the real Settings → Developer →
  *Seed Overflow* button (never a private back door — see `lib/dev-seed.ts`
  below), then drives the whole flow twice: once by keyboard, once by
  tapping the on-screen buttons only, so the phone path is exercised for
  real rather than assumed to work because the keyboard path does. Since
  round 3 only ever mounts one card, `cardTitle()`/`progress()` scope to
  `.animate-in` mainly for symmetry with the mid-flick assertions, which
  locate the outgoing card via `.animate-out` directly.

  The dedicated flick test **stretches `.animate-out` to a 700ms animation**
  via `addStyleTag` before opening the overlay. Two reasons, both worth
  keeping: at its real ~320ms the mid-flick window is narrower than the
  sequential auto-retrying assertions it takes to check it, so the last one
  could legitimately land after the flick ended — a flaky test about correct
  behaviour. And it's the sharpest available regression test for round 4b:
  the flick ends on `animationend`, so a 700ms animation means a 700ms
  block, whereas the clock-driven implementation this replaced would advance
  ~340ms in no matter how long the animation ran.

  **Two constraints keep that test honest, and both were learned the hard
  way (EI-185 — it had been red on every project since the day it landed):**

  1. **The stretch must stay under `FLICK_FALLBACK_MS` (1000ms).** The
     safety net fires 1s after `dispatch` regardless of whether the
     animation is still running, so a 3s stretch — the original value — did
     not buy a 3s block, it bought a 1s one, ended by the timer rather than
     by `animationend`. The test was then no longer covering the path it
     claimed to. 700ms leaves ~300ms of headroom over the animation's
     measured 8–13ms start delay.
  2. **Mid-flick button assertions need `includeHidden: true`.** The verdict
     row is `invisible` as well as `disabled` while a flick runs (§8a), and
     `visibility: hidden` is one of ARIA's tree-exclusion rules — so a plain
     `getByRole("button", …)` matches *nothing* for the entire flick, then
     matches the re-enabled button the instant the flick ends and reports
     `expected disabled, received enabled`. What made this so slow to spot
     is that it went green sometimes: `ui/button.tsx` carries
     `transition-all`, a CSS visibility transition holds the old `visible`
     value for its whole duration, so the button stayed ARIA-visible (and
     already `disabled`) for the first ~150ms of every flick. The test was
     really racing that 150ms sliver, not the animation — it won on a fast
     desktop run and lost everywhere else. `overdrive-overlay.test.tsx`
     asserts the same contract and never saw it, because jsdom loads no
     stylesheet: there, `.invisible` is a class name with no computed
     `visibility` behind it.

**`lib/dev-seed.ts`'s `seedOverflow(count)`** creates `count` open to-dos
backdated past the current `overflowAfterDays` threshold, spread across
whichever lists already exist, with some descriptions/deadlines/labels mixed
in so a seeded pile looks like a real one rather than ten identical rows.
Wired to a button + count stepper in Settings → Developer
(`developer-section.tsx`), `isLocalDev()`-gated at the section level like
the existing *Reset board* — never reaches a real user. Built entirely on
`createTodo`, so a seeded row is indistinguishable from a hand-typed one and
syncs like anything else.

## 12. Key files

| File | Role |
| --- | --- |
| `lib/overdrive.ts` | the pure decision core — `reduce`, `rampDate`, `stagedDate`, `applyDecision`, `summarize`, the tunables block |
| `lib/dev-seed.ts` | `seedOverflow()` — the dev-only Overflow-pile generator |
| `components/board/overdrive-button.tsx` | the Overflow column's entry point |
| `components/board/overdrive-overlay.tsx` | the Dialog, the keydown handler, the date picker, the finish screen, the persistent toast, the blocking flick transition |
| `components/board/overdrive-card.tsx` | the presentational card — progress readout, title, description, list/scheduled line, `TodoMetaBadges` (labels + `In Overflow N days`). No drag source, no checkbox, no nav stop — the whole reason it's not a reuse of `TodoCard` |
| `components/board/use-board-actions.ts` | `handleOverdriveVerdict` — the one write path, returns `{ undoId, label }` |
| `components/board/use-board-ui-state.ts` | `overdriveOpen` + `computeModalOpen` |
| `components/board/board-guards.test.ts` | the table-driven test that keeps a future overlay from forgetting the guard wiring above |

Tests: `overdrive.test.ts`, `overdrive-overlay.test.tsx`, `board-column.test.tsx`
("footer" block), `board-guards.test.ts`, `developer-section.test.tsx`
("Seed Overflow" block), `e2e/overdrive.spec.ts`.
