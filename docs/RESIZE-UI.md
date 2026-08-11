# Resizable board split

**Self-contained handoff.** Everything needed to work on the vertical split
between the calendar and planning halves without re-reading the rest of the
codebase. This is the sibling feature to the rail resize (Overflow/Backlog,
`docs/DRAG-AND-DROP.md` §4.12) — same shape, rotated 90°, and worth reading
that section first since this one repeats none of its reasoning.

---

## 1. What this is (30 seconds)

The board is two horizontal halves — calendar on top, planning (lists) on the
bottom — split at a fixed ratio. This feature makes the seam between them
draggable:

- **Drag the seam** to resize either half, with a floor on both sides.
- **Drag past the floor** and the half you're shrinking snaps to a collapsed
  40px strip instead of clamping — same VS Code gesture the rails already use.
- **Only one half can be collapsed at a time** — collapsing one always leaves
  the other filling the screen.
- **Using `DateNav`** (Week/Month/Quarter/Today/date picker) while the
  calendar is collapsed re-expands it and completes the jump in one gesture,
  rather than requiring a separate click first.
- The split ratio and collapse state **sync across devices** — the one place
  this feature deliberately diverges from the rails, which are device-local.

Shipped complete: `a299e8e` on `main`, deployed to `myfaite.app`.

---

## 2. Files that matter

| File | Role |
|---|---|
| `src/lib/split.ts` | `SPLIT_DEFAULT`/`SPLIT_MIN`/`SPLIT_COLLAPSE_THRESHOLD`/etc. — mirrors `lib/rail.ts`, in `lib/` so `schema.ts` can bound the stored percent without importing a component |
| `src/components/board/use-split-resize.ts` | Pure percent math (`clampSplit`, `resolveDragSplit`, `nudgeSplit`) plus the pointer/keyboard hook — mirrors `use-rail-resize.ts` |
| `src/components/board/use-split-resize.test.ts` | Unit tests for the pure math, mirrors `use-rail-resize.test.ts` |
| `src/components/board/split-handle.tsx` | The draggable horizontal seam between the two halves |
| `src/components/board/split-strip.tsx` | The 40px collapsed-half strip — label, count, click/Enter to expand |
| `src/components/board/board.tsx` | Wires everything into the two halves; `showCalendar` + the wrapped `jumpBy`/`jumpToIndex`/`jumpToToday` |
| `src/components/board/use-day-track.ts` | `trackReady` option — lets a jump requested while the calendar is collapsed park and get served once it re-expands |
| `src/app/globals.css` | `--split-top` — percent of the split the calendar half gets |
| `src/lib/schema.ts` | `splitRatio`/`splitCollapsed` fields |
| `src/server/db/user-schema.ts`, `src/server/db/migrations.ts` | Drizzle column defs + migration 4 (`settings-add-split-layout`) |
| `src/lib/sync/wire.ts` | `SETTINGS_SYNCED_FIELDS` — both fields included, unlike the rail fields |

---

## 3. How it works

### 3.1 The math is a percent of two measured heights, not a pixel width

The rails measure one thing (a panel's own width) and clamp it. The split
measures **two** things — `calendarHalfRef` and `planningHalfRef`'s rendered
heights — because a half's size only means anything relative to the other
half's, and that total changes with the viewport. `clampSplit(topPx, totalPx)`
converts a pixel height to a percent, floored and ceilinged so neither half
can go below `SPLIT_MIN` (200px):

```ts
export function clampSplit(topPx: number, totalPx: number): number {
  if (totalPx < SPLIT_MIN * 2) return SPLIT_DEFAULT;   // degenerate viewport
  const minPercent = Math.max(SPLIT_MIN_PERCENT, (SPLIT_MIN / totalPx) * 100);
  const maxPercent = Math.min(SPLIT_MAX_PERCENT, 100 - (SPLIT_MIN / totalPx) * 100);
  const rawPercent = (topPx / totalPx) * 100;
  return Math.min(Math.max(rawPercent, minPercent), maxPercent);
}
```

The degenerate case (a window too short to fit both floors) falls back to
`SPLIT_DEFAULT` rather than producing a nonsense percent — there's no valid
split to express, so pretending there is one would be worse than picking the
default.

`resolveDragSplit(startTopPx, dy, totalPx)` is `resolveDragWidth`'s twin, but
returns which half to collapse rather than just `null`:

```ts
export function resolveDragSplit(startTopPx, dy, totalPx): number | "calendar" | "planning" {
  const rawTop = startTopPx + dy;
  const rawBottom = totalPx - rawTop;
  if (rawTop < SPLIT_COLLAPSE_THRESHOLD) return "calendar";
  if (rawBottom < SPLIT_COLLAPSE_THRESHOLD) return "planning";
  return clampSplit(rawTop, totalPx);
}
```

Both thresholds are checked on every drag — there's no way to be dragging
"only the top" or "only the bottom"; shrinking one half is growing the other,
so the check has to cover both directions from one `dy`.

### 3.2 The drag hook — same shape as the rails, one axis over

`useSplitResize` (`use-split-resize.ts`) is structurally identical to
`useRailResize`:

- `dragRef` holds per-frame state (`startY`, `startTopPx`, `totalPx`, `result`)
  outside React, so a drag doesn't re-render on every pixel of movement.
- `onPointerDown` measures both halves and snapshots the total.
- `onPointerMove` writes the live percent straight to the container's
  `--split-top` custom property via `style.setProperty`, not React state.
  Past either collapse threshold, the write freezes at the clamped edge
  (`clampSplit(0, total)` or `clampSplit(total, total)`) rather than
  previewing further shrinkage — the real collapsed rendering takes over once
  the drop commits it, so previewing past that point would only preview a
  half whose body no longer fits.
- `onPointerUp` releases capture, removes the inline `--split-top` override
  (so the committed React value takes over), and commits **once**: either
  `onCollapse("calendar" | "planning")` or `onSplitChange(percent)`.
- `onKeyDown`: `ArrowUp`/`ArrowDown` nudge by `SPLIT_NUDGE` (16px, converted
  through the same measure-and-clamp path); `Enter`/`Space` collapses
  whichever half is currently smaller (`topPx <= totalPx - topPx ? "calendar" : "planning"`).
- `onDoubleClick`: `onSplitChange(null)` — back to the CSS default.

### 3.3 The seam is in-flow, not floating

`RailHandle` is `absolute`, floating over its panel's right edge, because it
has padding to straddle. `SplitHandle` has no such padding to cross — it's a
genuine sibling between the two halves in the outer `flex flex-col` — so it's
an ordinary in-flow flex child, `h-1.5 shrink-0`, carrying the 1px `border-b`
that used to live on the calendar half's own container. Not rendered while
either half is collapsed, same rule as `RailHandle`: the collapsed strip is
itself the affordance back, so there's nothing to grab.

### 3.4 Layout: `basis-0` + `grow`, and `min-h-0` is load-bearing

Before this feature, the two halves were `flex-1` and `flex-[0.8]` — a fixed
~56/44 split, `board.tsx`. Now:

```tsx
// calendar half
"flex min-h-0 basis-0 bg-border/40"
splitCollapsed === "planning" ? "flex-1" : "grow-(--split-top)"

// planning half
"flex min-h-0 basis-0 bg-muted/30"
splitCollapsed === "calendar" ? "flex-1" : "grow-[calc(100_-_var(--split-top))]"
```

`grow-(--split-top)` is Tailwind v4's CSS-custom-property shorthand — same
syntax `w-(--column-min)` already uses elsewhere in this file — expanding to
`flex-grow: var(--split-top)`. `--split-top` is a **bare number**, not
`"56%"`: `flex-grow` takes a unitless ratio, so a percent sign in the custom
property would make the whole declaration invalid. The planning half computes
its share as `calc(100 - var(--split-top))`, which is why it needs the
bracket form (`grow-[calc(...)]`) rather than the parenthesis shorthand —
that shorthand only takes a bare `var()`, not an expression.

**`min-h-0` on both halves is required, not decorative.** A flex item's
default `min-height` is `auto`, which refuses to shrink below its content's
intrinsic height — without `min-h-0` the drag would silently stop working
past whatever height the content happens to need, well before the seam
actually reaches `SPLIT_MIN`.

When a half is collapsed, its sibling switches from `grow-(--split-top)` to
plain `flex-1` — filling everything the collapsed 40px strip doesn't use —
and the collapsed half renders `<SplitStrip>` instead of its normal content.

### 3.5 Mutual exclusion is a type, not a runtime check

`splitCollapsed` is `"none" | "calendar" | "planning"`, not two independent
booleans. "Both halves collapsed at once" isn't a state the type can express,
so there's no guard anywhere that has to remember to prevent it — the same
reasoning `docs/SCHEMA-CHANGES.md` gives for preferring a closed shape over
two flags that happen to usually agree.

### 3.6 Collapsing the calendar, then using DateNav, re-expands it mid-jump

This is the one piece of behavior that isn't a straight port of the rail
pattern, because a collapsed rail has no analogue to "the user tried to
navigate into the thing that's hidden."

`useDayTrack`'s `jumpToIndex` (`use-day-track.ts`) only ever *parks* a
request — `{target, seq}` — and a separate `useLayoutEffect` does the actual
`track.scrollTo`. That effect already bails **without** recording the
request's `seq` whenever `measurePitch()` reads 0 (the track has no layout
yet), specifically so a later run can still serve the same request. A
collapsed calendar is exactly that case: `dayTrackRef`'s track isn't mounted.

The one thing missing was a reason for the effect to run again once the
track *does* mount — a ref appearing is not something React re-renders for on
its own. So `useDayTrack` gained a `trackReady` option (default `true`), added
to that effect's dependency array purely to give it a reason to re-check:

```ts
trackReady: splitCollapsed !== "calendar",
```

`board.tsx` wraps `jumpBy`/`jumpToIndex`/`jumpToToday` once, where
`useDayTrack` returns, rather than inside `DateNav` — so hotkeys and the
command palette's "jump to today" inherit the behavior for free:

```ts
const showCalendar = useCallback(() => {
  if (splitCollapsed === "calendar") {
    void mutateSettings(LOCAL_OWNER_ID, { splitCollapsed: "none" });
  }
}, [splitCollapsed]);

const jumpBy = useCallback((delta: number) => {
  showCalendar();
  jumpByRaw(delta);
}, [showCalendar, jumpByRaw]);
// jumpToIndex, jumpToToday follow the same shape
```

No `rAF`, no timers, no waiting on the Dexie round-trip: `showCalendar()`
fires the settings mutation, `jumpByRaw()` parks the request in the same
tick, `splitCollapsed` flips to `"none"` on the next render, the calendar half
mounts its track, `trackReady` flips `true`, and the parked request gets
served by the existing bail-and-retry effect. Verified in a real browser —
see §5.

---

## 4. Persistence

Two fields on `settingsSchema` (`schema.ts`), next to `backlogWidth`/
`backlogCollapsed`:

```ts
splitRatio: z.number().int().min(SPLIT_MIN_PERCENT).max(SPLIT_MAX_PERCENT).nullable().default(null),
splitCollapsed: z.enum(["none", "calendar", "planning"]).default("none"),
```

`null` means "never resized" — same convention as the rails, so the CSS
default (`--split-top: 56` in `globals.css`) stays declared in exactly one
place instead of duplicated as a number that could drift from it.

**Migration 4** (`settings-add-split-layout`, `src/server/db/migrations.ts`):

```sql
ALTER TABLE settings ADD COLUMN split_ratio integer
ALTER TABLE settings ADD COLUMN split_collapsed text DEFAULT 'none' NOT NULL
```

`bootstrap.ts` was deliberately **not** touched — see `docs/SCHEMA-OPS.md`'s
warning about the chicken-and-egg trap that creates for existing accounts.

**Synced, unlike the rails.** `SETTINGS_SYNCED_FIELDS` (`lib/sync/wire.ts`)
includes both `splitRatio` and `splitCollapsed`. The rail widths are
deliberately device-local — a pixel width that's right for a laptop is wrong
for a wide monitor on the same account — but a *percentage* transfers between
screens, so there's no equivalent reason to exclude it. This was a judgment
call made with the user rather than an obvious default; worth revisiting if a
future device class makes a 74/26 split feel wrong at a very different aspect
ratio.

---

## 5. Verification performed

Full repo verification bar (`docs/SCHEMA-OPS.md`'s "Verification bar"), all
green before merge:

```
npm run typecheck   # tsc --noEmit (app) + tsconfig.worker.json (worker)
npm run lint
npx vitest run       # 750/750, including schema-parity.test.ts and migrations.test.ts
npm run build && npm run build:static
npx wrangler deploy --dry-run   # only local check that bundles src/server/worker.ts
```

Manual browser verification against the running dev server (Chrome DevTools
MCP, real pointer events dispatched at the seam):

- Dragged the seam; the committed ratio (74%) persisted across a full page
  reload.
- Dragged past the planning-half threshold → collapsed to a "Lists" strip;
  clicked the strip → re-expanded to the stored ratio.
- Dragged past the calendar-half threshold → collapsed to a "Calendar 2
  to-dos" strip; clicked **Next week** in `DateNav` → the calendar
  re-expanded to its stored ratio **and** jumped to the correct week in the
  same gesture.

Not exercised in a browser: keyboard resize (`ArrowUp`/`ArrowDown`), the
`Enter`/`Space` collapse-the-smaller-half gesture, and double-click reset —
covered only by the pure-math unit tests and code inspection, same caveat
`DRAG-AND-DROP.md` §7 gives for untested touch input.

**Migration 4 has not been confirmed against the production Durable Object.**
Same gap as migration 3 (see `.ai/todo.md`'s note on `8d7df69`): confirming
needs `npm run schema:info -- --prod`, which needs a signed-in session cookie
at `/tmp/faite-prod/cookies.txt` that wasn't available in the environment that
shipped this. The migration is additive (`ALTER … ADD COLUMN`, same shape as
migrations 2 and 3, which both landed cleanly) and applies on the DO's next
cold start, so the expected outcome is a no-op the first time the board is
opened signed in — but per `SCHEMA-OPS.md`'s own troubleshooting table, that
should be confirmed, not assumed.

**Deploy mechanism note.** `docs/SCHEMA-OPS.md` describes `git push` as what
deploys `main` via Workers Builds. At the time this shipped, no Workers
Builds git connection was actually configured for this account (checked via
the Cloudflare API — `builds/repos/connections` returned 404, and the
worker's `last_deployed_from` was `"wrangler"`). The deploy was done directly
via `npm run deploy`. Worth reconciling that doc with reality, or wiring up
the git integration, next time this comes up.

---

## 6. Known gaps / candidate next work

- Keyboard and touch interaction paths are unverified in a real browser (§5).
- No visual regression coverage — the collapsed-strip layout and the seam's
  hover/active states are eyeballed only, not screenshot-tested.
- Migration 4's landing on the production DO is unconfirmed (§5).
- If a future feature adds a third horizontally-stacked region to the board,
  the two-collapse-state enum (`"none" | "calendar" | "planning"`) will need
  rethinking — it's deliberately closed over exactly two halves.
