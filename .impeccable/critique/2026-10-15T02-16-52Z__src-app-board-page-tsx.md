---
target: /board
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx"
target_fingerprint: "sha256:bc25eda2e94f8259fc0b042638bb8b54d752e8080fcdf20cc8a094ab966e5b3b"
target_path: /Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx
timestamp: 2026-10-15T02-16-52Z
slug: src-app-board-page-tsx
---
Method: dual-agent (A: a58d82a094338d6ef · B: a77b1f443677d158a). Target src/app/board/page.tsx at origin/main 61782f9, live on https://myfaite.app/board after EI-379..EI-383. Overlay not injected (HTTPS production). Rolled/Overflow seeded via IndexedDB in a blank profile.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Toasts say where it landed; palette date chips drop the year; Today hides more than half its cards |
| 2 | Match System / Real World | 3 | Plain, kind copy; "items" leaks in; `?` sheet shows `contextmenu` |
| 3 | User Control and Freedom | 4 | Undo everywhere, × on every chip, Esc leaves Overdrive, ⌫ steps back |
| 4 | Consistency and Standards | 2 | Quick sort under View; no Settings in ⌘K; Won't do toast uses a success check; phone Overflow titled twice; "Week ›" reads as a view switch |
| 5 | Error Prevention | 3 | "not used"/"no list" chips; Overdrive stages Schedule |
| 6 | Recognition Rather Than Recall | 2 | Tab counts and ⚡ need tooltips; phone Lists hides 4 of 5 lists; Won't do shown only by dimming |
| 7 | Flexibility and Efficiency | 4 | Token quick-add, ⌘K, arrow Overdrive, skip links |
| 8 | Aesthetic and Minimalist Design | 2 | Today cramped beside empty days; "Overflow" 8× on the phone Overflow page; three sign-up asks |
| 9 | Error Recovery | 3 | Undo toasts and dismissible chips |
| 10 | Help and Documentation | 3 | Complete `?` sheet with 10px key glyphs; Loop example, Overflow (i) |
| Total | | 29/40 | Good |

## Design Specificity Verdict
Clearly its own: serif day titles, priority as line style, spectrum hairline on Today, "Waiting for an ending", the Loop example, one-card Overdrive. Generic remnants: mono pill badges, three sign-up asks, a settings-dump ⌘K root. Structural weak spot: Today gets the same 168px as an empty Sunday.
Detector: source exit 0, 2 advisory (vendored calendar.tsx). URL exit 0, 1 advisory (bounce-easing, allowed spring = false positive). Browser: 0 text-contrast failures in all themes/viewports incl. Hyperlegible; Overflow rule 3.53/3.67 (passes); card names exact, no stray commas. Lighthouse a11y 95: label-content-name-mismatch (avatar "LU" vs Account; "Deadline" not in name), skip-link (no #today/#backlog target), target-size (Lighthouse ignores extenders; real 24×32).

## Priority Issues
1. [P1] Today is the busiest column at the same 168px as an empty day: 13 to-dos, less than half visible. Fix: own width for Today (desktop-board.tsx ~191, e.g. --column-today ≈1.5×). Command: distill, adapt.
2. [P1] Phone Lists page hides 4 of 5 lists behind an unannounced swipe. Fix: a peek or list-name strip like the Overflow peek (phone-board.tsx ~427). Command: adapt.
3. [P2] Keyboard path gaps: skip-link hrefs #today/#backlog have no target (script-only; Lighthouse skip-link); focus falls to the page top after Overdrive empties Overflow; no Settings command in ⌘K; Quick sort filed under View (command-registry.ts:265); a hidden "Command palette" h2 sits outside any dialog. Command: harden.
4. [P2] Palette rows drop the year and the to-do's state ("renew passport · Oct 1" = 2027 next to an Overflow "Oct 1" 2026); breaks COMMAND-PALETTE §5. Fix: year-aware formatter in TodoMetaBadges (todo-row-parts.tsx:377), pass roll/Overflow state to palette rows. Command: clarify.
5. [P2] Phone touch targets under 44px: card title 27px, quick-add input 36px, ⚡ 34px, group toggle 23px, day button 28px, brand link 31×20, checkbox 24 wide. Command: adapt.

## Persona Red Flags
Alex: no Settings in ⌘K; noisy fuzzy matches; no year in palette; scrolling inside a 168px Today.
Sam: Won't do conveyed by opacity alone; focus lost after Overdrive; `contextmenu` in help; 10px key glyphs; script-only skip links.
Rory: never finds the other lists on phone; three sign-up asks; grip + rail + checkbox in ~40px at the screen edge; "101 days" can read as a verdict.

## Minor Observations
"In Overflow" repeated on every card (8× on phone Overflow page) — badge could say only the age, full phrase in the name; Won't do toast uses a success check; range heading "Oct 14 – Oct 19" while Oct 20 is visible; sheet priority tab hangs outside the sheet; toast covers the sheet footer; white scrollbar corner in dark mode; "Open Overdrive" stays highlighted for unrelated queries.

## Questions to Consider
1. If Today absorbs every rolled, rescheduled and finished to-do, why is it a column the same size as Sunday rather than a place?
2. Past some age, should "In Overflow 101 days" become "since July"?
3. Should a day's finished work fold into "4 done" so the day's last word is what is left?
