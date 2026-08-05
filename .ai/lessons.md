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

## Read the warnings *after* a successful deploy, not just the error path

Adding `routes` to `wrangler.jsonc` silently flipped two unrelated defaults
off: `workers_dev` (so the old `*.workers.dev` URL began 404ing immediately)
and `preview_urls` (which would have broken per-branch preview deploys later,
at a moment with no obvious connection to this change). Both were disclosed
only in warnings printed *below* the "Deployed / Current Version ID" success
lines, where a skim stops.

**Rule:** on any deploy that changed configuration, read to the very bottom of
the output. Success lines are not the end of the message, and Cloudflare's
"because X is not in your config, it will be disabled by default" notices are
the kind that surface as a mystery bug weeks later.

## Retry a just-provisioned cloud service once before diagnosing it

`wrangler email sending send` failed with
`email.sending.error.email.sending_disabled [code: 10203]` about 30 seconds
after `wrangler email sending enable` reported success — and succeeded on a
plain retry with nothing changed. The domain was onboarded; the account-level
quota simply had not propagated. Worse, `wrangler email sending dns get`
happily listed all the DNS records throughout, which reads as "ready."

**Rule:** the same lesson as the post-deploy 404 above, generalized — when a
resource was provisioned seconds ago, retry once before believing an error.
And prefer a state endpoint over an output listing when checking readiness:
`GET /accounts/{id}/email/sending/limits` returning a real quota rather than
`null` was the honest signal.

## A shared module must have zero DOM-only bindings anywhere in the file

`src/server/sync/apply-patch.ts` (Workers code) imported only `compareHlc`
from `src/lib/sync/hlc.ts`, but `tsc -p tsconfig.worker.json` still failed on
`localStorage`, which lived in a *different* function in that same file
(`getNodeId`). `tsc` type-checks a whole imported file under the importing
project's `lib` config, not just the specific bindings actually used — so one
DOM-only reference anywhere in a module poisons it for every importer with a
DOM-less `lib`.

**Rule:** before sharing a "pure" module between client and Workers code,
grep the whole file for globals the Workers `lib` config won't have
(`localStorage`, `window`, `document`, etc.), not just the exports the new
importer needs. If any exist, split the file — pure logic in one module,
environment-touching accessors in a sibling that re-exports the pure module's
surface, same pattern as `hlc-core.ts` / `hlc.ts` here.

## `wrangler deploy --dry-run` catches what `tsc` and `next build` can't

Neither `npm run build` nor `build:static` actually bundles the Workers
entry (`src/server/worker.ts`) through wrangler's esbuild — they're pure
Next builds and never touch `drizzle-orm/durable-sqlite`-style
Workers-runtime imports. `tsc -p tsconfig.worker.json` only checks *types*,
not whether the bundler can actually resolve everything. A `--dry-run` deploy
doesn't publish or touch live infra, so it's safe to run any time, and it's
the only step in this repo's verification list that actually proves a new
`src/server` module bundles.

**Rule:** after any change under `src/server` that adds a new import (not
just edits existing ones), run `npx wrangler deploy --dry-run` once before
calling the change verified — it's free and it's the only check that exercises
the real bundler.
