---
target: /board
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx"
target_fingerprint: "sha256:bc25eda2e94f8259fc0b042638bb8b54d752e8080fcdf20cc8a094ab966e5b3b"
target_path: /Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx
timestamp: 2026-10-15T04-36-52Z
slug: src-app-board-page-tsx
---
Method: dual-agent (A: a5d89c49e0c7f895a · B: a653cc969144057d5). Target src/app/board/page.tsx at origin/main bb187fb, live on https://myfaite.app/board after EI-384..EI-388. Overlay not injected (HTTPS production). Rolled/Overflow seeded via IndexedDB in a blank profile.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Toasts name the destination; completion tooltip shows "planned Oct 14"; palette rows hide done/Won't do state from their names |
| 2 | Match System / Real World | 3 | "Won't do", "Waiting for an ending" excellent; "4/1/↑11", "Week › Month ›" jumps read as view modes |
| 3 | User Control and Freedom | 3 | Undo everywhere; ⌘K Enter on a command query creates a junk to-do |
| 4 | Consistency and Standards | 3 | Overflow age reads three ways (card, palette, Overdrive); Overdrive buttons move between cards |
| 5 | Error Prevention | 2 | "sett"/"loop" + Enter files a to-do; one far-future date grows the track to ~350 columns |
| 6 | Recognition Rather Than Recall | 3 | Token chips great; list/day add placeholders invisible until hover; tab-count microsyntax |
| 7 | Flexibility and Efficiency | 4 | ⌘K row actions, arrow triage, tokens, skip links, Quick sort |
| 8 | Aesthetic and Minimalist Design | 3 | Calm; date-nav row has 10+ controls; three sign-up prompts |
| 9 | Error Recovery | 3 | "not used" chip exemplary; undo on every action |
| 10 | Help and Documentation | 3 | `?` sheet 52 rows, no filter, 10px kbd |
| Total | | 30/40 | Good |

## Design Specificity Verdict
Specific: serif titles, Today as the one card with its hairline, muted ↳, Won't do dimmed, "Waiting for an ending", and the Overdrive tally that gives won't do equal billing. Generic remnants: info-blue sign-up banner, mono pill badges, a toolbar-like date-nav row.
Detector: CLI exit 0, 2 advisory (vendored calendar.tsx). URL exit 0, 1 advisory (bounce-easing, allowed spring). Browser: 0 text-contrast failures (light/dark/phone); Overflow rule 3.53/3.67; skip-link ids exist once each; one <main>; no hidden headings; no focus gaps. Lighthouse a11y 96: label-content-name-mismatch ("Deadline" visible but not in the name = real; others strict/false), target-size (checkbox 24×30 real, false positive). Phone under 44: "1 due" banner 26 tall, Keyboard shortcuts 42 wide, banner Sign up 47×30, My Lists tab 24 tall, Archived 36, Quick sort 42 tall.

## Priority Issues
1. [P1] ⌘K: "Create to-do <query>" outranks real commands — "sett" highlights it above Open settings; "loop" + Enter created a to-do. command-registry.ts:130 (when: hasQuery; value includes the query). Fix: sort the fallback last (custom cmdk filter floor score) or show it only when nothing else matches; test "sett" → Open settings. Command: harden.
2. [P2] Overflow age wording outside the column: Overdrive card shows "Scheduled Aug 30" over a bare "42 days"; Settings loop example shows "since today" under "Oct 19". Fix: full wording in overdrive-card.tsx:58 and loop-example.tsx:128. Command: clarify.
3. [P2] Palette rows hide done/Won't do state from their accessible names (board cards include it). Fix: pass completionStamp to todoRowName in command-palette.tsx:824; consider a visible muted badge. Command: harden.
4. [P2] Date-nav row overloaded: Week/Month/Quarter › jump but read as views; 10+ peer controls. Fix: "‹ Today ›" + one Jump menu; fold Weekends and Saved views into View (date-nav.tsx). Command: distill.
5. [P3] Overdrive buttons re-center per card and the dialog grows ~60px when scheduling is staged. Fix: fixed equal-width grid, reserved staged height. Command: polish.

## Persona Red Flags
Alex: palette swallows command queries; `?` sheet has no filter.
Sam: palette rows don't speak status; Won't do by opacity alone; 10px kbd; "Deadline" not in the name.
Rory: empty list/day columns hide "Add a to-do" until hover; three sign-up prompts; "4/1/↑11" opaque.

## Minor Observations
Far-future date grows the track to ~350 columns; "Thursday" typed on a Thursday resolves to today; palette rolled rows show the stored date; Overflow empty state "No items."; phone rails flush with the bezel; View menu vs palette label mismatch; root palette shows the Delete group with no query; phone targets under 44 listed above.

## Questions to Consider
1. Should an Overflow card count up ("132 days"), or say what it waits for?
2. Should Won't do carry a word instead of only a dim?
3. At 1440×900 Overflow shows 3 of 8 cards and empty columns hide how to add — is density spent on rails instead of work?
