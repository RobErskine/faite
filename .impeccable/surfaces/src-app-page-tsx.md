---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/about/page.tsx","src/app/help/page.tsx","src/app/docs/page.tsx","src/app/download/page.tsx","src/app/login/page.tsx"]
---

# Surface: the marketing site (logged-out)

## Scope and mode

**Mode: Persuade** for `/` (the homepage story) and `/download`. **Read** for
`/about`, `/help`, `/support`, `/contact`, `/docs` (API reference),
`/colophon`, `/privacy`, `/terms`. The auth pages (`/login`, `/signup`,
password reset, verify email, signed out) are **Operate**. Components:
`src/components/marketing/**`, `src/components/scene/**` (the 3D room),
`src/components/auth/auth-shell.tsx`.

## Audience and job

A cold-cache stranger who has never seen Faite. Within one viewport they must
know what it is (a weekly planner where you plan around your days), why it is
different (rolling over is fine; Won't do is an honest ending), and what to do
(open the board, free and offline, no account).

## Primary action

"Open the board (free and offline)". "Create an account to sync" is second
on purpose.

## Proof and content

- The six story beats in `STORY_BEATS` (`src/lib/story-beats.ts`) are the
  single source of the homepage copy, ticks, camera and room. Change the
  table, not a component.
- Claims come only from `docs/RESEARCH.md` §2; §4 is the banned list.
- The demo board shows only features the product has; screenshots are
  captures, not mockups.
- No testimonials, logos, user counts or "N% of to-dos" claims exist; never
  invent them.

## Constraints for this surface

- `demo-board.tsx` and `story-panel.tsx` ship zero client JS
  (`src/components/marketing/demo-board.test.ts`).
- Scene assets stay out of the app-shell bundle; scroll drives the camera
  through a ref, never React state (`docs/SCENE.md`).
- The page reads fully with no JavaScript and no WebGL.
- `docs/DESIGN.md` §6: no brand color beyond the spectrum, no hero gradient,
  no third font, no streak or percent claims.
- CC-BY credits stay reachable on `/colophon`.
- Comp-first is allowed here (OpenAI key on the owner's machine); each comp
  and revision is a billed request.

## Memorable moment (incumbent)

The card "Plan living room move" checks off its sub-tasks as you scroll while
the 3D room does the same thing. Keep the mechanism; any redesign starts by
asking whether it still proves the product.

## Unresolved

- Voice is not yet written down (`docs/CONTENT.md`).
- Whether a redesign of `/` is in scope, or only refinement of the incumbent.
