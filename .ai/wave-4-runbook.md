# Wave 4 runbook — the last two PRs (#11, #13)

Written 2026-08-18, after Waves 1–3 merged and deployed. `main` is at `428b105`,
production is live and clean. **Two PRs remain, and they are not the same kind of job:**
#11 is an ordinary rebase-and-merge, #13 should never be rebased at all.

Everything below was verified read-only against `origin/main` at `428b105` — the conflict
sets are measured with `git merge-tree`, not predicted.

---

## #11 — EI-104, Overdrive swipe gestures on phone

[PR #11](https://github.com/RobErskine/faite/pull/11) · worktree `.claude/worktrees/ei-104`
· branch `rob/ei-104-overdrive-swipe-gestures` · Linear [EI-104](https://linear.app/rob-erskine/issue/EI-104/overdrive-swipe-gestures-on-phone)

### Good news: only one file conflicts

The original plan feared a three-way mess with #4 (EI-103, Overdrive settings) across the
overlay, its test, and the docs. Actual result of a dry merge against current `main`:

| File | Result |
|---|---|
| `src/components/board/overdrive-overlay.tsx` | **CONFLICT** — the only one |
| `src/components/board/overdrive-overlay.test.tsx` | auto-merges |
| `docs/OVERDRIVE.md` | auto-merges |
| `e2e/overdrive.spec.ts` | **auto-merges** |
| `docs/MOBILE.md`, `src/lib/overdrive-swipe.{ts,test.ts}` | new files, no conflict |

The `e2e/overdrive.spec.ts` result is worth calling out: #11 appends a new block at line
234+, while EI-185's fix rewrote lines 156–197. Disjoint ranges, so the file that looked
most dangerous is the one that needs no attention.

### The one conflict is positional, not semantic

Three collision zones in `overdrive-overlay.tsx`, at old lines **~192, ~431, ~478**. Both
sides *insert new independent blocks at the same offsets*:

- **`main` (#4/EI-103)** adds the opt-in auto-confirm timer — props, a settings read, and an
  effect that fires through `dispatchRef`.
- **#11 (EI-104)** adds swipe drag state — `pointerId` scoping, axis lock, and the
  pointer handlers.

They do not touch each other's logic. **Resolve by keeping both**, in every zone. If you
find yourself choosing a side, stop — that means the hunk got mis-split.

### Procedure

```bash
cd /Users/roberskine/Sites/faite/.claude/worktrees/ei-104
git fetch origin --prune && git rebase origin/main
# resolve overdrive-overlay.tsx: keep BOTH blocks in all three zones
npm run typecheck && npm run lint && npm run test
git push --force-with-lease
```

Then watch CI, merge, Linear → Done, `git worktree remove`.

### After typecheck, re-check for a literal break

`tsc` is the net here, not git. Wave 3 hit exactly one of these: a full `List` literal that
merged cleanly and then failed to compile because EI-112 had made
`defaultReminderPresetId` required. #11 was cut before Waves 2–3 landed, so if it builds a
full `Settings`, `List`, or `Todo` literal anywhere, expect `tsc` to name the missing field.
Add the field, don't reshape the literal.

### ⚠️ This one needs a physical phone

The automated tests prove the **gesture logic fires** — they do not prove it **feels right**.
`src/lib/overdrive-swipe.ts` is pure and unit-tested, and `overdrive-overlay.test.tsx`
drives synthetic pointer events. Neither can tell you whether the axis-lock threshold and
commit distance feel natural under a thumb.

Merging on green CI alone is defensible (the logic is covered), but **budget a real device
pass before trusting it in daily triage.** If it feels wrong, the knobs are
`SWIPE_AXIS_LOCK_PX` and the commit threshold in `src/lib/overdrive-swipe.ts` — both pure
constants, cheap to tune in a follow-up.

---

## #13 — EI-178, background-sync timer spike. **Do not rebase this one.**

[PR #13](https://github.com/RobErskine/faite/pull/13) · worktree `.claude/worktrees/ei-178`
· Linear [EI-178](https://linear.app/rob-erskine/issue/EI-178/d2-background-sync-timer-mitigation-spike)

### Why rebasing is the wrong move

#13 was built *before* PR #1 (the D0 spike) merged, so it carries its **own duplicate
`src-tauri/` scaffold** — `Cargo.toml`, `Cargo.lock`, `build.rs`, `capabilities/`, and the
full icon set — which now collides with both #1 and #14. Rebasing means hand-resolving a
scaffold you already have, to gain nothing.

**Verified against `main` at `428b105`:** of everything #13 touches, exactly **three files
do not already exist on `main`**:

| File | Lines |
|---|---|
| `docs/DESKTOP-SYNC-TIMER-SPIKE.md` | 323 |
| `src-tauri/src/ei178_probe.rs` | 283 |
| `ei178-static/probe.html` | 8 |

That is the entire unique value of the PR. Everything else is duplicate scaffold.

### Procedure — cherry-pick onto a fresh branch

```bash
cd /Users/roberskine/Sites/faite
git checkout main && git pull
git checkout -b rob/ei-178-spike-findings

git checkout rob/ei-178-bg-sync-timer-spike -- \
  docs/DESKTOP-SYNC-TIMER-SPIKE.md \
  src-tauri/src/ei178_probe.rs \
  ei178-static/probe.html

npm run typecheck && npm run lint && npm run test
git add -A && git commit   # explain in the message that #13 is superseded, not abandoned
git push -u origin rob/ei-178-spike-findings
```

Open a PR, merge it, then **close #13 unmerged** with a comment pointing at the replacement.

### Decide before you commit: does `ei178_probe.rs` belong on `main`?

It is a **throwaway probe**, and `src-tauri/` is now real shipped code. Three options:

1. **Doc only.** Land `docs/DESKTOP-SYNC-TIMER-SPIKE.md` and let the probe die with the
   branch. The findings are the deliverable and they are already summarised on EI-178.
   Cleanest `main`; the probe stays recoverable from the branch/PR history.
2. **Doc + probe, quarantined.** Land all three but keep the probe out of the default build
   — it must not end up compiled into a shipping binary just because it sits in
   `src-tauri/src/`. Check how `src-tauri/src/` modules get wired before assuming it is inert.
3. **All three, as-is.** Simplest to execute, highest chance of someone later wondering why
   a probe is in the desktop app.

**Recommendation: option 1**, unless you expect to re-run the probe against a signed `.app`
— which EI-180 ("D1: re-measure footprint against a signed .app") suggests you might. In
that case option 2, and say so in the PR.

Either way EI-178 goes to **Done** once the findings are on `main`; the spike answered its
question (Rust-driven `eval()` ticks work).

---

## Order, and how long it takes

Do **#11 first**. It is the one with a merge conflict, and it is the one whose e2e run you
want on a `main` that is not simultaneously being changed. #13's cherry-pick touches
nothing #11 touches, so it can follow immediately, or wait a week — no coupling.

Budget realistically: CI is **~11 minutes on a good run**, and intermittently hangs for
20–35 minutes on the `Install Playwright's Chromium OS dependencies` step (it hung twice
during Wave 3). If a run passes ~15 minutes with `verify` already green and `e2e` still
showing the OS-deps step in progress, cancel and `gh run rerun --failed` rather than
waiting — both hangs cleared on a re-run. That is
[EI-187](https://linear.app/rob-erskine/issue/EI-187/ci-e2e-job-takes-11-min-on-a-good-run-and-intermittently-hangs-for-20).

## When both are done

```bash
git checkout main && git pull
npm run verify                 # typecheck + lint + test + build + build:static
npx wrangler deploy --dry-run  # the only thing that bundles src/server
```

Neither PR changes the schema, so **no migration work and no `schema:generate`** — the
ledger stays at 14. Workers Builds auto-deploys `main`, so merging is deploying; confirm with
`npx wrangler deployments list` and check production is clean afterwards.

Then the queue is empty: 16 of 16 PRs resolved. Remaining worktrees `ei-104` and `ei-178`
can both be removed, and the stale local branches
(`rob/ei-111-reminder-relative-offsets`, ~20 `worktree-agent-*`) pruned.

**`rob/ei-117-tab-strip-counts` was NOT stale — do not prune it.** An earlier
revision of this list called it stale; it actually held 7 unpushed commits (the
tab-pill counts, EI-117 – EI-120) that had never been PR'd, and nearly lost them.
The work was rebased onto main and shipped as `rob/ei-118-tab-strip-counts`.
Before pruning any branch off a list like this, check `git log origin/main..<branch>`
is empty first.

## Open follow-ups, already filed

- [EI-187](https://linear.app/rob-erskine/issue/EI-187/ci-e2e-job-takes-11-min-on-a-good-run-and-intermittently-hangs-for-20) — CI duration + the OS-deps hang
- [EI-188](https://linear.app/rob-erskine/issue/EI-188/ei-62-part-2-retire-the-project-entity-schema-sync-kinds-dexie-columns) — EI-62 Part 2, retiring the `project` entity
- [EI-184](https://linear.app/rob-erskine/issue/EI-184/sub-task-promotion-reordering) — sub-task promotion + reordering, the EI-55 follow-up
- [EI-181](https://linear.app/rob-erskine/issue/EI-181/seed-production-d1-migrations-bookkeeping-before-enabling-deploy-time) — **still blocks** wiring EI-79's D1 migration step into real deploys. Do not use `deploy:with-migrations` until this lands.
