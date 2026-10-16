---
target: the to-do row
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/components/board/todo-card.tsx"
target_fingerprint: "sha256:ff208eb7a727dd426a90d3c10538ecf759cb8843aa47b871d71c203c102f3797"
target_path: /Users/roberskine/jean/faite/rob_ei-350-design-pass-2-board-critique-audit-with-impeccable-then-fix/src/components/board/todo-card.tsx
timestamp: 2026-10-15T16-14-45Z
slug: src-components-board-todo-card-tsx
closed: true
---
Method: dual-agent (A: a7ae7eac3faf765d1 · B: a21d57b74e5667c0a). Target src/components/board/todo-card.tsx (+ todo-row-parts.tsx, overdrive-card.tsx, ui/checkbox.tsx) at origin/main 90709eb, live on https://myfaite.app/board. Specimen rows seeded in a blank profile.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Completing in the default view gives no on-row feedback (row unmounts in ~90ms) |
| 2 | Match System / Real World | 3 | A time wears a bell icon; "Unfiled" (⌘K) vs "Backlog" (Overdrive) |
| 3 | User Control and Freedom | 3 | Undo, Won't do as an ending, menu, Escape |
| 4 | Consistency and Standards | 2 | Row assembled four ways (board, Overdrive, ⌘K, drag chip); two focus styles; mono+sans inside one badge; two near-identical calendar icons; Repeat icon has two meanings |
| 5 | Error Prevention | 3 | Checkbox clear of the grip; 44px phone rows |
| 6 | Recognition Rather Than Recall | 2 | Future deadline date, location, roll origin, repeat rule are hover-only; unreachable on touch |
| 7 | Flexibility and Efficiency | 4 | Arrow nav, Space, x, keyboard drag, ⌘K actions |
| 8 | Aesthetic and Minimalist Design | 3 | Calm at rest; kitchen-sink rows get loud, meta outweighs title at 168px |
| 9 | Error Recovery | 3 | Missed deadline clear, named "overdue by N days" |
| 10 | Help and Documentation | 3 | Tooltips on every glyph, pointer-only |
| Total | | 29/40 | Good |

## Design Specificity Verdict
Mostly Faite's own row: the line-style rail, the hanging indent, the quiet ↳, the muted "since … · N days". Slides toward generic via full-pill outline badges, saturated label chips, 10px typewriter-mono numerals, and the stock shadcn checkbox focus ring. Detector: 0 findings (purple check disabled by DESIGN.md's lavender).

## Priority Issues
1. [P1] The completion moment never plays in the default view: the card unmounts in the same render that marks it done, so `justCompleted` never fires (todo-card.tsx ~295–306); the strike is instant; `animate-strike`/`animate-settle` are defined (globals.css ~252–253) but unused; the check flash springs `box-shadow`, against DESIGN §4 (springs on transform only). Fix: keep a just-completed row mounted for one beat (flash, drawn strike), then leave; settle with a transform in View: All. Command: animate.
2. [P1] Contrast: label chip text 1.6–3.9:1 at 10px (raw hue as text, todo-row-parts.tsx ~509–513); Won't do title 2.71 light / 3.92 dark (muted ink × opacity-70, todo-card.tsx ~743); done title on hover 4.27; Overflow age on hover 4.1. Fix: label text in an ink that passes (hue on tint/edge only, or text-xs); Won't do dim via a single passing ink (still dim-only, owner decision). Command: harden.
3. [P2] States: the hover wash never animates — every row carries an inline `transition: transform linear` from the sortable wiring that overrides it; the checkbox focus ring is shadcn's `ring-3 ring-ring/50` (1.97:1), not the shared `focus-ring`; title focus outline encloses the checkbox. Command: polish.
4. [P2] Badge grammar: `num` mono on phrases (reminder "☕ Afternoon", "Deadline Oct 12" mixes sans and mono); 10px vs 12px badges; scheduled (CalendarClock) vs deadline (CalendarCheck) indistinguishable; Repeat icon means "recurring" and "missed ×N"; title glyphs muted 12px vs badge icons full-ink; no order of importance (the red Deadline comes 4th). Fix: `nums` on phrases, one size and ink rule, distinct icons, order verdict → when → progress → identity. Command: typeset.
5. [P2] The row differs by surface: Overdrive lacks rail, ↳, pin, future deadline, sub-task/attachment counts; ⌘K drops sub-tasks/attachments; drag chip lacks deadline glyph and ↳; "Unfiled" vs "Backlog". Fix: one anatomy contract rendered everywhere, density varies. Command: distill.

## Persona Red Flags
Alex: checkbox focus is a faint halo; title focus outline encloses the checkbox.
Sam: label text 1.6:1; Won't do 2.71:1; 10px mono in Hyperlegible; 3-line clamp at 168px.
Rory: glyph tooltips (deadline date, location, roll origin, repeat rule) unreachable on touch; phone grip dots touch the P3/P4 rail.

## Minor Observations
Rail stays full strength on settled rows; grip target 9×24 (checkbox extender takes 3px); rolled tooltip "Rolled from Oct 14 - 1 day" uses a hyphen; recurring "×N missed" in red reads like a reverse streak; phone rail flush with the screen edge; drag chip truncates to one line; done checkbox fill is the heaviest ink in a settled row; stale comments (grip top-2.5 vs top-3; checkbox top-2/py-1.5 vs top-2.5/py-2); recurring occurrence rows may drop deadline/attachment/sub-task badges.

## Questions to Consider
1. What if every glyph moved into the meta line so every title starts at the same x?
2. Should a deadline inside the visible week read as words ("due Thu") rather than a hover glyph?
3. Is a red "×6 missed" a streak counter with the sign flipped?
