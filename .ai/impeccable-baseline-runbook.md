# Impeccable design pass — setup record and baseline

Epic [EI-348](https://linear.app/rob-erskine/issue/EI-348). This file is the
handoff from setup (EI-349) to the two review tickets: `/board`
([EI-350](https://linear.app/rob-erskine/issue/EI-350)) and the marketing
site ([EI-351](https://linear.app/rob-erskine/issue/EI-351)). Point-in-time;
recorded 2026-10-08 against `main` @ `7c510ee`.

## 1. What is installed, and where

| Piece | Where | Committed? |
|---|---|---|
| Impeccable skill 4.5.1, CLI 4.1.0, engine 0.1.12 | `~/.claude/skills/impeccable/` (global install, Claude Code only) | No — per machine |
| Impeccable sub-agents (documenter, finish reviewer, asset producer, manual-edit applier) | `~/.claude/agents/impeccable-*.md` | No |
| Design hook (SessionStart, PostToolUse on Edit/Write, Stop) | `.claude/settings.local.json` in **each checkout** | No — gitignored by `~/.config/git/ignore` |
| Product record | `PRODUCT.md` | Yes |
| Token mirror of `docs/DESIGN.md` | `DESIGN.md`, `.impeccable/design.json` | Yes |
| Build path, detector ignores | `.impeccable/config.json` | Yes |
| Live-mode wiring (`src/app/layout.tsx`, no CSP in the project) | `.impeccable/live/config.json` | Yes |
| Surface briefs | `.impeccable/surfaces/src-app-board-page-tsx.md`, `src-app-page-tsx.md` | Yes |

**The global install does not add the hook to every project.** The installer
wrote the hook only into the checkout it ran in. To get it in another checkout
(the primary `~/Sites/faite`, or a new worktree), run
`npx impeccable install --providers=claude --scope=global -y` from that
checkout, or copy `.claude/settings.local.json` across.

**`buildPath` is `comp`.** Impeccable builds app screens code-first whatever
this says; the value only changes landing and showcase pages. So `/board` stays
code-first and the marketing site gets a mockup first. Image generation is the
OpenAI API fallback (`gpt-image-2.5-flare`), keyed from `OPENAI_API_KEY` in
`~/.zshenv`; each comp and each revision is a billed request.

## 2. Detector baseline

`impeccable detect`, 59 deterministic rules. **Source** (`src/app`,
`src/components`): 0 anti-patterns, 3 advisory notes. **Rendered**
(`https://myfaite.app`, same code as `main`, empty board, system theme):

| Page | Findings (count) |
|---|---|
| `/` | undersized-ui-text (5, the `/6` step counter at 10px), skipped-heading (h1 → h3 "Overflow" in the demo board), nested-cards (1), em-dash-overuse (18), repeating-stripes-gradient (1) |
| `/board` | low-contrast (1: `#707070` on `#262626`, 3.1:1, dark theme) |
| `/about` | line-length (3, ~108 chars) |
| `/help` | line-length (6, ~106 chars), em-dash-overuse (12) |
| `/download` | line-length (4, ~106 chars) |
| `/docs` | undersized-ui-text (27, the 10px `GET`/`POST` method chips), low-contrast (1 at 3.9:1 red on dark; 5 advisory at 4.2:1), tight-leading (1, 1.14×), em-dash-overuse (87) |
| `/login` | clean |

Every page also reports `bounce-easing` for `--ease-spring`. That is
deliberate (`docs/DESIGN.md` §4: springs only on centered things, removed
under reduced motion), and it is ignored for `src/app/globals.css` in
`.impeccable/config.json`. Test files are ignored too (fixture colors).

Remaining source advisories, not yet decided: `border-radius: 1px` on the tab
travel indicator (`globals.css`, a pill on a 2px line), and `text-[0.8rem]`
in `src/components/ui/calendar.tsx` (shadcn default, off the type ramp).

A clean detector run is evidence, not proof. EI-350/EI-351 still need
`/impeccable critique` and `/impeccable audit`, which look at the render.

## 3. Drift between `docs/DESIGN.md` and the code

Found while generating `DESIGN.md`. Item 1 is fixed in EI-349 (a stale doc
row). The rest are design questions for EI-350.

| # | Drift | Where | Decide in |
|---|---|---|---|
| 1 | ~~§1 said priority rails were 3/2/1/1px; code and §7 say double/solid/dashed/dotted at 5/3/2/2px~~ **Fixed** | `docs/DESIGN.md` §1 | EI-349 |
| 2 | `animate-strike` and `animate-settle` are defined and listed in §4 but no component uses them; the strike is a plain `line-through` | `globals.css`, §4 | EI-350 (overlaps EI-270) |
| 3 | `--dur-sheet` (490 ms) exists only in CSS; `--dur-travel`, `--dur-overlay`, `--dur-overlay-exit`, `--ease-spring-overlay` are in §4 prose but not its table; §6 still says "nothing runs longer than 260 ms" though §7 (2026-09-09) limits arrival, not total time | `globals.css`, §4, §6 | EI-350 |
| 4 | §3 says overlay radius is "outer = inner + p-5" (≈28–30px); code uses `rounded-3xl` (22px) | §3, dialog/sheet | EI-350 |
| 5 | Input, checkbox, badge and tab triggers use shadcn's `ring-3 ring-ring/50`, not the shared `focus-ring`; the CSS comment says "one focus treatment for the whole board" | `src/components/ui/*` | EI-350 |
| 6 | §1 says the spectrum is never a text color, yet the F mark is `text-spectrum` (one of its four places) | §1 | EI-350 (wording) |
| 7 | `button.tsx` has a green `success` variant ("Mark done" in the to-do sheet); §1 keeps status colors off board content | `src/components/ui/button.tsx` | EI-350 |

## 4. Next steps

1. **EI-350 (`/board`).** In a checkout with the hook: `/impeccable critique
   /board`, then `/impeccable audit /board`, desktop and phone, both themes,
   both font pairings. Start from §2 and §3 above. Fold EI-271 into it.
2. **EI-351 (marketing).** `/impeccable critique /` and `audit`, then the
   Read pages. Line length and the `/docs` 10px chips are the obvious first
   fixes. A redesign of `/` (not a refinement) is a decision for Rob first.
3. **EI-352 (iOS handoff).** After EI-350 lands: the frontmatter of
   `DESIGN.md` plus `.impeccable/design.json` is the token set to port.
4. Confirm or rename the North Star in `DESIGN.md` ("The Calm Instrument").
