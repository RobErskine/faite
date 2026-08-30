import { test, expect } from "./support/fixtures";
import { switchToLists } from "./support/phone";

/**
 * The card/inline toggle in the Notes field (link preview cards).
 *
 * ## What this deliberately does NOT test
 *
 * A real fetch to `/api/link-preview`. Same reasoning as
 * `attachments.spec.ts`: the harness serves Next alone (`next dev` locally,
 * `next start` in CI, docs/E2E.md §9) with no Worker in either, so the route
 * genuinely does not exist here — a real fetch would just 404, and `fetchLinkPreview`
 * (`src/lib/link-preview.ts`) treats a non-200 response as "no metadata"
 * indistinguishably from a real network failure. That fallback path IS what
 * every assertion below exercises: the card renders with the bare hostname,
 * which is real coverage, not a stand-in for the real one. The metadata
 * fetch itself is covered by `src/server/link-preview/{validate,normalize}.test.ts`
 * and the manual checklist in the runbook.
 *
 * ## Click, not hover, to open the link toolbar
 *
 * BlockNote's `LinkToolbarController` opens on EITHER a mouse hover OR the
 * text cursor landing inside a link (`getLinkAtSelection()`). Clicking
 * directly on link text moves the cursor into it, which is the more
 * reliable trigger under Playwright and the one that also works on a
 * touch-emulated project (a real hover is meaningless there) — verified
 * live against a real browser before writing this spec.
 */

async function openSheetFor(page: Parameters<typeof switchToLists>[0], title: string) {
  await switchToLists(page);
  const backlog = page.getByRole("region", { name: "Backlog" });
  await backlog.getByPlaceholder("Add a to-do").fill(title);
  await page.keyboard.press("Enter");

  // `exact: true` — the drag grip's aria-label also contains the title.
  await page.getByRole("button", { name: title, exact: true }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * `aria-label="Notes"` (`markdown-editor.tsx`'s `ariaLabel` prop) lands on
 * BlockNoteView's own wrapper element, not on the ProseMirror contenteditable
 * inside it (the actual `role="textbox"`) — confirmed live, the wrapper is a
 * plain `generic "Notes"` in the a11y tree and the inner textbox has no name
 * of its own. `aria-label` does not propagate to descendants per the ARIA
 * spec, so `getByRole("textbox", { name: "Notes" })` can never match it; scope
 * by the labeled container first instead.
 */
function notesField(sheet: import("@playwright/test").Locator) {
  return sheet.locator('[aria-label="Notes"]').getByRole("textbox");
}

/**
 * Puts a URL into Notes as its OWN paragraph and leaves it a real link mark
 * with no trailing character — the shape the "Card" button requires
 * (paragraph contains nothing but the link).
 *
 * `fill()`, not `pressSequentially()`, for the URL text itself — found live,
 * `phone-iphone` specifically (not `desktop`): typing "https://example.com"
 * as discrete keystrokes garbled it to "https:/example.com/", one `/`
 * relocated to the end. BlockNote's slash-command menu opens on the first
 * `/` and evidently mishandles a second `/` arriving while it's still
 * deciding whether to filter or dismiss — a real, narrow input-rule
 * collision, not a timing race (an added inter-keystroke delay did not fix
 * it). `fill()` sets the text in one operation with no per-keystroke slash
 * events to collide with. A single real keypress (` `) afterward is what
 * BlockNote's autolink-on-type input rule actually keys off — that part
 * still needs a genuine keystroke, so it stays as `press`, and the space is
 * then backspaced off so the mark survives but the trailing character does
 * not.
 */
async function typeLoneLink(sheet: import("@playwright/test").Locator, url: string) {
  const notes = notesField(sheet);
  await notes.click();
  await notes.fill(url);
  await notes.press(" ");
  await notes.press("Backspace");
  await expect(notes.getByRole("link", { name: url })).toBeVisible();
}

/** Blurs the Notes field by moving focus to a neighboring input — closing
 * the sheet without this discards the edit (`MarkdownEditor` only commits on
 * blur; a dialog close is not itself a blur of its contenteditable). */
async function commitNotes(sheet: import("@playwright/test").Locator) {
  await sheet.getByPlaceholder("Add a sub-task").click();
}

test("a lone link in Notes offers Card, and converting renders the fallback card", async ({
  page,
}) => {
  const sheet = await openSheetFor(page, "Check the Workers docs");
  const url = "https://example.com";

  await typeLoneLink(sheet, url);

  const notes = notesField(sheet);
  await notes.getByRole("link", { name: url }).click();
  await sheet.getByRole("button", { name: "Card" }).click();

  // Fallback rendering: no Worker, so title/site name fall back to the
  // hostname (`hostnameFor` in `link-preview-block.tsx`).
  await expect(notes.getByRole("link", { name: "example.com" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Convert to inline link" })).toBeVisible();
});

test("a card survives closing and reopening the sheet", async ({ page }) => {
  const title = "Read about caching";
  const sheet = await openSheetFor(page, title);
  const url = "https://example.com";

  await typeLoneLink(sheet, url);
  const notes = notesField(sheet);
  await notes.getByRole("link", { name: url }).click();
  await sheet.getByRole("button", { name: "Card" }).click();
  await commitNotes(sheet);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).not.toBeVisible();

  await page.getByRole("button", { name: title, exact: true }).click();
  const reopened = page.locator('[data-slot="sheet-content"]');
  await expect(reopened).toBeVisible();

  // This is the markdown round-trip proof that matters: the ```linkcard
  // fence (`src/lib/link-preview-markdown.ts`) survived a real commit and a
  // real re-seed, not just the isolated unit test.
  await expect(
    notesField(reopened).getByRole("link", { name: "example.com" }),
  ).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Convert to inline link" })).toBeVisible();
});

test("converting a card back to inline persists as an ordinary link", async ({ page }) => {
  const title = "Follow up on the proposal";
  const sheet = await openSheetFor(page, title);
  const url = "https://example.com";

  await typeLoneLink(sheet, url);
  const notes = notesField(sheet);
  await notes.getByRole("link", { name: url }).click();
  await sheet.getByRole("button", { name: "Card" }).click();
  await sheet.getByRole("button", { name: "Convert to inline link" }).click();

  // Back to a plain paragraph link — no card chrome, no toggle button.
  await expect(sheet.getByRole("button", { name: "Convert to inline link" })).toHaveCount(0);
  await expect(notes.getByRole("link", { name: "example.com" })).toBeVisible();

  await commitNotes(sheet);
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: title, exact: true }).click();
  const reopened = page.locator('[data-slot="sheet-content"]');
  await expect(reopened).toBeVisible();

  // Still an ordinary link after reopening — a converted-back link is a
  // normal `[label](url)` with label != url, which round-trips through
  // BlockNote's own markdown pipeline unmodified (see
  // `link-preview-block.test.tsx`'s "Decision 1" test for the unit-level
  // proof of the same shape).
  await expect(
    notesField(reopened).getByRole("link", { name: "example.com" }),
  ).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Convert to inline link" })).toHaveCount(0);
});
