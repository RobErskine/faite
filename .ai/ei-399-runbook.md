# EI-399 — the completion beat lands on the click (runbook)

This file is the `## Handoff` comment on [EI-399](https://linear.app/rob-erskine/issue/EI-399), copied into the repo because the conductor session has no Linear MCP. It is the conductor's whole brief. If Linear is reachable, the comment and this file are identical.

## Handoff

Decided fix for the P1 in the second row critique (`.impeccable/critique/2026-10-16T02-29-43Z__src-components-board-todo-card-tsx.md`). Nothing here is open.

### Decisions
- **The tick is optimistic.** On click (or Space), the checkbox shows checked and the flash + strike start from local state immediately, before the write resolves. If the write fails, revert the local state (and the existing error path still toasts).
- **The flash and strike animate compositor-only properties.** Strike = an overlay line element per title line animated with `transform: scaleX(0→1)` (origin left / inline-start), not `background-size`. Flash = an opacity/scale pseudo-ring, not `box-shadow`. Same 180ms and `--ease-out-soft`-family easing as today; the drawn strike must still sit where the face's real strike-through sits (today's `strike-draw` measured offset/thickness per font — keep those values).
- **The board's re-render does not land inside the tick.** Defer the post-write board update (the expensive re-derive that produced the 92ms long task) so it runs after the first frames of the beat — `startTransition` or scheduling it after the flash — without delaying data correctness for other views.
- Keep exactly: default-view hold → fade → neighbors close the gap; View: All slide; undo mid-beat; focus moving to the next row; reduced motion = no animation, one step, correct state.

**Rejected:** shortening the beat; dropping the strike animation; Web Animations API rewrites beyond these two effects.

### Facts verified against origin/main
- `src/app/globals.css`: `--animate-check: check 180ms cubic-bezier(0.22, 1, 0.36, 1)` (256), `--animate-strike: strike 180ms …` (257), `@keyframes check` (261, animates box-shadow), `@keyframes strike` (275, animates `background-size: 0% var(--strike-thickness)`), `@utility strike-draw` (833); the measured strike placement comment ~692.
- `src/components/board/todo-card.tsx`: `justCompleted` state (314) drives `animate-check` on the box (722) and `strike-draw animate-strike` on the title (865–866); `checked={todo.status === "done"}` (713) — the box waits for the store; `onCheckedChange={() => onToggle(todo, originOf(checkboxRef.current))}` (714); keyboard path calls `onToggle` at 460.
- `src/components/board/use-completion-beat.ts` (`useCompletionBeat`, 114): holds the row for `BEAT_MS`, fades for `LEAVE_MS`, gives up after `GIVE_UP_MS`; timers via `later(...)`; constants from `src/lib/completion-beat.ts`.
- Measured on production: box checks ~147ms after click; a 92ms long task at ~162ms; strike pops 38%→99.7% across one 119ms gap.

### Out of scope
The drawer (EI-396 runs in parallel in another worktree — it also edits `src/app/globals.css` (a toaster rule) and `docs/DESIGN.md` §7; keep your edits to your own lines so the later rebase is trivial). Other motion in EI-270.

### Port note (another conductor runs at the same time)
In conduct.md §3, run the e2e gate on **port 3101**, not 3100: `CI=1 E2E_PORT=3101 E2E_SERVER="npx next start -p 3101" npm run e2e:ci`. Do not run the server suite (not needed for this change).

## Steps
1. **Optimistic tick + compositor-only flash and strike** — local "pending done" state in the card so the box checks and `justCompleted` starts on click; revert on write failure; replace the strike's `background-size` animation with a `transform: scaleX` overlay per line (keep the measured offset/thickness); replace the flash's `box-shadow` keyframes with an opacity/scale ring (pseudo-element); `motion-reduce` removes both. Tests: box checked synchronously after click (before the write promise resolves); revert on rejection; classes use the new keyframes; reduced motion. — files: `src/components/board/todo-card.tsx`, `src/app/globals.css`, `src/components/board/todo-card.test.tsx` — verify: `npx vitest run src/components/board/todo-card.test.tsx`
2. **Defer the board re-render past the tick** — make the post-write board update non-urgent (e.g. `startTransition` around the state that re-derives the board, or schedule the hold's start so the re-derive runs after the flash's first frames), without breaking undo, focus move, View: All slide or `GIVE_UP_MS`. Tests in the column and pure helper. — files: `src/components/board/use-completion-beat.ts`, `src/lib/completion-beat.ts`, `src/lib/completion-beat.test.ts`, `src/components/board/board-column.tsx`, `src/components/board/board-column.test.tsx` — verify: `npx vitest run src/lib/completion-beat.test.ts src/components/board/board-column.test.tsx`
3. **Docs** — docs/DESIGN.md §4 "The completion beat" (optimistic tick; compositor-only flash and strike) + one §7 row at the END of the table dated 2026-10-16; root `DESIGN.md` mirror (body only). — files: `docs/DESIGN.md`, `DESIGN.md` — verify: `npx vitest run src/lib/spelling.test.ts`

Parallel: none — 2 waits for 1 (both affect the beat's timing); 3 waits for 2.
Done when: completing a to-do checks the box on the click frame, the flash and strike animate only transform/opacity, the board re-render no longer lands inside the 180ms tick, all existing beat behavior is unchanged, and `npm run e2e:ci` (port 3101) passes.

## Conductor report
(The conductor writes its `## Conductor report` here, below this line, and commits it with the PR, because it cannot post to Linear.)

## Conductor report

- **PR:** https://github.com/RobErskine/faite/pull/163 (Linear not moved: no Linear MCP in the conductor session).
- **Steps:** 1 done (optimistic tick, compositor-only flash and strike). 2 done, with `use-board-actions.ts`, `todo-card.tsx` and `todo-card.test.tsx` added to its file list: step 1 found that `handleToggle` and the hook dropped the write promise, so revert-on-failure could never fire. Design: `TICK_LEAD_MS = 34` leads the open→done write (so the board re-derive, toast and confetti land after the flash's first frames) rather than `startTransition`. 3 done (docs/DESIGN.md §4 + §7, root DESIGN.md). No Opus escalations.
- **Checks (after the fix round):** typecheck, npm test (3466), openapi drift (none), lint, build:static, build, `e2e:ci` on port 3101 (153 passed) — all green. Server suite skipped (not needed per Handoff). The rebase onto origin/main brought one docs-only commit, so §3 was not re-run after it. Not checked: strike placement by eye in a real browser, and the 92ms long task is not re-measured.
- **Review (pr-reviewer, posted):** 2 bugs fixed — store flip replaying the beat after `animationend` (now skipped while `pendingDone`); reduced motion leaving stale overlays (beat now never starts under reduced motion, plain line-through).
- **Left open (nits):** (1) docs/DESIGN.md says "the existing error path toasts", but `handleToggle` has no catch, so a failed write unchecks the box while the "Completed" toast and confetti already showed. (2) The 2s settle timer is not cleared when a new click starts (complete, reopen, complete again within 2s under View: All).
