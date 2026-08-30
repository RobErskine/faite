# Link preview cards

A URL in a todo's Notes field (or Day Notes — same field) can render as a
preview card — image, title, description, site name — instead of a plain
inline link, toggled either way from the editor.

## 1. Why not the npm package that inspired this

The starting point was `@ldlfylt/link-preview-card`. Rejected: 1 star, 4
weekly downloads, a single `0.1.0` publish, no commits since 2025-08-01, and
its documented `refresh` cache prop is declared in its types but never read
by its own code — every render would have made a live fetch.

Every popular alternative is also unusable here: `open-graph-scraper`,
`link-preview-js`, and `metascraper` all depend on `undici`, which does not
run on Workers. `unfurl.js` was archived by its own maintainer.

So metadata is fetched by hand: `GET /api/link-preview?url=…`
(`src/server/link-preview/`), using Cloudflare's built-in `HTMLRewriter` —
not a dependency, not a regex parser — to pull `og:`/`twitter:`/`<title>`
tags out of the response HTML as it streams through
(`fetch-meta.ts`).

## 2. Scope, deliberately small

Rob's words: *"I don't want this to be a heavy overhead."* Concretely:

- **No stored metadata, no new synced entity, no schema migration.** The
  todo stores only the markdown it already stored. Metadata is fetched on
  view and cached at Cloudflare's edge (`caches.default`, 24h) — a public
  page's OG tags are not user data, so caching the response itself (not just
  the upstream fetch) is safe and free of any KV/D1 addition.
- **Explicit toggle only.** Pasting a URL gives an ordinary link; the user
  presses **Card** to convert it. No auto-card on paste.
- **`og:image` loads straight from the remote origin**, `referrerPolicy="no-referrer"`.
  No Worker image proxy in v1 — a possible follow-up, not a v1 requirement.

If cards ever need to survive offline or link rot, that is a new entity kind
and the 9-step `docs/SCHEMA-CHANGES.md` ritual — a separate, larger decision.

## 3. The markdown shape, and the two conventions that didn't work

The Notes field stores **lossy markdown**, not BlockNote JSON
(`markdown-field.tsx`). A card needs to be markdown too, and needs to be
distinguishable from an ordinary link with no invented syntax that would
look broken if the note were ever exported. Two conventions were tried and
rejected before finding one that survives BlockNote 0.53's actual installed
serializer/parser — not assumed, verified by reading the source and
proving it live:

1. **"Link text equals its href → card."** Looked clean, matched no invented
   syntax. Dead on arrival: BlockNote's exporter collapses `text === href`
   to a **bare URL**, not `[url](url)` (`htmlToMarkdown.ts`'s `formatLink`,
   citing `TypeCellOS/BlockNote#2661`, specifically to make a pasted
   autolink round-trip as a plain href). There is no shape left to hang a
   "card" flag on, and it would have made every pasted link a card
   immediately — the opposite of the toggle being explicit.
2. **A `linkPreview` custom block with its own fenced-code markdown
   (` ```linkcard `), round-tripping through its own `toExternalHTML`/`parse`
   the way a custom block ordinarily would.** Also dead: BlockNote's
   markdown tokenizer emits `<pre><code data-language="...">` for **any**
   fenced code, and the built-in `codeBlock` block's `parse` rule
   unconditionally claims any `<pre><code>` it sees regardless of the
   language string. There is no public API to give a competing block's
   parse rule priority over that (two different, easily-confused "priority"
   concepts exist — ProseMirror's `ParseRule.priority` and Tiptap's
   `Node.create({ priority })` — and neither is exposed for this).

**What shipped:** the ` ```linkcard ` fence is still the stored shape, but
`src/lib/link-preview-markdown.ts` owns the translation OUTSIDE BlockNote's
markdown pipeline entirely. Before `editor.tryParseMarkdownToBlocks`, every
top-level fence is substituted for a placeholder paragraph; after parsing,
placeholders are swapped for real `linkPreview` blocks. Commit does the
mirror image. BlockNote's parser/serializer never has to disambiguate the
block from a code block, because it never sees one. The block's own
`toExternalHTML`/`parse` still exist, but only for in-app copy/paste — a
secondary path the persistence contract does not depend on.

Proven in `src/components/ui/link-preview-block.test.tsx` (the round-trip,
including a fenced-code regression guard) and
`src/lib/link-preview-markdown.ts`'s own unit tests, and again live in a
browser (paste → card → close → reopen → still a card) before this shipped.

**A second, unrelated collision, also found live:** BlockNote's default
File-block formatting-toolbar buttons (Replace/Delete/Download/Preview/
Caption/Rename) key off `blockHasType(block, editor, block.type, { url:
"string" })` — a purely structural check for a prop literally named `url`,
not an actual file-block check. A `linkPreview` block with a `url` prop
matched it by accident and grew a stray, non-functional file toolbar over
the card. Fixed by naming the prop `href` instead
(`link-preview-block.tsx`).

## 4. The toggle UI

- **Inline → card.** `LinkToolbarController`'s default three buttons (Edit
  link / Open in new tab / Remove link) plus a fourth, **Card**
  (`markdown-editor.tsx`'s `LinkToolbarWithCard`), shown only when the link's
  paragraph contains nothing but that link
  (`isLinkOnlyParagraph`, resolved against `editor.prosemirrorState`, since
  there is no first-class "block at this arbitrary position" API for a
  mouse-hovered — not selected — link).
- **Card → inline.** A small ghost button in the card's corner
  (`LinkPreviewCard`'s "Convert to inline link"), visible on hover, focus,
  and always on touch (`touch:opacity-100`). Replaces the block with a
  paragraph containing `[title](url)` — title is the fetched page title, or
  the hostname when metadata never loaded, but never the bare URL, so the
  result cannot itself collapse back into the card's own trigger shape.
- **Both mutations call `editor.focus()` immediately after
  `editor.replaceBlocks`.** Found live: the clicked button (Card, or Convert
  to inline) is itself removed from the DOM by the replace, since the thing
  it was rendered inside no longer exists. A focused element vanishing from
  the DOM drops focus to `<body>` without bubbling a blur through
  `MarkdownEditor`'s wrapper — the one thing that actually commits. Without
  the explicit re-focus, converting and then clicking any other field
  silently discarded the conversion instead of saving it, which a Playwright
  e2e run caught (see `e2e/link-preview.spec.ts`) even though every unit
  test and one manual browser pass had already looked correct.
- No new keyboard shortcut, so `src/lib/shortcuts.ts` and `docs/KEYBOARD.md`
  need no change. If that ever changes, both are mandatory (`AGENTS.md`).

## 5. Security

- **`GET /api/link-preview`** requires a session (`getSessionSafe` — never
  `auth.api.getSession()` directly, which throws on a garbage `Authorization`
  header). No API-key scope: this is a UI affordance for the app's own Notes
  field, not a public capability.
- **URL validation** (`src/server/link-preview/validate.ts`, pure,
  unit-tested): `http:`/`https:` only, a length cap, and explicit rejection
  of loopback/private/link-local literal hosts (`127.0.0.1`, `10.0.0.0/8`,
  `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` including the cloud
  metadata address, `::1`, and IPv6 unique-local/link-local ranges).
  `global_fetch_strictly_public` (`wrangler.jsonc`) is the runtime-level
  defense against DNS rebinding (a public hostname resolving to a private
  IP at fetch time) — the string-level check above does not and cannot
  catch that, so both layers matter.
- **Never echoes `error.message`** — same rule as the attachment routes. A
  failed fetch returns 200 with `{ ok: false }` so the client draws the
  fallback card instead of surfacing a request error.
- **Title/description/site name render as ordinary React text**, auto-escaped.
  No `dangerouslySetInnerHTML` anywhere near this — the repo's stated
  posture is *never build markup from untrusted content*
  (`docs/ATTACHMENTS.md` §4).
- **`og:image` loads with `referrerPolicy="no-referrer"`**, so the remote
  origin never learns which of this app's users viewed its page.

## 6. Offline and failure

`fetchLinkPreview` (`src/lib/link-preview.ts`) collapses every failure —
network error, non-200, a 200 with `{ ok: false }`, offline — to the same
`null`, which the card renders as its fallback: the hostname and the raw
URL, never a dead end. A module-level in-flight map de-duplicates concurrent
requests for the same URL; `Cache-Control: public, max-age=86400` on the
response is what makes a *later* repeat request cheap.
