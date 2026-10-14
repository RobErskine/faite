---
target: /board
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx"
target_fingerprint: "sha256:bc25eda2e94f8259fc0b042638bb8b54d752e8080fcdf20cc8a094ab966e5b3b"
target_path: /Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/app/board/page.tsx
timestamp: 2026-10-14T19-57-36Z
slug: src-app-board-page-tsx
---
Method: dual-agent (A: ad5fdb0505c9104cc · B: a028110472a5490a2). Target src/app/board/page.tsx, inspected live on https://myfaite.app/board (same code as branch; no Jean run command, so no local server). Overlay not injected (HTTPS production). Overflow seeded via IndexedDB in a blank profile.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Overflow badge shows the same wrong age on every card; quick-add gives no landing feedback; phone Overflow page header says "Oct 13" |
| 2 | Match System / Real World | 2 | "Dropped" and "todo" leak into UI; "Week ›" reads as a view switch; "4/2/↑3" unexplained |
| 3 | User Control and Freedom | 3 | Undo on toasts, Overdrive step-back, Escape un-stages; no redo by design |
| 4 | Consistency and Standards | 2 | Won't do vs Dropped; Overflow count/rule on desktop only; sheet footer green + second red |
| 5 | Error Prevention | 1 | Quick-add silent misparses: `oct 1` → 2027 (no year shown), `@to-read` unmatched, "about Thursday" eaten as a date |
| 6 | Recognition Rather Than Recall | 2 | Token grammar and tab counts must be remembered; icon-only ⚡, quick-sort, archive |
| 7 | Flexibility and Efficiency | 4 | ⌘K, inline tokens with chip preview, arrow grid, Overdrive keys, saved views |
| 8 | Aesthetic and Minimalist Design | 2 | ~185px chrome; repeated BACKLOG header; priority rails and red pills outweigh titles |
| 9 | Error Recovery | 2 | Undo exists but misparses are never surfaced |
| 10 | Help and Documentation | 3 | ? sheet, welcome dialog, Overflow tooltip, Faite Loop example; 10px kbd in help |
| Total | | 23/40 | Acceptable |

## Design Specificity Verdict
Core board is authored (serif days, mono eyebrows, air columns, spectrum hairline, priority as line style, muted rolled marker). Generic shell around it: to-do sheet and settings read as stock shadcn/SaaS; sign-up banner + black Sign up is a funnel; identical red Overflow pills read as habit-app shaming; tab counts / "View: Todo" / repeated group headers read as a project tool.
Detector: source almost clean (2 advisory font-size in vendored calendar.tsx:93,102). URL + Lighthouse (a11y 91): tab-count contrast 2.3:1 light / 3.07:1 dark (real), placeholder 4.16:1, avatar 4.35:1, no <main>, 3 label-content-name mismatches. False positives: bounce-easing (allowed spring), calendar 0.8rem (vendored). Detector missed every semantic issue (wrong ages, silent misparses).

## Priority Issues
1. [P1] Overflow age badge wrong and red on every card. rollover-events.ts stops at the first overflowed event (rolls = overflowAfterDays + 1); todo-row-parts.tsx:328 renders it. Overflow red rule shows on an empty column (board-column.tsx:778; count at :885 is gated). Fix: age from overflow.since; muted per-card text; red only on column rule/count; gate the rule on todos.length. Command: clarify, quieter.
2. [P1] Quick-add misparses silently (oct 1 → 2027, @to-read unmatched, "about Thursday" → date). Fix: show year when not this year; toast where it landed with jump; fuzzy list match; dashed chip for unmatched @mention. Files: quick-add-preview.tsx, board-column.tsx. Command: harden.
3. [P2] Account nudges stack (welcome modal → per-session yellow banner → black Sign up). Fix: info tone, persistent dismissal (signed-out-banner.tsx, lib/onboarding.ts); outline/ghost Sign up (app-header.tsx). Command: quieter.
4. [P2] Code words in UI: "Dropped" (use-board-actions.ts:377, src/lib/event-time.ts:85), "View: Todo", "Hide todo items", Faite Loop settings copy, "1 to-dos". Command: clarify.
5. [P2] A11y floor: tab counts 2.3:1; add-to-do inputs no focus change; no <main>; hit areas <24px (title buttons 19px, Tab options 16×16, What is Overflow 14×14); red 10px In Overflow text; 5 regions named "Wednesday". Command: audit, harden.

## Persona Red Flags
Alex: Week/Month/Quarter look like view switches; ⌘K root starts with Create/Delete, no recents; silent misparses; 10px kbd.
Sam: ~30 day regions named by weekday; run-together card names; drag description repeated per card; hears "Dropped"; add inputs no focus; first Tab lands in list pane.
Rory (PRODUCT.md audience): red wall of identical ages; phone Overflow hidden left swipe, header says Oct 13 (date-nav.tsx anchorIndex -1); phone Overflow no count/rule; done items hidden so the week shows no progress.

## Minor Observations
Sheet footer green + second red (drift #7); P2 solid rail reads as selection (priority.ts); single-group BACKLOG header; phone "+" overlaps placeholder; toast covers sheet footer ~4s; Hyperlegible clips range title; touch drag grip 12×12, checkbox 22px wide. Collect UI returned only MP4s; no references used.

## Questions to Consider
1. Why does each Overflow card carry its own red pill instead of the column alone?
2. Should done items stay struck on today so the day ends showing what you did?
3. Is "PUT OFF TOO LONG" kind? Would "Waiting for an ending" fit the positioning better?
