# Copy

How Faite is written. Spelling and the mechanics of copy live here; what the
product *sounds* like is not yet written down, and this file is where it will
go when it is.

`docs/RESEARCH.md` governs what may be claimed and how a study is cited. This
file governs how the words are spelled.

---

## 1. American English

**Faite writes American English.** `color`, `organize`, `canceled`, `center`,
`license`, `gray`.

Not because one spelling is better. Because an unstated convention is not a
convention: before this rule the product shipped "Labelled" in an undo toast
beside `labeled` in a type, "colour" in one string and `color` in the next, and
nothing anywhere recorded which was intended — so every new string re-decided
it, and half of them decided wrong.

The list of words is `src/lib/spelling.ts`. It is deliberately not exhaustive
over all of British English: every entry is a word Faite has used or plausibly
would. Add words when they come up; adding one takes a line, and the test will
tell you immediately whether it was already being broken.

## 2. What the rule covers

**Everything a user can read.** Visible copy, `aria-label`s, screen-reader
announcements, toast and undo text, placeholders, error messages, page titles
and meta descriptions, marketing copy.

**Comments, docs, and local identifiers too** — but as a house style, not as a
build failure. See §4 for why the test draws its line where it does.

## 3. What the rule does not cover

These are not ours to change, and "fixing" one is an error, not a tidy-up:

| Leave alone | Because |
|---|---|
| Verbatim quotes in `docs/RESEARCH.md` | §6 there requires quotes be exact. Lally et al. (2010) reads "perform the behaviour" — rewriting it fabricates a quotation. |
| Published titles | The same paper is titled "How are habits formed: **Modelling** habit formation in the real world." A British journal published it under that spelling; that is its name. |
| Package names and URLs | `@img/colour` is a real npm package. Renaming it in `package-lock.json` breaks `npm ci`. |
| Licence names | "CC BY" is a name. Our own prose *about* licenses uses `license`. |
| Creator names and third-party product names | `assets/scene/CREDITS.md`, `/colophon`. |
| Third-party API surface | A field or option named by a library keeps the library's spelling. |

## 4. The test, and where it draws the line

`src/lib/spelling.test.ts` scans **string literals and JSX text** across
`src/`, and nothing else.

- **Not comments.** A comment is prose for whoever reads the file next. This
  file asks new ones to follow the house spelling; a test that fails the build
  over one is a test people learn to route around.
- **Not identifiers.** `let cancelled = false` is code, not copy. The sweep in
  EI-279 renamed the local ones anyway, but the test does not police them —
  it would fire on third-party API names it has no business rewriting.
- **Not `*.test.ts`.** Test cases are named in prose ("moves between
  neighbouring columns") and those names are string literals. Skipping them
  keeps this rule about copy.
- **Not `spelling.ts` itself**, which contains every British form by
  definition and would otherwise report the rule as a violation of itself.

What is left is exactly the set a user can end up reading.

The extractor strips comments **before** it looks for strings, so a `//`
inside a string literal cannot end one. It has its own tests — a scanner that
silently matched nothing would make the whole rule vacuous while staying green.

### Why not scan the rendered HTML

That was the first idea and it is too narrow. Prerendered pages cover the
marketing site, but the board is client-rendered: the undo toast and the drag
announcements never appear in any prerendered file, and both of the live
strings this rule first caught on the board would have passed.

## 5. Adding a word

1. Add `{ british: …, american: … }` to `SPELLINGS` in `src/lib/spelling.ts`.
2. Run `npx vitest run src/lib/spelling.test.ts`. If it fails, the failure
   message is the fix list — it names every file and the replacement for each.
3. Fix them, or add the case to §3 if it is one of the exceptions.
