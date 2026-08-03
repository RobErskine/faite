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
