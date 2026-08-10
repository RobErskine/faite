"use client";

import { useEffect, useRef } from "react";
import { en } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/lib/use-resolved-theme";

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
    const blocks = editor.tryParseMarkdownToBlocks(value);
    editor.replaceBlocks(editor.document, blocks);
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const commit = () => {
    if (!seeded.current) return;
    const next = editor.blocksToMarkdownLossy(editor.document);
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
      />
    </div>
  );
}
