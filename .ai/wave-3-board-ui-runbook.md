# Wave 3 runbook — board UI cluster (#7 → #12 → #2 → #6)

Prepared while Wave 2 (#16 → #4 → #9) is in flight. All four Wave 3 worktrees share
merge-base `45025be` — none has been rebased since Wave 1 landed, let alone Wave 2. By the
time Wave 3 starts, `main` will additionally carry `Todo.source` (#16), two `Settings`
overdrive fields (#4, folded into `loop-section.tsx`), and `List.defaultReminderPresetId`
(#9). Re-run the literal-construction check (see Wave 2 plan's landmine section) against
whatever `main` actually looks like at that point — don't assume Wave 2's specific breaks
are the only ones; the pattern (new required field vs. a full-literal builder outside the
PR's own diff) is what to watch for generally.

Order, per the existing plan (`i-want-to-start-lucky-sonnet.md`): **#7 → #12 → #2 → #6.**
#7 is the foundation #12 renders against; #2 is independent; #6 is Part 1 only, by design.

## No migration-id collision this wave

None of #7/#12/#2/#6 touch `drizzle/`, `src/server/db/migrations.ts`, or add a migration
id. Wave 2's renumbering dance does not repeat here — one less thing to track per PR.

## No e2e collision this wave

None of the four touch anything under `e2e/`. No stale-red risk analogous to #16's
already-fixed `overdrive.spec.ts` failure — a red e2e run on any of these four is real.

## Per-transition file overlaps

| Transition | Shared files | Risk |
|---|---|---|
| #7 → #12 | `use-board-data.ts` | Clean — different insertion points |
| #12 → #2 | `desktop-board.tsx`, `phone-board.tsx` | Clean — different insertion points |
| #2 → #6 | *(none)* | N/A |
| #7 → #6 (cumulative) | `board.tsx`, `todo-sheet.tsx`, `todo-sheet.test.tsx`, `use-board-data.ts` | **Real conflict — see below** |

### #7 → #12: clean
`use-board-data.ts` — #7 adds `&& !t.parentId` to the `visibleTodos` filter; #12 inserts a
new `subtaskCounts` memo immediately after and adds it to the return object. No shared
lines.

### #12 → #2: clean
`desktop-board.tsx` / `phone-board.tsx` — #12 threads `subtaskCounts` through the
destructure and 4 `BoardColumn` call sites per file; #2 adds a `BoardEmptyBanner` import
plus one JSX line near the top, and (phone only) `calendarCount`/`planningCount` about 10
lines from #12's insertion. No line-level overlap.

### #2 → #6: clean
No shared files at all.

### #7 → #6: the landmine — resolve by hand, don't trust auto-merge

Not a missing-required-field problem — `parentId` is pre-existing, nullable, defaulted;
#7 only adds doc comments around it. This is a **dense textual collision** in the same
files, once #12 and #2 are already in the branch:

- **`board.tsx`** (~15 lines): #7 inserts `todos={data.todos}` after `lists={data.lists}`
  and `onAddSubtask={...}` after `onDelete={...}` in `<TodoSheet>`'s prop block. #6
  *deletes* `projects={data.projects}` from that same ~20-line block and adds
  `tabsById={data.tabsById}`. Default 3-line diff context means these hunks overlap — a
  real conflict, not a fuzzy auto-apply.
- **`todo-sheet.tsx`** — four separate zones, all touched by both PRs within a few lines:
  1. `TodoSheetProps` interface: #7 adds `todos?: Todo[]` near `lists`; #6 removes
     `projects: Project[]`, adds `tabsById?`.
  2. Destructured params: same pattern, same proximity.
  3. **Hard collision**: #7 inserts a new `subtasks` `useMemo` directly above
     `const tabsById = useMemo(() => new Map(tabs.map(...)), [tabs]);` — and #6 *rewrites
     that exact line*, renaming it `liveTabsById` and updating downstream references
     (`mentionListOptions`). Git will flag this as a real conflict.
  4. JSX body: #7 inserts the whole `<SubtasksSection>` block immediately before
     `<Separator />`; #6 replaces the Project `<Select>` field immediately *after* that
     same `<Separator />` with a read-only Tab `<div>`. Adjacent-hunk risk even where not a
     literal conflict.
- **`todo-sheet.test.tsx`**: same shape — the shared `Harness`'s props interface,
  destructure, and JSX all touched by both PRs within a few lines. Only 3 `projects={[]}`
  call sites exist total; #7 doesn't add a 4th, so #6's removal isn't missing a site, but
  the `Harness` block itself is a 3-way overlapping hunk (7/12 groundwork still present).

**When rebasing #6**: resolve `board.tsx` and `todo-sheet.tsx`/`.test.tsx` conflicts by
hand. After resolving, explicitly verify:
- `Project`/`projects` is fully gone from both files (no half-removed import or prop)
- `data.tabsById` (the board-level archived+live tab map #6 introduces) isn't cross-wired
  with `liveTabsById` (the *local* rename inside `todo-sheet.tsx` that #6 also
  introduces) — same naming neighborhood, different scope, easy to swap by accident during
  manual conflict resolution.

## PR-description flags (new, beyond what's in the main plan)

- **#7**: explicitly scopes out the progress badge as "a deliberate limitation, not done
  here" — confirms #12 is its intended, in-order follow-up.
- **#12**: states no hard merge-order dependency on #7 — it reads `parentId` directly and
  renders a badge of zero until #7 lands. Consistent with the file-overlap finding above.
- **#6**: flagged by its own author as **"Not for merging tonight."** Part 2 (schema/entity
  retirement of `project`) is explicitly deferred; only Part 1 (derived Tab, no schema
  change) is in scope for this wave, matching the existing plan's note. The PR body's
  reviewer checklist items concern Part 2 and aren't relevant to this merge — preserve them
  for whatever tracks the Part 2 follow-up (Linear, presumably) rather than resolving them
  here.

## Procedure (same shape as Wave 2, minus the drizzle step)

Per PR, in order, worktree `ei-55` → `ei-183` → `ei-82` → `ei-62`:

```bash
cd /Users/roberskine/Sites/faite/.claude/worktrees/<wt>
git fetch origin --prune && git rebase origin/main
# resolve conflicts by hand where flagged above — #6 needs the most care
npm run typecheck && npm run lint && npm run test
npm run dev   # #12's badge needs #7 live to render; #2's banner needs an empty board to eyeball
git push --force-with-lease
gh run watch $(gh run list --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Confirm with Rob before every merge. Match Wave 1/2's merge-commit style (not squash).
Then Linear → Done, `git worktree remove`.

## What still needs your eyes (from the main plan, unchanged)

- **#2** — empty-board copy: does it land, is it calm enough?
- **#12** — only visible once #7 is live; check the badge itself once both are merged.
- **#6** — Part 1 only. Don't merge expecting a finished ticket; Part 2 is unblocked but
  not built.
