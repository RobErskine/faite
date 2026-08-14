# Overnight session summary — 2026-08-14

**Read this first.** Everything below is also scattered across individual
`.ai/todo.md` entries in commit order; this file is the one-page version.
Branch `rob/overnight-2026-08-14`, 21 commits, nothing pushed, nothing
deployed. `npm run verify` was green before every commit.

## What shipped, easiest to hardest

1. **EI-61** — closed, no code. Already satisfied by existing group headers.
2. **EI-105** — fixed a 100%-failing e2e test (`core-flows.spec.ts`). Root
   cause: `HistorySection` defaulted to open in an earlier commit; the test
   still clicked it "open," which collapsed it instead. **This was blocking
   every other e2e-touching ticket tonight**, so it went first.
3. **EI-81** — auto-scroll was already configured, just untested and
   mis-documented as "unknown." Extracted a pure `computeAutoScroll()` and
   tested it. Left "does it feel right" for a human at a browser.
4. **EI-74** — new `e2e/keyboard-drag.spec.ts`. Also found and documented a
   real, still-open gap: keyboard drag can't cross from the pinned Backlog
   rail into the calendar half (landed as `test.fixme()` with full
   diagnosis, not silently patched over).
5. **EI-84** — dnd-kit screen-reader announcements (`src/lib/dnd-announcements.ts`),
   verified live in a browser, not just unit tests. VoiceOver pass is a
   human-only step per the ticket's own AC.
6. **EI-75** — full keyboard-shortcut catalog (~60 shortcuts found vs. a
   2-entry registry). `?` opens a new help sheet; `docs/KEYBOARD.md` §1
   rewritten from a fresh inventory (8 stale claims, 14 missing groups
   fixed). New `AGENTS.md` rule so future shortcuts get registered.
7. **EI-106, all 5 phases (EI-107/108/109/110/113)** — reminder presets, a
   full feature: a new synced entity (the 10th sync kind), a D1 migration
   (id 11) + Dexie v6 bump, a Combobox-based picker, a Settings management
   UI, quick-add vocabulary, a card badge. **See `docs/REMINDERS.md`** for
   the canonical reference — decisions, data model, every phase.

## Then: an independent code review, before calling it done

Ran a code-reviewer agent over the whole branch diff. No critical
(schema/migration) issues — verified clean. Found two real bugs, both fixed
with regression tests (commit `c9547d2`):

- **quick-add's preset matching ate ordinary words.** `"note on"` silently
  became the title `"note"` plus an unrequested 3pm reminder, because `"on"`
  is a substring of `"Afternoon"`. Fixed to whole-word/prefix matching.
- **The preset seed could re-run forever** if it ever ran before a settings
  row existed (an edge case, not the normal boot path, but a real one).

Plus three minors (a `FIELD_DEFAULTS` defense-in-depth entry, a redundant
branch, and a Settings text field rebuilt to commit-on-blur instead of
every keystroke — the original would have permanently locked the field the
first time someone cleared it to retype).

## What needs your attention

1. **EI-107's migration (id 11) and Dexie version bump (v6) — review before
   deploying.** This was scoped deliberately: no push, no deploy tonight.
2. **Linear MCP disconnected partway through** (right after EI-84) and never
   came back. Every ticket from EI-105 onward has NOT had its Linear status
   or comment updated — that's all pending. The commit messages and
   `.ai/todo.md` entries have the full writeup for each; post them once
   Linear's reachable (I'll do this automatically if it reconnects before
   07:00, otherwise it's a manual catch-up).
3. **Two things left for a human, both flagged, neither silently skipped:**
   - EI-84's VoiceOver pass (no AT automation exists in this repo)
   - EI-81's "does auto-scroll feel right" (a per-frame feel check, not
     something worth an E2E assertion)
4. **One real, documented gap, not a bug:** keyboard drag can't cross from
   Backlog into the calendar half. `e2e/keyboard-drag.spec.ts` has it as a
   `test.fixme()` with the full diagnosis. Worth its own ticket if it's
   worth fixing rather than just knowing about.

## Verification, if you want to check any of this yourself

```bash
git log --oneline main..rob/overnight-2026-08-14   # all 21 commits
npm run verify        # typecheck x2, lint, test, build, build:static
npm run schema:check  # expects migration id 11
npm run e2e           # all 5 projects; only known-flaky test is
                       # overdrive.spec.ts's round-3/4 parallel-load case,
                       # unrelated to tonight, documented on EI-105
npm run dev            # ? opens the shortcut help sheet
                        # Settings -> Reminders shows 5 seeded presets
                        # a todo sheet with a date set shows the Reminder field
```
