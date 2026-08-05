# Lessons

## Verify deploys with a real request, not the deploy output

`wrangler deploy` reported success and printed both bindings, but the first
`curl` returned 404 with `error code: 1042`. That looked like a worker-fetch
loop. It was propagation lag — the same URL returned 200 moments later.

**Rule:** after deploying, poll the URL before concluding anything is broken,
and re-test once before chasing a root cause. Equally: never report a deploy as
working on the strength of the deploy command's own output.

## Don't grep for content you assumed was there

Checked the deployed page for "Get started by editing" and got 0 matches, which
briefly read as a broken render. The page was fine; the Next 16 scaffold's copy
simply differs. The header/CSS/hydration chunks were the real evidence.

**Rule:** when verifying a rendered page, assert on structural markers
(doctype, stylesheet links, hydration chunks) rather than guessed copy.

## Re-survey before editing when other work may be in flight

Mid-session, `schema.ts`, `app-header.tsx`, and several new files
(`profile.ts`, `theme.ts`, `user-avatar.tsx`) had all changed since the
plan-mode read — a profile/avatar/theme feature was being built concurrently
in the same working tree. Editing `app-header.tsx` from the stale read would
have clobbered that work.

**Rule:** before editing a file in a long session, especially one touched by
plan-mode exploration much earlier, re-read it if there's any chance of
concurrent edits (system reminders noting a file "modified by the user" are
the tell). Cheap insurance against expensive collisions.

## A generated config file can leak scope into an unrelated tsconfig

`wrangler types` emitted `cloudflare-env.d.ts` at the repo root with a
`typeof import(...)` reference to the Workers-only entry point. Because it
matched the main tsconfig's broad `**/*.ts` include glob, it pulled
Workers-runtime code (and its unresolvable `open-next/worker` import) into
the Next app's typecheck — despite that code's own directory being correctly
excluded.

**Rule:** when a code generator drops a file at the project root, check what
it *references*, not just where it lives — a `.d.ts` two directories away from
an excluded folder can still reach into it via a type-only import and widen
what "excluded" actually excludes.
