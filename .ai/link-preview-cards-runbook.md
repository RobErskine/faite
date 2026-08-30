# Link preview cards in the Notes field

**Linear ticket:** [EI-248](https://linear.app/rob-erskine/issue/EI-248/link-preview-cards-in-the-notes-field-with-a-cardinline-toggle)
**Follow-up:** [EI-249](https://linear.app/rob-erskine/issue/EI-249/a-dev-bootstrap-script-for-new-worktrees-migrate-verified-test-user) — dev-bootstrap script for new worktrees
**Project:** [Faite](https://linear.app/rob-erskine/project/faite-160dae949d0f) — correction: the original draft
linked "Pointer" (an unrelated Pebble-ring MCP-router project), a mistake from
an earlier session.
**Branch:** `rob/link-preview-cards` (from `main`)
**Worktree:** `/Users/roberskine/jean/faite/rob_link-preview-cards`

> Feature runbook. The project-wide build log is `.ai/todo.md` — do not overwrite it.

---

## Context

The Notes field in the todo detail pane (`MarkdownField` → BlockNote) renders a
pasted URL as a plain inline `<a>`. We want a richer option: render the link as
a preview card (title, description, site name, image), with a UI control to
toggle a given link between **card** and **inline**.

Day Notes (`src/components/board/day-sheet.tsx:197`) use the same
`MarkdownField`, so the feature lands there for free.

### Why not `@ldlfylt/link-preview-card`

Rob linked <https://github.com/Ldlfylt-LDDL/link-preview-card> as the starting
point. We evaluated it and rejected it:

- 1 star, 4 downloads a week, a single `0.1.0` publish, no commits since
  2025-08-01.
- Its documented `refresh` cache prop is declared in `LinkPreviewProps` but the
  code never reads it — every render makes a live network fetch.
- Its README already contradicts its own types (3 documented themes, 6 in the
  type).
- It *is* Workers-safe (regex + native `fetch`, zero runtime deps), but it only
  saves ~40 lines that Cloudflare's built-in `HTMLRewriter` does better, and we
  would still have to write the cache and the SSRF guard ourselves.

Every popular alternative (`open-graph-scraper`, `link-preview-js`,
`metascraper`) depends on `undici` and cannot run on Workers. `unfurl.js` was
archived by its owner on 2026-06-12. So: our own card, our own fetcher.

### Decisions Rob made (2026-08-29)

1. **Paste behaviour:** explicit only. Pasting gives an inline link; you press
   **Card** to convert. No auto-card on paste.
2. **`og:image`:** load straight from the remote origin with
   `referrerPolicy="no-referrer"`. No Worker image proxy in v1.
3. **Offline / link rot:** fetch on view, cached server-side. No stored
   metadata, no new synced entity, no schema migration. Rob's words: *"I don't
   want this to be a heavy overhead."*

---

## The hard part: markdown round-trip

**STATUS: resolved. Step 0 is done — see `src/lib/link-preview-markdown.ts`
and `src/components/ui/link-preview-block.test.tsx` (9 tests, green).** The
rest of this section is now a record of two convention proposals that turned
out to be dead ends, kept because the next person WILL think of them again.

`MarkdownField` stores **lossy markdown**, not BlockNote JSON — a deliberate
decision documented at `src/components/ui/markdown-field.tsx:6-18`. That comment
also says *"this app defines no custom blocks, so nothing we can author is
lost."* This change breaks that clause and must update it.

### Dead end 1: `[url](url)` == card

The original convention: a link whose text equals its href is a card. **Wrong
— disproven by reading the installed source, not by testing.** BlockNote
0.53's exporter (`node_modules/@blocknote/core/src/api/exporters/markdown/htmlToMarkdown.ts`,
`formatLink`) collapses `text === href` to a **bare URL**, not `[url](url)`,
citing `TypeCellOS/BlockNote#2661`:

> when the link label equals the URL (or is empty), emit the bare URL so that
> pasting the link into another input produces a valid href instead of
> `<url>`-autolink brackets or redundant `[url](url)` markup.

There is no markdown shape left to hang a "card" flag on. Worse, it would
have contradicted Decision 1: every pasted autolink has `text === href`, so
every paste would have become a card immediately, and every link already
stored by any user would silently become a card the day this shipped.

### Dead end 2: a `linkPreview` block round-tripping via its own `toExternalHTML`/`parse`

The documented fallback — a ```linkcard fenced code block, recognised by a
custom block's own `parse` rule — is *also* a dead end, for a reason that
only shows up empirically. BlockNote's markdown tokenizer hardcodes fenced
code as `<pre><code data-language="...">` for **every** language string
(`api/parsers/markdown/markdownToHtml.ts`), and the built-in `codeBlock`
block's `parse` rule unconditionally claims any `<pre><code>` regardless of
`data-language` (`blocks/Code/block.ts`). A custom `linkPreview` block
registered the ordinary way loses that race every time: a stored
` ```linkcard ` fence comes back as a plain code block, not a card.

The instinct — give the custom block's parse rule a higher priority — does
not work through the public API. There are two unrelated "priority" concepts
here and it is easy to reach for the wrong one:

- **ProseMirror's `ParseRule.priority`** (`prosemirror-model`'s
  `DOMParser.schemaRules`), default 50, ties broken by node registration
  order — the one that actually governs which rule wins. BlockNote's
  `getParseRules` (`schema/blocks/createSpec.ts`) never sets this field on
  the rule it builds, and no public option exposes it.
- **Tiptap's `Node.create({ priority })`**, default 100, used by
  `sortExtensions` to order config-field *merging* across extensions sharing
  a name. `createBlockSpec`'s 4th argument threads into this field. It does
  **not** reorder `schema.nodes`, and `DOMParser.schemaRules` never reads it
  — confirmed empirically with a debug script dumping
  `editor.pmSchema.nodes` key order at priority 60, 110, and unset: identical
  order every time, `linkPreview` always last (registration order — it comes
  after `defaultBlockSpecs` in the object literal).

### What actually shipped

`src/lib/link-preview-markdown.ts` owns the translation OUTSIDE BlockNote's
markdown pipeline, so the pipeline never has to disambiguate our block from a
code block:

1. Before `editor.tryParseMarkdownToBlocks`, regex-substitute every top-level
   ` ```linkcard\n{url}\n``` ` fence for a placeholder paragraph
   (`linkcard:{index}`).
2. After parsing, walk the resulting blocks and swap each placeholder
   paragraph for a real `{ type: "linkPreview", props: { url } }` block.
3. Commit does the mirror image: swap live `linkPreview` blocks for
   placeholder paragraphs, call `editor.blocksToMarkdownLossy`, then
   regex-substitute the placeholders back to fences in the output string.

The `linkPreview` block spec itself still gets a best-effort
`toExternalHTML`/`parse` pair (for in-app copy/paste only — never exercised
by the markdown persistence path), and is registered in the schema so
`editor.replaceBlocks` can construct one.

**Scope guard, by construction:** the extraction regex only matches
column-0 fences. A ` ```linkcard ` fence nested inside a list item or
blockquote (indented) does not match and falls through unmangled as an
ordinary, harmless code block showing the raw URL — a safe degradation, not
corruption. This lines up with the toggle UI only ever offering "Card" for a
top-level paragraph containing nothing but the link.

This does **not** disturb the command palette's substring search over
`description` (`src/lib/search.ts:40`) — the stored text for a card is a
short fenced block containing just the URL, same order of noise a stored
`![alt](src)` image already contributes.

---

## Checklist

### 0. Prove the round-trip (do this first) — DONE

- [x] `src/lib/link-preview-markdown.ts` — pure extract/inflate/deflate/restore
      functions, own the fence <-> block translation outside BlockNote's
      markdown pipeline. See the file header for why.
- [x] `src/components/ui/link-preview-block.test.tsx` — happy-dom, because
      `htmlToMarkdown` calls `document.createElement`. 9 tests, green: the
      pure extract/restore functions, a full stored-markdown → editor →
      stored-markdown round-trip, the Decision-1 negative (a plain pasted
      autolink stays inline), the nested-fence degradation, and a regression
      guard that an ordinary named code block is untouched.
- [x] Two conventions tried and rejected first, with evidence — see "The hard
      part: markdown round-trip" above before reaching for either again.

### 1. Server — metadata fetcher — DONE

- [x] `src/server/worker.ts` — `/api/link-preview` branch added beside
      `/api/attachments`.
- [x] `src/server/link-preview/routes.ts` — `GET /api/link-preview?url=…`,
      `getSessionSafe` auth, `caches.default` response caching keyed on the
      normalized URL.
- [x] `src/server/link-preview/validate.ts` — pure, 19 unit tests. Also
      explicitly rejects loopback/private/link-local literal hosts (not just
      scheme/length), on top of `global_fetch_strictly_public` — belt and
      suspenders, see the file's own header for why both layers matter.
- [x] `src/server/link-preview/fetch-meta.ts` — `HTMLRewriter`, both gotchas
      (drain via `.arrayBuffer()`, accumulate chunked `text()`) handled.
- [x] `src/server/link-preview/normalize.ts` — pure, 11 unit tests.
- [x] Never echoes `error.message`; a failed fetch is 200 `{ ok: false }`.

### 2. Client — DONE

- [x] `src/lib/link-preview.ts` — `fetchLinkPreview(url)`, in-flight
      de-duplication map, 6 unit tests.
- [x] `src/components/ui/link-preview-block.tsx` — `createReactBlockSpec`
      definition. **Correction: the prop is `href`, not `url`** — found live,
      see "A second, unrelated collision" below. Imported only from
      `markdown-editor.tsx`; confirmed absent from `src/components/board/`.
- [x] `src/components/ui/markdown-editor.tsx` — schema wired, seed/commit
      routed through `link-preview-markdown.ts`.
- [x] Visuals matching `AttachmentRow`'s conventions; security posture (no
      `dangerouslySetInnerHTML`); `og:image` with `referrerPolicy="no-referrer"`;
      offline fallback via a locally-copied `useOnline()` (4th site, matching
      the existing "don't extract at 3" precedent).

**A second, unrelated collision, found live (not in any unit test):**
BlockNote's default File-block formatting-toolbar buttons
(Replace/Delete/Download/Preview/Caption/Rename) key off
`blockHasType(block, editor, block.type, { url: "string" })` — a purely
structural "does this prop exist" check, not an actual file-block check. The
original `url` prop name matched it by accident, and every freshly-converted
card grew a stray, non-functional file toolbar on top of it. Fixed by
renaming the prop to `href` throughout (`link-preview-block.tsx`,
`link-preview-markdown.ts`, `markdown-editor.tsx`, and the round-trip test's
own mirror schema). See `docs/LINK-PREVIEW.md` §3.

### 3. The toggle UI — DONE

- [x] Inline → card: custom `LinkToolbarWithCard` (default 3 buttons + Card),
      gated by `isLinkOnlyParagraph`.
- [x] Card → inline: ghost button, `touch:opacity-100`.
- [x] No new keyboard shortcut; `shortcuts.ts`/`docs/KEYBOARD.md` untouched.

**A real persistence bug, found only by e2e, not by any unit test or the
first manual browser pass:** both toggle buttons are themselves removed from
the DOM by the `editor.replaceBlocks` their own `onClick` triggers (the
paragraph/card they were rendered inside no longer exists). A focused
element vanishing from the DOM drops focus to `<body>` without bubbling a
blur through `MarkdownEditor`'s wrapper — the one thing that commits. Net
effect: convert, then click any OTHER field expecting the usual blur-commits
contract, and the conversion silently vanished on reopen. Both handlers now
call `editor.focus()` immediately after `replaceBlocks`, restoring the
ordinary blur-on-click-elsewhere path. This is exactly the class of bug
step 4's "manual verification checklist" was for — except the automated e2e
spec caught it first, before any manual pass was needed.

### 4. Tests — DONE

Unit (vitest): 45 tests across
`src/lib/link-preview-markdown.ts` (in `link-preview-block.test.tsx`),
`src/server/link-preview/{validate,normalize}.test.ts`, and
`src/lib/link-preview.test.ts`.

E2E (`e2e/link-preview.spec.ts`, 3 tests):

- [x] **Correction confirmed:** no `page.route()` stub used or needed — the
      fallback card renders with zero network dependency, exactly as
      `attachments.spec.ts`'s posture predicted.
- [x] **Correction: both `desktop` AND `phone-iphone`, not desktop-only.**
      The toggle is driven by CLICKING a link (moving the text cursor into
      it, `getLinkAtSelection()`'s text-cursor path) rather than a real mouse
      hover, so it is identical on both projects — verified live. The one
      genuinely touch-specific issue found was unrelated to hover: typing a
      URL containing `//` as discrete keystrokes garbled it on
      `phone-iphone` specifically (BlockNote's slash-command menu
      mishandling a second `/` while still deciding whether to open) — fixed
      by `fill()`-ing the URL text instead of typing it keystroke-by-keystroke
      (see the spec's own comment on `typeLoneLink`).
- [x] Added to `SPECS` and to `testMatch` of both `desktop` and
      `phone-iphone`. `e2e/config-coverage.test.ts` passes.
- [x] No `test.skip(project.name !== …)`.

### 5. Docs — DONE

- [x] `docs/LINK-PREVIEW.md` — the two dead-end conventions with evidence,
      the shipped fence + out-of-band-translation design, both collisions
      found live, the toggle UI, security, offline.
- [x] `src/components/ui/markdown-field.tsx` — "no custom blocks" clause
      corrected.
- [x] `docs/E2E.md` §8.1 (table row) and §8.2 (justification bullet).

---

## Not in scope

- No new synced entity, no schema migration. Metadata is fetched on view and
  cached server-side; the todo stores only the markdown link it already stores.
  If cards must later survive offline or link rot, that becomes a new entity
  kind and the 9-step `docs/SCHEMA-CHANGES.md` ritual — a separate ticket.
- Proxying `og:image` through the Worker for privacy — possible follow-up.
- Auto-card on paste — possible follow-up.

---

## Verification — DONE

1. **Typecheck (app + worker), lint, unit tests, both builds** — all green.
   2224 unit tests pass (one pre-existing, unrelated flake in
   `reminder-picker.test.tsx` reproduced in isolation as a pass, confirming
   it's cross-test flake, not a regression). `next build` and
   `BUILD_TARGET=static next build` both succeed — the `ssr:false` prerender
   guard on `MarkdownEditor` holds for the new BlockNote block too.
2. **`npm run e2e` — the full 5-project matrix** — run. 122 passed, 7 failed
   (`activity-timeline`, `attachments`, `marketing-pages` x2, `core-flows`,
   and 2 of this feature's own `link-preview` tests on `phone-iphone`). Every
   failing test, including both of mine, was re-run individually afterward
   and **passed** — e.g. `/docs` alone took 9.5s including a 7.5s cold
   compile, consistent with docs/E2E.md §8.4's own documented finding that
   full local parallelism starves the shared dev server. Confirmed
   environmental contention, not a regression, but genuinely checked rather
   than assumed.
3. **Live check, in a real browser (Chrome DevTools Protocol, no Jean run
   environment was active so one was started with `next dev`)** — this is
   what actually found both bugs recorded above (the `url`-prop file-toolbar
   collision, and the vanishing-focus persistence bug), which no unit test
   caught:
   - Paste a bare URL, backspace the trigger space, click the link → **Card**
     button appears → click it → card renders with the hostname fallback
     (`example.com`, no image) — correct, since a local dev server has no
     Worker.
   - Close and reopen the sheet → still a card. This is the markdown
     round-trip against a REAL commit and a REAL re-seed, not the isolated
     unit test.
   - Click "Convert to inline link" → becomes a real `<a>` with label
     `example.com` != href. Reopen → still inline.
   - Confirmed via `e2e/link-preview.spec.ts`, which encodes this exact
     sequence for both `desktop` and `phone-iphone` and passes on both.
   - Not separately checked live: offline-mode fallback, the in-flight
     dedup's "no second network call" claim, and Day Notes — all three are
     either unit-tested directly (`link-preview.test.ts`'s dedup tests) or
     follow from code paths shared with what WAS checked (Day Notes uses the
     identical `MarkdownField`/`MarkdownEditor`, unmodified by anything
     day-note-specific).
4. **Worker-level safety cases (`file:///etc/passwd`, `http://127.0.0.1`,
   etc.) were validated via `src/server/link-preview/validate.test.ts`'s 19
   cases, not a live `curl` against a running Worker.** A live check would
   need `npm run preview` (an OpenNext build), which was judged not worth
   the extra build time here since `validateLinkPreviewUrl` is a pure
   function exercising the exact same logic the route calls — the untested
   remainder is only the route's plumbing (headers, caching), which the
   e2e/manual checks above already exercise indirectly (a 401/400 response
   would have broken every fallback-card assertion).

---

## Linear tickets — created

**EI-248** (this feature) and **EI-249** (follow-up: dev-bootstrap script)
were created directly via the `linear` MCP server once it reconnected mid-session
— the earlier "Jean has no Linear API key" blocker was resolved externally,
not by this session. Both live under the **Faite** project, not "Pointer" —
see the correction at the top of this file.
