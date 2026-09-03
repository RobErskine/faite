# Faite design pass — plan (v3, locked)

## Context

Faite looks like stock shadcn. The board shows a lot at once: Overflow rail, up to 7 day
columns, Backlog rail, tabs, list columns. Every region has the same weight. Owner wants
clear hierarchy, fast findability at scale, and joy. Color must mean something.

Owner's brief (2026-09-03): Notion's utility, MyMind's calm design and whimsy, Casio F-91W
reliability. Snappy and native. Black-and-white cursive F mark stays; a "pop of subtle
color" like the Dia mark is welcome. Users own their list colors (Tomato stays). Keep the
names Backlog and Overflow. Forward-looking only: no past days. 3-day view is the daily
driver, dark theme, Editorial pairing. Cut font pairings from 4 to 2. Confetti stays
opt-in. Animated strike-through on completion. `docs/DESIGN.md` is the spec of record and
must serve the marketing site later.

## Locked decisions

| # | Decision |
|---|---|
| A | Priority rail (card left stripe) becomes achromatic. Thickness + opacity only: P1 3px, P2 2px, P3 1px, P4 1px dotted. Hue removed from `src/lib/priority.ts`. Red now belongs to urgency alone. |
| B | Spectrum = peach → rose → lavender → sky, low chroma. `--spectrum-solid` = lavender ≈ `oklch(0.7 0.1 300)`. |
| C | Two pairings: Hyperlegible (basic) and Editorial (stylized). Precision and Systematic removed. |
| D | Editorial becomes `DEFAULT_FONT_PAIRING` for new accounts. Existing rows keep their stored value. Preload flags move to the Source families in `src/app/fonts.ts`. |

## Audit (facts the work rests on)

- `src/app/globals.css` is the only stylesheet. All `:root`/`.dark` tokens are `oklch(L 0 0)`.
  Only chroma: `--destructive` and an unused `--sidebar-primary` blue.
- Chroma lives in `src/lib/colors.ts` (10 Radix step-9 presets; `wash` 5% / `tint` 12% /
  `edge` 35%), `src/lib/priority.ts` (card rail), `src/lib/celebrate.ts` (confetti).
- Three unregistered banner palettes: `auth/signed-out-banner.tsx` (amber),
  `desktop/update-banner.tsx` (red/amber/sky), `settings/desktop-update-row.tsx` (red).
- `todo-row-parts.tsx:311` hand-rolls the `20` alpha instead of `tint()`.
- No shadow, motion, or surface tokens. No `@keyframes`. No design doc.
- Two label styles inlined ~20 times: `font-heading text-lg font-bold uppercase
  tracking-tight` and `text-2xs font-medium uppercase tracking-wide text-muted-foreground`.
- Font pairing is `z.enum(FONT_PAIRING_IDS)` in `src/lib/schema.ts:584`, synced to the
  server (`server/db/user-schema.ts:216`, `server/sync/upsert.ts:21`). Removing an id needs
  a read-time normalize (pattern: `normalizeTheme()` in `src/lib/theme.ts`).
- Verified (Tailwind docs): `@theme inline` for aliased vars; `--shadow-*`, `--ease-*`,
  `--animate-*` (+ `@keyframes`) generate utilities; `@utility` takes every variant.
  Base UI exposes `data-checked`, `data-open`, `data-starting-style`, `data-ending-style`.
- Dia reference: a spectrum gradient as the only moving element; "things change color,
  not position". MyMind reference: calm, minimal, serif, design-forward.
- Linear conventions (read 2026-09-03): milestones use a letter axis with an em dash
  ("S — Site…", "A — Public API + MCP", "D0 — Spike"). Ticket titles carry the letter
  prefix ("S: …", "D2: …", "A6: …"). Labels in use: `web`, `desktop`, `mobile` (track),
  `improvement`, `enhancement`, `feature`. Statuses: Backlog, Todo, In Progress, In Review, Done.
  No existing design-system ticket. Related shipped: EI-239 (activity feed polish),
  EI-101 (Overdrive feel), EI-192 (completion stamp).

## Color grammar (→ `docs/DESIGN.md`)

| Channel | Means | Where | Never |
|---|---|---|---|
| Identity hue (user-chosen per tab/list, incl. Tomato) | "belongs to X" | wash behind rows, tint on group/tab headers, edge rule under column titles, chips, confetti | on 2xs text; on a card body |
| `--urgent` (= `--destructive`) | "needs a verdict now" | In Overflow badge, missed Deadline, `×N` missed, N due banner, drop-refused outline, Overflow rail edge | the app never adds a second red |
| Priority rail | importance | card left stripe, achromatic thickness | hue |
| `--spectrum` | "Faite, here, now" | F mark on hover/focus, today column top hairline, checked-box flash, focus ring | fills, text, badges |
| `--warning` / `--info` / `--success` | system state | desktop/auth banners, toasts | board content |
| Form (strike, dim) | done / dropped | rows | color |

The spectrum is a hairline and a flash, never a surface.

## Token layer (`src/app/globals.css`)

Keep every shadcn name. Add a thin semantic layer.

`:root` + `.dark`:
- Surfaces: `--surface-sunken` (halves, rails), `--surface-0` (= background), `--surface-1`
  (= card; today column), `--surface-2` (raised: active tab, popover).
- Lines: `--line-faint` (filler rules; replaces `border-border/40`), `--line` (= border),
  `--line-strong` (seam, column title rule).
- `--spectrum`: `linear-gradient(90deg, peach, rose, lavender, sky)`. `--spectrum-solid`.
- `--urgent: var(--destructive)`. `--warning`, `--info`, `--success` + `-foreground` + `-soft`.
- Shadows: `--shadow-card`, `--shadow-raised`, `--shadow-overlay`.
- Motion: `--dur-fast 100ms`, `--dur-base 180ms`, `--dur-slow 260ms`; `--ease-out-soft`,
  `--ease-spring`. Nothing over 260 ms except confetti.
- Delete `--sidebar-primary` blue.

`@theme inline`: `--color-*` for all above, `--shadow-*`, `--ease-*`, `--animate-check`,
`--animate-strike`, `--animate-settle` (+ keyframes).

`@utility`: `type-column-title`, `type-eyebrow`, `hairline-spectrum`.

## Linear: milestone and tickets (create in build mode, in this order)

Milestone: **"V — Visual design system"** in project Faite. Description: the brief above in
three sentences, plus "Letter axis like S, A, D, M — not P8." Target date: none.

Tickets, team Erskine Interactive, project Faite, milestone V, status Todo, labels
`web` + `improvement`, assignee me. Each description = the phase row below plus its check.
V1–V6 `blockedBy` the previous ticket.

| Key | Title | Scope | Files | Check |
|---|---|---|---|---|
| V0 | V0: `docs/DESIGN.md` — color grammar, type roles, surfaces, motion policy | Grammar table, type roles, surface tiers, motion policy (reduced-motion honoured, no gamification per RESEARCH.md), "for the marketing site" section. Link from `docs/README.md` and `TODO-ITEM-DESIGN.md` §10. Record decisions A–D. | docs only | review |
| V1 | V1: Semantic token layer over shadcn — surfaces, lines, spectrum, status, shadow, motion | Tokens per above. Migrate 3 banners to `bg-warning-soft` etc. `tint(label.color)` at `todo-row-parts.tsx:311`. Remove sidebar blue. | `globals.css`, 3 banners, `todo-row-parts.tsx` | `npm run typecheck && npm test`; screenshot both themes |
| V2 | V2: Type roles as utilities; cut font pairings to Hyperlegible + Editorial; Editorial default | Two `@utility`s replace ~20 inline sites. `FONT_PAIRINGS` → two. `normalizeFontPairing()` in `lib/fonts.ts` maps removed ids to default; used by schema parse, layout inline script, settings. Drop unused `next/font` loads; move preload to Source families. `DEFAULT_FONT_PAIRING = "editorial"`. Update tests that name pairings. | `globals.css`, `lib/fonts.ts`, `app/fonts.ts`, `app/layout.tsx`, `lib/schema.ts`, `settings/font-pairing-field.tsx`, `board-column.tsx`, `weekend-column.tsx`, `tab-strip.tsx`, `split-strip.tsx`, `create-list-column.tsx`, `app-header.tsx`, sheets, tests | `npm run e2e:ci`; both pairings; a stored `"precision"` row still opens in default |
| V3 | V3: Board structure — today hero, surface tiers, Overflow as pressure, tab counts, F mark | Today column: `bg-surface-1`, `hairline-spectrum` top, title `--foreground`. Other days `bg-surface-0`. Halves `bg-surface-sunken`, seam `border-line-strong`. Overflow rail: `--urgent` edge + count. Backlog: quiet, `type-eyebrow`. Tab strip: active `bg-surface-2 shadow-card`; counts keep `X/Y/Z`, third gets `↑` glyph, tooltip stays. Header search reads as search. F mark hover/focus reveals `--spectrum`. | `desktop-board.tsx`, `board-column.tsx:685-840`, `tab-strip.tsx:293-390`, `app-header.tsx`, `date-nav.tsx` | e2e:ci; drag smoke; 1/3/5/7 days; desktop + tablet |
| V4 | V4: Row and badges — urgent vs meta families, achromatic priority rail, surface-token states | Badge families: neutral meta (outline) vs `urgent`. DUE banner on `--urgent`. Label chips via `tint`/`edge`. Checkbox and hover/selected on surface tokens. `PRIORITY_RAILS` → achromatic thickness/opacity; P4 dotted; update `priority.test`. | `todo-row-parts.tsx`, `todo-card.tsx`, `ui/badge.tsx`, `ui/checkbox.tsx`, `lib/priority.ts` | unit + e2e:ci |
| V5 | V5: Motion — animated strike, check flash, drop settle, Overdrive card-in | (a) Strike: `::after` on `[data-todo-title]` scales from left over `--dur-base` on the open→done transition only. (b) Checkbox `data-checked` fill + one `--spectrum-solid` ring flash. (c) `animate-settle` on drop landing. (d) Tab underline transition. (e) Overdrive: short scale-in of the next card. All `motion-reduce:animate-none`. Remove dead `data-[state=delayed-open]` in `ui/tooltip.tsx:53`. | `ui/checkbox.tsx`, `todo-card.tsx`, `tab-strip.tsx`, `overdrive-overlay.tsx`, `ui/tooltip.tsx`, `globals.css` | e2e:ci; reduced-motion test; done rows do not animate on mount |
| V6 | V6: Audit — 2 pairings × 2 themes × 1/3/5/7 days × desktop/tablet/phone, contrast, DESIGN.md sync | Screenshot matrix. Contrast ≥ 4.5:1 body, ≥ 3:1 2xs. Phone must not regress (M4–M6 stay paused). Fix drift; update `docs/DESIGN.md`. | any | Playwright screenshots; manual pass |

Highest-leverage single change: V3.

## Worktree (build mode, after tickets exist)

1. `get_current_context` → sessionId, projectId.
2. `create_worktree` with `customName: "design-system"`, `baseBranch: "main"`. Do not pass
   `linearIssueIdentifier` (Jean has no Linear key).
3. Rename the git branch to V0's `gitBranchName` before first push (Jean drops the slash).
4. `move_session` this session into the worktree.
5. Each later phase: fetch + rebase main, branch to that ticket's `gitBranchName`, PR, squash.

## Hard constraints

- e2e uses accessible names, no `data-testid`. Backlog and Overflow keep their names. No
  other visible label changes without an `e2e/*.spec.ts` update. `npm run e2e:ci` is the gate.
- Priority rail is not `border-l`. Row is not a flex container. Group headers not sticky.
  Wash on the container, not the card. `pager-column` gets no `touch-action`.
- `lib/colors.ts`, `lib/priority.ts`, `lib/fonts.ts` stay import-free and DOM-free.
- tailwind-merge does not see inside `@utility`; verify override order once (`.ai/lessons.md:354`).
- No streaks, no progress gamification (`docs/RESEARCH.md` §2.9, §4).
- Sonner / BlockNote overrides stay unlayered CSS.
- Strike animation keys on a status transition, not on `status === "done"`.
- Each PR: Conventional Commit with ticket scope, squash merge, `.ai/todo.md` log entry.

## Verification

1. `npm run typecheck && npm test` after each phase; re-run typecheck right before push.
2. `npm run e2e:ci` per PR (CI=1, prod server on :3100 locally); full `npm run e2e` before V3 and V6.
3. Visual pass in the Jean run environment (`get_run_environments`), both themes, both
   pairings, 1/3/5/7 days. Compare against the 2026-09-03 screenshot.
4. V2: seed `fontPairing: "precision"`; board loads in Editorial.
5. V5: toggle a to-do done; strike draws once; reload; no animation on mount.
