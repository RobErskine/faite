"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createBlockConfig } from "@blocknote/core";
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { Link2, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchLinkPreview, type LinkPreviewMeta } from "@/lib/link-preview";
import { cn } from "@/lib/utils";

/**
 * The `linkPreview` custom block — the card rendering of a link in the Notes
 * field, toggled from an ordinary inline link via the toolbar button in
 * `markdown-editor.tsx`.
 *
 * Persistence does NOT go through this block's `toExternalHTML`/`parse` —
 * see `src/lib/link-preview-markdown.ts`'s header for why a custom block
 * competing with BlockNote's own `codeBlock` parse rule doesn't work, and
 * how `markdown-editor.tsx` routes around it. They exist here only for
 * in-app copy/paste, which is a real but secondary path.
 *
 * Imported ONLY from `markdown-editor.tsx`, which is itself `next/dynamic`'d
 * with `ssr: false` — nothing in `src/components/board/` may import this
 * file, or BlockNote's ProseMirror/TipTap weight lands on the initial board
 * chunk instead of staying inside the lazy Notes-field chunk.
 *
 * **The prop is named `href`, not `url`, and that is load-bearing.** Every
 * one of BlockNote's default File-block formatting-toolbar buttons
 * (Replace/Delete/Download/Preview/Caption/Rename —
 * `components/FormattingToolbar/DefaultButtons/File*.tsx`) decides whether
 * to render for the CURRENTLY SELECTED block using
 * `blockHasType(block, editor, block.type, { url: "string" })` — a purely
 * structural check ("does this block type have a prop literally named `url`
 * typed string"), not an actual file/image/video/audio type check. A
 * `linkPreview` block with a `url` prop matches that check by accident and
 * silently grows a floating Replace/Delete/Download toolbar over the card
 * that does nothing useful and was never asked for (found live, clicking a
 * freshly-converted card in a real browser — this file's own
 * `FormattingToolbar` is untouched, so there was no other place to catch
 * it). Naming the prop `href` sidesteps the whole class of buttons at zero
 * cost, since nothing else here needs the name `url` specifically.
 */

const linkPreviewBlockConfig = createBlockConfig(() => ({
  type: "linkPreview" as const,
  propSchema: {
    href: { default: "" },
  },
  content: "none" as const,
}));

/** Copied rather than extracted — same call as `attachments-section.tsx`'s
 * `useOnline`: this is the fourth site, and none of them wants a shared
 * module for four lines. `navigator` is absent during the static export's
 * prerender, hence `useSyncExternalStore`. */
const subscribeToNothing = () => () => {};
function useOnline(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => navigator.onLine !== false, () => true);
}

function hostnameFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Replaces the card with a paragraph containing `[label](url)`. `label` is
 * never equal to `url` (a real title, or the hostname when metadata never
 * loaded), so the result is an ordinary link — not another card.
 *
 * `editor` is cast to `any` on purpose: `ReactCustomBlockRenderProps`
 * narrows its type to a single-block schema containing only `linkPreview`,
 * which has no `"paragraph"` type to replace INTO — a BlockNote typing
 * artifact of defining one custom block in isolation, not a real constraint
 * (the actual runtime schema is the full app schema, `defaultBlockSpecs`
 * plus this one).
 */
function convertToInlineLink(
  editor: ReactCustomBlockRenderProps<typeof linkPreviewBlockConfig>["editor"],
  blockId: string,
  url: string,
  label: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor as any).replaceBlocks(
    [blockId],
    [
      {
        type: "paragraph",
        content: [{ type: "link", href: url, content: [{ type: "text", text: label, styles: {} }] }],
      },
    ],
  );
  // This button is itself removed from the DOM by the replace above (the
  // card it was rendered inside no longer exists). A focused element
  // vanishing from the DOM drops focus to <body> without bubbling a blur
  // through `markdown-editor.tsx`'s wrapper, which is the only thing that
  // commits — found live, converting back to inline then clicking any other
  // field silently discarded the conversion. Re-focusing the editor here
  // means the next blur is an ordinary one, off the actual contenteditable.
  editor.focus();
}

function LinkPreviewCard({
  block,
  editor,
}: ReactCustomBlockRenderProps<typeof linkPreviewBlockConfig>) {
  const { href: url } = block.props;
  const online = useOnline();
  const [meta, setMeta] = useState<LinkPreviewMeta | null | undefined>(undefined);
  const [imageFailed, setImageFailed] = useState(false);

  // "Adjusting state during render" (React's own documented alternative to
  // resetting state in an effect body, which `react-hooks/set-state-in-effect`
  // flags): a `linkPreview` block's `url` prop practically never changes
  // without the block itself being replaced, but this keeps the component
  // correct if it ever does.
  const [urlForMeta, setUrlForMeta] = useState(url);
  if (url !== urlForMeta) {
    setUrlForMeta(url);
    setMeta(undefined);
    setImageFailed(false);
  }

  useEffect(() => {
    if (!online) return;

    let cancelled = false;
    fetchLinkPreview(url).then((result) => {
      if (!cancelled) setMeta(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url, online]);

  const hostname = hostnameFor(url);
  const title = meta?.title ?? hostname;
  const showImage = Boolean(meta?.image) && !imageFailed;

  return (
    <div
      className={cn(
        "group/card relative flex gap-3 rounded border border-border bg-muted p-3",
        "focus-within:ring-2 focus-within:ring-ring",
      )}
      contentEditable={false}
    >
      {showImage ? (
        // Direct from the remote origin, deliberately: no Worker image
        // proxy in v1 (Rob's decision — see the runbook). `no-referrer` so
        // the remote origin never learns which of this app's users viewed
        // its page.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={meta!.image!}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="size-16 shrink-0 rounded border border-border object-cover"
        />
      ) : (
        <span className="flex size-16 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">
          <LinkIcon className="size-5" aria-hidden />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium hover:underline"
        >
          {title}
        </a>
        {meta?.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{meta.description}</p>
        )}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {meta?.siteName ?? hostname}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Convert to inline link"
        title="Convert to inline link"
        onClick={() => convertToInlineLink(editor, block.id, url, title)}
        className={cn(
          "absolute top-1 right-1 size-6 shrink-0 text-muted-foreground",
          "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 touch:opacity-100",
        )}
      >
        <Link2 className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}

/** JSX, not a manual DOM node — `createReactBlockSpec` renders this via
 * `renderToDOMSpec` the same way it renders `render` itself. */
function LinkPreviewExternalHTML({
  block,
}: ReactCustomBlockRenderProps<typeof linkPreviewBlockConfig>) {
  return <div data-linkcard-url={block.props.href}>{block.props.href}</div>;
}

export const linkPreviewBlockSpec = createReactBlockSpec(linkPreviewBlockConfig, {
  render: LinkPreviewCard,
  // Best-effort only (in-app copy/paste) — see the file header. The
  // persistence path never calls either of these.
  parse: (el) => {
    if (el.tagName !== "DIV" || !el.hasAttribute("data-linkcard-url")) return undefined;
    const href = el.getAttribute("data-linkcard-url");
    return href ? { href } : undefined;
  },
  toExternalHTML: LinkPreviewExternalHTML,
})();
