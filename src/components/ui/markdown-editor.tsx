"use client";

import { useEffect, useRef } from "react";
import { offset } from "@floating-ui/react";
import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import {
  DeleteLinkButton,
  EditLinkButton,
  LinkToolbar,
  LinkToolbarController,
  OpenLinkButton,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  type LinkToolbarProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { LayoutTemplate } from "lucide-react";
import {
  deflateLinkPreviewBlocks,
  extractLinkPreviewFences,
  inflateLinkPreviewBlocks,
  restoreLinkPreviewFences,
} from "@/lib/link-preview-markdown";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/lib/use-resolved-theme";
import { linkPreviewBlockSpec } from "./link-preview-block";

/**
 * The BlockNote editor itself, kept in its own module so `markdown-field.tsx`
 * can load it with `next/dynamic({ ssr: false })`.
 *
 * Two reasons that split is load bearing, not tidiness:
 *
 * 1. **Size.** BlockNote is ProseMirror + TipTap. Importing it from the board's
 *    module graph would put ~all of it on the initial chunk for a surface that
 *    only ever appears inside a sheet.
 * 2. **Prerender.** Client components are still prerendered at build time,
 *    including under `output: export` — and ProseMirror touches `document` on
 *    construction. `ssr: false` is Next's documented remedy.
 *
 * The stylesheet is imported here, not in `globals.css`, so it travels with the
 * same lazy chunk. `globals.css` carries the matching `@source` directive that
 * makes Tailwind generate the utility classes these components reference.
 *
 * BlockNote's `fonts/inter.css` is deliberately NOT imported: the app already
 * has a font system (the `--app-*` role tokens in `globals.css`, switchable per
 * pairing), and shipping Inter alongside it would override the user's choice
 * inside this one field.
 */

/**
 * BlockNote centers its drag-handle/"+" menu on a block by adding a fixed
 * pixel offset per block type — 39px for an h1, 27px for h2, 18.5px for h3,
 * ported from BlockNote's OWN default (much larger) heading sizes. Ours are
 * shrunk in `globals.css` (`--level`), so those hardcoded numbers overshoot:
 * the menu lands roughly a block below where it hovered, exactly the bug in
 * the screenshot this fixes.
 *
 * Rather than hardcode corrected constants (which would drift again the next
 * time heading sizes change), this centers on the REFERENCE block's actual
 * measured height at position time — the same formula BlockNote's own
 * comment describes, `(block height - menu height) / 2`, just computed live
 * instead of baked in per level.
 */
const SIDE_MENU_MIDDLEWARE = [
  offset(({ rects }) => ({
    crossAxis: (rects.reference.height - rects.floating.height) / 2,
  })),
];

/**
 * Module-level, not built per render: it is stateless, and `useCreateBlockNote`
 * only reads it on the FIRST render anyway (empty `deps`, matching the
 * existing seed-once contract below).
 */
const SCHEMA = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, linkPreview: linkPreviewBlockSpec },
});

/**
 * True when the link at `range` is the paragraph's ENTIRE content — the
 * condition under which "Card" is offered at all (runbook: "Only offer it
 * when the paragraph contains nothing but that link").
 *
 * `editor.prosemirrorState` (a public getter, `BlockNoteEditor.ts`) rather
 * than a BlockNote-level API: there is no first-class "get the block at an
 * arbitrary hovered position" helper, since `getTextCursorPosition()` only
 * answers for an actual selection, which a MOUSE-hovered link never has.
 */
function isLinkOnlyParagraph(
  editor: Pick<BlockNoteEditor, "prosemirrorState">,
  range: { from: number },
  text: string,
): boolean {
  const $pos = editor.prosemirrorState.doc.resolve(range.from);
  return $pos.parent.type.name === "paragraph" && $pos.parent.textContent === text;
}

/** Walks up from a doc position to the enclosing block's BlockNote id
 * (the `blockContainer` node BlockNote wraps every block in), for
 * `editor.replaceBlocks` — which identifies blocks by id, not by position. */
function findBlockContainerId(
  editor: Pick<BlockNoteEditor, "prosemirrorState">,
  pos: number,
): string | undefined {
  const $pos = editor.prosemirrorState.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "blockContainer") return node.attrs.id as string | undefined;
  }
  return undefined;
}

/** The "Card" button added to the link hover toolbar — inline link -> card. */
function CardButton(props: LinkToolbarProps) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;

  if (!isLinkOnlyParagraph(editor, props.range, props.text)) return null;

  return (
    <Components.LinkToolbar.Button
      className="bn-button"
      mainTooltip="Card"
      label="Card"
      isSelected={false}
      onClick={() => {
        const blockId = findBlockContainerId(editor, props.range.from);
        if (!blockId) return;
        editor.replaceBlocks(
          [blockId],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          [{ type: "linkPreview", props: { href: props.url } } as any],
        );
        // The toolbar (and this very button) is removed from the DOM by this
        // replace, since the link it was anchored to no longer exists. A
        // focused element vanishing from the DOM drops focus to <body>
        // WITHOUT bubbling a blur through `.bn-field`'s wrapper — found live,
        // clicking "Card" then clicking any other field silently discarded
        // the conversion instead of committing it (`MarkdownEditor`'s
        // `onBlur` never fired because focus had already left the editor
        // before that later click). Re-focusing the editor here means the
        // NEXT blur is an ordinary one, off the actual contenteditable.
        editor.focus();
      }}
      icon={<LayoutTemplate className="size-4" aria-hidden />}
    />
  );
}

/** The default link toolbar plus the "Card" button, in `EditLinkButton`'s
 * usual middle slot. */
function LinkToolbarWithCard(props: LinkToolbarProps) {
  return (
    <LinkToolbar {...props}>
      <EditLinkButton
        url={props.url}
        text={props.text}
        range={props.range}
        setToolbarOpen={props.setToolbarOpen}
        setToolbarPositionFrozen={props.setToolbarPositionFrozen}
      />
      <OpenLinkButton url={props.url} />
      <CardButton {...props} />
      <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
    </LinkToolbar>
  );
}

interface MarkdownEditorProps {
  /** Markdown. Read once, at mount — see the seeding note below. */
  value: string;
  placeholder?: string;
  editable?: boolean;
  ariaLabel: string;
  className?: string;
  onCommit: (next: string) => void;
}

export default function MarkdownEditor({
  value,
  placeholder,
  editable = true,
  ariaLabel,
  className,
  onCommit,
}: MarkdownEditorProps) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    schema: SCHEMA,
    // Via the dictionary rather than the (deprecated) `placeholders` option.
    dictionary: placeholder
      ? { ...en, placeholders: { ...en.placeholders, emptyDocument: placeholder } }
      : en,
  });

  /**
   * Guards against writing back content nobody typed.
   *
   * Markdown -> blocks -> markdown is NOT a fixed point: `*` bullets come back
   * as `-`, spacing normalizes, and so on. Seeding the editor fires `onChange`,
   * so without this every open of a sheet would commit a rewritten-but-unedited
   * body — one spurious sync operation per todo per view, on every device.
   *
   * A ref rather than state: flipping it must not re-render, and `onChange` has
   * to observe the new value synchronously in the same tick as the seed.
   */
  const seeded = useRef(false);

  /** The last markdown we know is persisted, so blur can skip a no-op write. */
  const committed = useRef(value);

  useEffect(() => {
    // `value` is deliberately absent from the dependencies. This component is
    // remounted by key when the underlying record changes (see `TodoSheet` and
    // `DaySheet`), so re-seeding on prop change would only ever fight the user's
    // own in-flight typing — the local write lands, `useLiveQuery` repaints, and
    // the new `value` would blow away the cursor mid-sentence.
    //
    // `extractLinkPreviewFences`/`inflateLinkPreviewBlocks`
    // (`src/lib/link-preview-markdown.ts`) sit ahead of and after
    // `tryParseMarkdownToBlocks` rather than relying on the linkPreview
    // block's own `parse` rule — see that module's header for why a custom
    // block competing with BlockNote's built-in `codeBlock` parsing doesn't
    // work.
    const { markdown, urls } = extractLinkPreviewFences(value);
    const parsed = editor.tryParseMarkdownToBlocks(markdown);
    const blocks = inflateLinkPreviewBlocks(parsed, urls);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.replaceBlocks(editor.document, blocks as any);
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const commit = () => {
    if (!seeded.current) return;
    // Mirror image of the seed effect: swap live `linkPreview` blocks for
    // placeholders before asking BlockNote to serialize, then restore the
    // fences in the resulting string.
    const { blocks, urls } = deflateLinkPreviewBlocks(editor.document);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = editor.blocksToMarkdownLossy(blocks as any);
    const next = restoreLinkPreviewFences(raw, urls);
    if (next === committed.current) return;
    committed.current = next;
    onCommit(next);
  };

  return (
    <div
      // focusout bubbles, so this catches focus leaving anything inside the
      // editor — including its toolbars. Commit only when focus lands outside
      // the whole widget, or clicking from the text into the format menu would
      // count as a blur.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        commit();
      }}
      className={cn("bn-field", className)}
    >
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={theme}
        aria-label={ariaLabel}
        sideMenu={false}
        linkToolbar={false}
      >
        <SideMenuController
          floatingUIOptions={{
            useFloatingOptions: { middleware: SIDE_MENU_MIDDLEWARE },
          }}
        />
        <LinkToolbarController linkToolbar={LinkToolbarWithCard} />
      </BlockNoteView>
    </div>
  );
}
