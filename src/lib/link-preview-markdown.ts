/**
 * Owns the markdown <-> block translation for `linkPreview` blocks, so
 * `markdown-editor.tsx`'s seed/commit never has to ask BlockNote's own
 * markdown pipeline to recognize the block directly.
 *
 * That indirection is load-bearing, not style. BlockNote 0.53's fenced-code
 * tokenizer always emits `<pre><code data-language="...">` for ANY ``` fence
 * (`markdownToHtml.ts`), and the built-in `codeBlock` block's `parse` rule
 * unconditionally claims every `<pre><code>` it sees, regardless of the
 * language string (`blocks/Code/block.ts`). ProseMirror resolves same-tag
 * ambiguity by `ParseRule.priority` (default 50, ties broken by node
 * registration order) — a field BlockNote's `createBlockSpec` never exposes,
 * and which is NOT the same as Tiptap's `Node.create({ priority })` (that
 * one only affects `sortExtensions`' merge order for config fields of
 * extensions sharing a name, default 100 — confirmed empirically not to
 * reorder `schema.nodes`, and irrelevant to `DOMParser.schemaRules` either
 * way). So a `linkPreview` block registered the ordinary way always loses
 * that race: a stored fence round-tripped through markdown would silently
 * come back as a plain code block instead of a card.
 *
 * The fix is to never let that race happen: substitute every stored
 * ```linkcard fence for a placeholder paragraph BEFORE handing markdown to
 * `editor.tryParseMarkdownToBlocks`, then swap the resulting placeholder
 * blocks for real `linkPreview` blocks ourselves. Commit does the mirror
 * image. BlockNote's own markdown parser/serializer never has to
 * disambiguate our block from a code block, because it never sees one.
 *
 * Scope: top-level fences only (column 0). A ```linkcard fence nested inside
 * a list item or blockquote (indented) will not match `FENCE_RE` and falls
 * through unmangled as an ordinary, harmless code block showing the raw URL
 * — a safe degradation, not a corruption. This matches the toggle UI's own
 * scope: a link only offers "Card" when its paragraph is top-level and holds
 * nothing but that link.
 */

export const LINKCARD_BLOCK_TYPE = "linkPreview";

/**
 * Prefix for the placeholder paragraph text. Not proof against a user
 * typing this exact string, but "linkcard:<digits>" as the ENTIRE content of
 * an otherwise-empty paragraph is not a shape anyone produces by accident —
 * the same order of unlikeliness the runbook already accepted for the
 * original `[url](url)` convention.
 */
const PLACEHOLDER_PREFIX = "linkcard:";

const FENCE_RE = /^```linkcard\n(.+)\n```$/gm;
const PLACEHOLDER_RE = new RegExp(`^${PLACEHOLDER_PREFIX}(\\d+)$`);

/**
 * Replace every stored ```linkcard fence with a placeholder paragraph line,
 * ahead of `editor.tryParseMarkdownToBlocks`. Returns the URLs in encounter
 * order — `inflateLinkPreviewBlocks` matches placeholders back to them by
 * index, not content, so a URL never has to survive re-tokenization.
 */
export function extractLinkPreviewFences(markdown: string): {
  markdown: string;
  urls: string[];
} {
  const urls: string[] = [];
  const replaced = markdown.replace(FENCE_RE, (_match, url: string) => {
    urls.push(url);
    return `${PLACEHOLDER_PREFIX}${urls.length - 1}`;
  });
  return { markdown: replaced, urls };
}

/** True for a plain paragraph whose entire text content is one placeholder. */
function placeholderIndex(block: {
  type: string;
  content?: unknown;
}): number | null {
  if (block.type !== "paragraph") return null;
  const content = block.content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  const [node] = content as [{ type?: string; text?: string }];
  if (node.type !== "text" || typeof node.text !== "string") return null;
  const match = PLACEHOLDER_RE.exec(node.text);
  return match ? Number(match[1]) : null;
}

/**
 * The mirror of `extractLinkPreviewFences`: swap each placeholder paragraph
 * `tryParseMarkdownToBlocks` produced for a real `linkPreview` block.
 *
 * Loosely typed on purpose: the input comes from `tryParseMarkdownToBlocks`
 * (whatever the caller's own schema is) and the output feeds
 * `editor.replaceBlocks`, which accepts a `PartialBlock` for the same
 * schema — BlockNote's own generics (`BlockSchema`/`InlineContentSchema`/
 * `StyleSchema`) are invariant enough that threading them through this
 * module buys no real type safety (the interesting fact, "does this shape
 * have `props.href`", isn't expressible in them anyway) and costs fighting
 * the compiler at every call site. Callers cast at the boundary instead,
 * same as `markdown-editor.tsx` already does for `editor.document`.
 */
export function inflateLinkPreviewBlocks<TBlock extends { type: string; content?: unknown }>(
  blocks: TBlock[],
  urls: string[],
): (TBlock | { type: typeof LINKCARD_BLOCK_TYPE; props: { href: string } })[] {
  return blocks.map((block) => {
    const index = placeholderIndex(block);
    if (index === null) return block;
    return { type: LINKCARD_BLOCK_TYPE, props: { href: urls[index] } };
  });
}

/**
 * True for a `linkPreview` block — duck-typed so callers need no import of
 * the block spec. The prop is `href`, not `url` — see
 * `link-preview-block.tsx`'s header for why that name matters.
 */
function isLinkPreviewBlock(block: {
  type: string;
  props?: unknown;
}): block is { type: string; props: { href: string } } {
  return block.type === LINKCARD_BLOCK_TYPE;
}

/**
 * Ahead of `editor.blocksToMarkdownLossy`: swap each live `linkPreview`
 * block for a placeholder paragraph, so BlockNote's serializer never has to
 * render the block itself. Returns the URLs in the same order the
 * placeholders appear, for `restoreLinkPreviewFences` to consume.
 */
export function deflateLinkPreviewBlocks<
  TBlock extends { type: string; props?: unknown },
>(
  blocks: readonly TBlock[],
): {
  blocks: (
    | TBlock
    | { type: "paragraph"; content: { type: "text"; text: string; styles: Record<string, never> }[] }
  )[];
  urls: string[];
} {
  const urls: string[] = [];
  const deflated = blocks.map((block) => {
    if (!isLinkPreviewBlock(block)) return block;
    urls.push(block.props.href);
    return {
      type: "paragraph" as const,
      content: [
        { type: "text" as const, text: `${PLACEHOLDER_PREFIX}${urls.length - 1}`, styles: {} },
      ],
    };
  });
  return { blocks: deflated, urls };
}

/**
 * The mirror of `deflateLinkPreviewBlocks`: swap each placeholder line in
 * the serialized markdown back for a ```linkcard fence.
 */
export function restoreLinkPreviewFences(markdown: string, urls: string[]): string {
  const re = new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)`, "g");
  return markdown.replace(re, (_match, indexStr: string) => {
    const url = urls[Number(indexStr)];
    return "```linkcard\n" + url + "\n```";
  });
}
