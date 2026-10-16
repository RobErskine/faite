---
target: the to-do row
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/components/board/todo-card.tsx"
target_fingerprint: "sha256:472f38fb53e34f53efe6ceacd2591c8fec3956ff0a655302746d16154bf04e01"
target_path: /Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/components/board/todo-card.tsx
timestamp: 2026-10-16T02-29-43Z
slug: src-components-board-todo-card-tsx
---
Method: dual-agent (A: ae67ee9656ec47b89 · B: a7611762675ea36a7). Target src/components/board/todo-card.tsx (+ todo-row-parts.tsx, row-grammar.ts, drag-chip.tsx, overdrive-card.tsx) at origin/main a2fe04f, live after EI-395 (#160).

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | The beat exists; the box checks 147ms after the click and a 92ms long task freezes the flash/strike |
| 2 | Match System / Real World | 3 | Plain badges; a reminder preset hides the clock time ("☕ Afternoon") |
| 3 | User Control and Freedom | 3 | Undo at any point; Won't do an honest ending |
| 4 | Consistency and Standards | 3 | One anatomy holds across board/⌘K/Overdrive/drag chip; Overdrive's scheduled date as a sentence, 10px badges under a 24px title |
| 5 | Error Prevention | 3 | Grip and checkbox targets meet without overlap; desktop grip draws on the P1 rail |
| 6 | Recognition Rather Than Recall | 2 | A future deadline is a bare flag; its date is hover-only (not on touch or focus) |
| 7 | Flexibility and Efficiency | 4 | Space, x, arrows; ⌘K matches the board |
| 8 | Aesthetic and Minimalist Design | 3 | Calm typical rows; badge-heavy rows become a pile of pills |
| 9 | Error Recovery | 3 | Undo works |
| 10 | Help and Documentation | 2 | Every explanation is a hover tooltip |
| Total | | 29/40 | Good |

## Verified fixed from run 1
Completion beat present (default view fade → close up; View: All slide; reduced motion one step); label text 9.7–13.2:1; Won't do 5.25 / 6.6; one anatomy across four surfaces; one icon per meaning; names match visual order; one focus ring color; hover wash animates; touch gutter exact. Detector 0 findings; 0 text-contrast failures.

## Priority Issues
1. [P1] The completion beat freezes at the tick: the box checks ~147ms after the click (waits for the write); a 92ms long task lands inside the 180ms flash/strike; both animate main-thread properties (box-shadow, background-size), so the strike pops 38%→99.7% across one gap. Fix: check + start the strike from local state on click; strike as transform scaleX on an overlay, flash as opacity/scale ring; defer the board re-render until after the hold. Command: animate, optimize.
2. [P2] A done row doesn't fully step back: checked box is solid near-black at 100% and badges stay full ink; in View: All done rows are the loudest marks. Fix: quiet checked box (foreground/60) and a settled flag for badges. Command: polish.
3. [P2] Time badge shows clock + emoji + preset name and hides the time ("☕ Afternoon"); names speak "hot beverage". Fix: clock + exact time on the row; preset name in name/tooltip; strip emoji from names. Command: clarify.
4. [P2] Desktop grip overlaps a P1 rail on hover (dots x4–9, rail x0–5). Fix: fade the rail while the grip shows, or a 16px mouse gutter. Command: polish.
5. [P3] Badge-heavy rows wrap to 3–4 lines of pills; `nums` draws slashed zeros in sentences ("1Ø days" in Hyperlegible). Fix: collapse labels to +N; drop slashed-zero from `nums`. Command: distill, typeset.

## Minor
Sparkles icon 10px; Overdrive "Backlog · Scheduled Oct 1" sentence; rounded bracket from dashed/double left borders; drag chip heavy ring+shadow; ⌘K "Oct 15" instead of "Today"; Tomato label beside red deadline reads as two reds; phone 2px dead strip between grip and checkbox; possible board issue: Today's card surface ended while rows continued after a scripted scroll.

## Questions
1. Should P1 be the heaviest ink on a calm page?
2. Is waiting for the write before the box checks honest, or slow?
3. Should density vary the words too (⌘K and Overdrive have room for "Due Oct 20")?
