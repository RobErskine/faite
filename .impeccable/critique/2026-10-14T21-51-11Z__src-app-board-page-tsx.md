---
target: /board
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx"
target_fingerprint: "sha256:bc25eda2e94f8259fc0b042638bb8b54d752e8080fcdf20cc8a094ab966e5b3b"
target_path: /Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx
timestamp: 2026-10-14T21-51-11Z
slug: src-app-board-page-tsx
---
Method: dual-agent (A: ad66f35c69251779d · B: a1d06bd7949225f70). Target src/app/board/page.tsx at origin/main eb6870a, live on https://myfaite.app/board after EI-374..EI-378. Overlay not injected (HTTPS production). Rolled/Overflow cards seeded via IndexedDB in a blank profile.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Toasts say where a to-do landed; finished rolled cards leave today (placeSettled, by design); header range disagrees with a clipped 7th column |
| 2 | Match System / Real World | 3 | "Waiting for an ending", "Won't do" land; "None" rolls, "Entry threshold", 4/3/↑8, raw `contextmenu` in help do not |
| 3 | User Control and Freedom | 3 | Undo everywhere; Overdrive Undo toast outlives the overlay (OVERDRIVE.md §7a says it closes) |
| 4 | Consistency and Standards | 3 | Triage chords shared across sheet/menu/palette/Overdrive; ↳ means both rolled and in Overflow; Overdrive filed under View in ⌘K |
| 5 | Error Prevention | 2 | Mid-sentence weekday parsed (owner's rule, dismissible chip); a leading "oct 1" is ignored with no sign; "None" reads as never |
| 6 | Recognition Rather Than Recall | 2 | Tab counts, unlabeled ⚡, phone pager with no page indicator |
| 7 | Flexibility and Efficiency | 3 | Deep keyboard; no skip link; Backlog quick-add 135 Tab stops away |
| 8 | Aesthetic and Minimalist Design | 3 | Air pass works; 4 group headers on today for 6 cards; gray scrollbars heaviest marks |
| 9 | Error Recovery | 2 | Ignored dates and misparses not explained; Undo only |
| 10 | Help and Documentation | 3 | Welcome, Overflow (i), live Loop example, ? sheet (52 rows, 10px kbd) |
| Total | | 27/40 | Good |

## Design Specificity Verdict
Specific (~7.5/10): achromatic page with one red, priority as line style, serif column titles, spectrum hairline on today only. Leftovers: stock Badge ring classes on the Overflow-age badge, a ten-field to-do sheet, debug-looking tab counts, mono spreading into sentences ("In Overflow 39 days" set in mono).
Detector: source exit 0, 2 advisory (vendored calendar.tsx:93,102). URL exit 0, 1 advisory (bounce-easing, allowed spring = false positive). Browser: 0 text-contrast failures in light/dark/desktop/phone (was 3); one non-text failure — Overflow header red rule at 40% alpha 2.09:1 light / 1.98:1 dark. Lighthouse a11y 96 (was 91): target-size (checkbox 22×30 effective), label-content-name-mismatch (avatar, zero weight). Exactly one <main>; first Tab now lands in the header area (banner Sign up). No skip link.

## Confirmed fixed (from run 1)
Overflow ages differ per card and are muted; red only on column rule/count; "Waiting for an ending"; quick-add toast says where it landed; banner info tone, stays dismissed; "Won't do" toast; tab counts/placeholder/avatar/grips pass contrast; one <main>; dated day regions.

## Priority Issues
1. [P1, product decision] Finished rolled/Overflow work vanishes from today: placeSettled (src/lib/board.ts:807) places settled work on its original scheduledDate (deliberate, TODO-ITEM-DESIGN §3). Rory completes mostly rolled cards, so today shows nothing done. Option: place on completedAt day when inside the window, tooltip "Done today · planned Oct 12". Command: harden.
2. [P2] Small red and thin red fail contrast: missed-deadline badge red 10px 3.97:1 (todo-row-parts.tsx ~367); Overflow red rule 2.09:1 non-text (board-column.tsx border-urgent/40). Hyperlegible keeps 10px text. Command: audit, typeset.
3. [P2] Keyboard/SR navigation cost: no skip link; today region lacks "Today"; rolled-card names lead with the countdown; card names carry stray " ," fragments (regression from EI-378's hidden separators). Command: audit.
4. [P2] Quick-add trust gaps left: leading date ("oct 1 renew passport") is ignored with no sign; second date word dropped (EI-379); "10am" sets a reminder. Command: harden.
5. [P2] Recall load: rolls "None" means 0; ↳ for rolled and Overflow age; tab counts; unlabeled ⚡; phone pager indicator; ⌘K puts Delete above Overdrive. Command: clarify.

## Persona Red Flags
Alex: unranked ⌘K; @mention needs two Enters; Overdrive buttons shift ~45px when scheduling is staged; no Backlog chord.
Sam: no skip link; 37 regions; countdown-first names; stray commas; Overdrive toast live after close; help shows `contextmenu`.
Rory: completions vanish from today; 7th column clipped at 1440; Overflow grouped by list, not age; countdown framing in tooltips.

## Minor Observations
Priority control hangs outside the sheet's left edge (todo-sheet.tsx:763); toast covers sheet footer; Overdrive card width jumps per title; dark scrollbar corner white; Overflow header scrolls away; empty Overflow says "No items" next to "Collapse Overflow"; History subtitle "on a past day" over today; Hyperlegible description "maximum character clarity" (fonts.ts:27) brushes against "do not claim proven"; TODO-ITEM-DESIGN.md:388 says "There is no history view" (stale).

## Questions to Consider
1. If the claim is honest endings, why does the day you ended things show nothing?
2. Is Overflow a place or a queue? Should it sort oldest-first with the longest wait stated once?
3. A rolled card looks forgiven but counts down to Overflow in its tooltip and name. Is a countdown kind?
