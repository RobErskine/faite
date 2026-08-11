"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

/**
 * A markdown-backed rich text field.
 *
 * Markdown is the STORED format, not BlockNote's own JSON, even though
 * BlockNote recommends its JSON as the lossless one. Three reasons:
 * `todoSchema.description` and `dayNoteSchema.body` both declare markdown, the
 * command palette substring-searches descriptions (JSON would fill search with
 * structural noise), and markdown stays portable and readable if it is ever
 * exported. The conversion is lossy in principle but covers CommonMark + GFM,
 * and this app defines no custom blocks, so nothing we can author is lost.
 *
 * See `markdown-editor.tsx` for the seeding/commit contract — in particular why
 * it must not write back content the user did not type.
 */

const MarkdownEditor = dynamic(() => import("./markdown-editor"), {
  ssr: false,
  // Matches the editor's own resting height so the sheet does not jump when the
  // chunk lands.
  loading: () => (
    <div className="min-h-24 animate-pulse rounded-lg border border-input bg-input/30" />
  ),
});

interface MarkdownFieldProps {
  /** Markdown. Seeded once per mount — key the field to re-seed it. */
  value: string;
  placeholder?: string;
  editable?: boolean;
  ariaLabel: string;
  className?: string;
  /** Called on blur, and only when the serialized markdown actually changed. */
  onCommit: (next: string) => void;
}

export function MarkdownField({ className, ...props }: MarkdownFieldProps) {
  return (
    <div
      data-slot="markdown-field"
      className={cn(
        "rounded-lg border border-input bg-transparent py-2 transition-colors",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        "dark:bg-input/30",
        className,
      )}
    >
      <MarkdownEditor {...props} />
    </div>
  );
}
