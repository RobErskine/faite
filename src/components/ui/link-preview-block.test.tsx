// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createBlockConfig,
  createBlockSpec,
  defaultBlockSpecs,
} from "@blocknote/core";
import {
  deflateLinkPreviewBlocks,
  extractLinkPreviewFences,
  inflateLinkPreviewBlocks,
  restoreLinkPreviewFences,
} from "@/lib/link-preview-markdown";

/**
 * Proves the markdown round-trip BEFORE any UI is built (see
 * `.ai/link-preview-cards-runbook.md` step 0).
 *
 * Two convention were tried and rejected before this one, both disproven by
 * reading BlockNote 0.53's actual installed source rather than trusting the
 * runbook's original assumption:
 *
 * 1. "Link text equals its href -> card." Dead on arrival: BlockNote's own
 *    exporter (`htmlToMarkdown.ts`'s `formatLink`) collapses `text === href`
 *    to a BARE url, not `[url](url)` — specifically to avoid emitting that
 *    shape (see its comment citing TypeCellOS/BlockNote#2661). There is no
 *    markdown shape left to hang a "card" flag on, and it would have turned
 *    Decision 1 (paste stays inline) into a lie: every pasted autolink IS
 *    `text === href`.
 * 2. A `linkPreview` block registered the ordinary way, round-tripping via
 *    `toExternalHTML`/`parse` like any other custom block. Also dead: the
 *    built-in `codeBlock` block's `parse` rule unconditionally claims any
 *    `<pre><code>`, which is what a ```linkcard fence tokenizes to
 *    (`markdownToHtml.ts` hardcodes fenced code -> `<pre><code
 *    data-language="...">` for every language string). There is no public
 *    API to give a custom block's parse rule priority over that — see
 *    `src/lib/link-preview-markdown.ts`'s header for the two different
 *    "priority" concepts this project confused before finding that out
 *    empirically (a debug script dumping `editor.pmSchema.nodes` order).
 *
 * The shape that survives is a ```linkcard fence, but handled OUTSIDE
 * BlockNote's markdown pipeline entirely — `link-preview-markdown.ts`
 * substitutes a placeholder paragraph for the fence before
 * `tryParseMarkdownToBlocks` ever runs, and reverses it after
 * `blocksToMarkdownLossy`. BlockNote's own parser/serializer never has to
 * disambiguate our block from a code block, because it never sees one.
 *
 * This test drives a REAL `BlockNoteEditor` with a minimal (non-React)
 * `linkPreview` block registered — `toExternalHTML`/`parse` are pure DOM
 * functions independent of how a block renders, and the block only needs to
 * exist in the schema so `editor.replaceBlocks` can construct one; the
 * placeholder substitution is what actually carries content across
 * `tryParseMarkdownToBlocks`/`blocksToMarkdownLossy`, not the block's own
 * (best-effort, copy/paste-only) HTML rules.
 */

const linkPreviewConfig = createBlockConfig(() => ({
  type: "linkPreview" as const,
  // `href`, not `url` — matches the real block spec (`link-preview-block.tsx`).
  // That file's header explains why: every one of BlockNote's default
  // File-block toolbar buttons keys off a prop literally named `url`.
  propSchema: { href: { default: "" } },
  content: "none" as const,
}));

// Best-effort only — used for in-app copy/paste, never for the
// markdown persistence path (see the file header above for why that path
// can't rely on this).
const linkPreviewSpec = createBlockSpec(linkPreviewConfig, {
  parse: (el) => {
    if (el.tagName !== "DIV" || !el.hasAttribute("data-linkcard-url")) return undefined;
    return { href: el.getAttribute("data-linkcard-url") ?? "" };
  },
  render: (block) => {
    const dom = document.createElement("div");
    dom.textContent = block.props.href;
    return { dom };
  },
  toExternalHTML: (block) => {
    const dom = document.createElement("div");
    dom.setAttribute("data-linkcard-url", block.props.href);
    return { dom };
  },
})();

function createEditor() {
  return BlockNoteEditor.create({
    schema: BlockNoteSchema.create({
      blockSpecs: { ...defaultBlockSpecs, linkPreview: linkPreviewSpec },
    }),
  });
}

type TestEditor = ReturnType<typeof createEditor>;

/** Mirrors `MarkdownEditor`'s seed effect (see markdown-editor.tsx). */
function seed(editor: TestEditor, storedMarkdown: string) {
  const { markdown, urls } = extractLinkPreviewFences(storedMarkdown);
  const parsed = editor.tryParseMarkdownToBlocks(markdown);
  const blocks = inflateLinkPreviewBlocks(parsed, urls);
  editor.replaceBlocks(editor.document, blocks);
}

/** Mirrors `MarkdownEditor`'s commit handler. */
function commit(editor: TestEditor): string {
  const { blocks, urls } = deflateLinkPreviewBlocks(editor.document);
  const raw = editor.blocksToMarkdownLossy(blocks);
  return restoreLinkPreviewFences(raw, urls);
}

describe("link-preview-markdown (pure)", () => {
  it("extracts a fence and restores it byte-for-byte", () => {
    const url = "https://developers.cloudflare.com/workers/";
    const stored = `\`\`\`linkcard\n${url}\n\`\`\``;

    const { markdown, urls } = extractLinkPreviewFences(stored);
    expect(markdown).toBe("linkcard:0");
    expect(urls).toEqual([url]);
    expect(restoreLinkPreviewFences(markdown, urls)).toBe(stored);
  });

  it("handles multiple fences in encounter order", () => {
    const a = "https://a.example.com";
    const b = "https://b.example.com";
    const stored = `\`\`\`linkcard\n${a}\n\`\`\`\n\nsome text\n\n\`\`\`linkcard\n${b}\n\`\`\``;

    const { markdown, urls } = extractLinkPreviewFences(stored);
    expect(urls).toEqual([a, b]);
    expect(restoreLinkPreviewFences(markdown, urls)).toBe(stored);
  });

  it("leaves markdown with no fence untouched", () => {
    const stored = "# Heading\n\nSome **bold** text.";
    const { markdown, urls } = extractLinkPreviewFences(stored);
    expect(markdown).toBe(stored);
    expect(urls).toEqual([]);
  });

  it("does not match an indented (nested) fence", () => {
    // Scope guard: only top-level fences are recognized. An indented one
    // (inside a list item) falls through unmangled — a safe degradation to
    // an ordinary code block, not corruption.
    const stored = "* item\n  ```linkcard\n  https://example.com\n  ```";
    const { markdown, urls } = extractLinkPreviewFences(stored);
    expect(markdown).toBe(stored);
    expect(urls).toEqual([]);
  });
});

describe("link preview markdown round-trip (full editor)", () => {
  it("seeds a stored fence as a real linkPreview block", () => {
    const editor = createEditor();
    const url = "https://developers.cloudflare.com/workers/";
    seed(editor, `\`\`\`linkcard\n${url}\n\`\`\``);

    expect(editor.document).toHaveLength(1);
    expect(editor.document[0].type).toBe("linkPreview");
    expect(editor.document[0].props).toMatchObject({ href: url });

    editor._tiptapEditor.destroy();
  });

  it("commits a linkPreview block back to the exact stored fence", () => {
    const editor = createEditor();
    const url = "https://developers.cloudflare.com/workers/";
    editor.replaceBlocks(editor.document, [{ type: "linkPreview", props: { href: url } }]);

    expect(commit(editor)).toBe(`\`\`\`linkcard\n${url}\n\`\`\`\n`);

    editor._tiptapEditor.destroy();
  });

  it("survives a full stored-markdown -> editor -> stored-markdown round-trip", () => {
    const editor = createEditor();
    const url = "https://example.com/some/path?query=1";
    const stored = `# Notes\n\n\`\`\`linkcard\n${url}\n\`\`\`\n\nSome other text.`;

    seed(editor, stored);
    expect(editor.document.map((b) => b.type)).toEqual(["heading", "linkPreview", "paragraph"]);

    const recommitted = commit(editor);
    seed(editor, recommitted);
    expect(editor.document.map((b) => b.type)).toEqual(["heading", "linkPreview", "paragraph"]);
    expect((editor.document[1].props as { href: string }).href).toBe(url);

    editor._tiptapEditor.destroy();
  });

  it("does NOT turn a plain pasted-URL autolink into a card (Decision 1)", () => {
    // The case the original `[url](url)` convention got wrong: an autolinked
    // paragraph where the link text equals its href. Decision 1 requires
    // this to stay a plain inline link. The fenced-block convention can't
    // collide with it — a paragraph never contains a ```linkcard fence.
    const editor = createEditor();
    const url = "https://example.com";

    const blocks = editor.tryParseHTMLToBlocks(`<p><a href="${url}">${url}</a></p>`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");

    const markdown = editor.blocksToMarkdownLossy(blocks);
    expect(markdown.trim()).toBe(url);

    editor._tiptapEditor.destroy();
  });

  it("leaves an ordinary named code block alone (no regression)", () => {
    const editor = createEditor();
    seed(editor, "```js\nconst x = 1;\n```");

    expect(editor.document).toHaveLength(1);
    expect(editor.document[0].type).toBe("codeBlock");

    editor._tiptapEditor.destroy();
  });
});
