"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Download, FileText, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ALLOWED_MIME_TYPES,
  AttachmentError,
  attachmentUrl,
  formatBytes,
  maxAttachmentMb,
  previewKindFor,
} from "@/lib/attachments";
import { AttachmentPreview } from "@/components/board/attachment-preview";
import type { Attachment } from "@/lib/schema";
import { useAttachments } from "@/lib/store/hooks";
import { createAttachment, deleteAttachment } from "@/lib/store/repositories";
import { cn } from "@/lib/utils";

/** Never changes within a page's life — same rationale as `useOnline` in
 * `settings/api-keys-section.tsx`, copied rather than extracted because that
 * is the third site and none of them wants a shared module for four lines. */
const subscribeToNothing = () => () => {};

/** Only `false` is trusted — it means definitely offline. `true` lies behind
 * a captive portal, which is fine here: an upload attempted through one fails
 * with a readable "You're offline" from `uploadAttachment` anyway. Wrapped in
 * `useSyncExternalStore` because `navigator` doesn't exist during the static
 * export's prerender. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => navigator.onLine !== false, () => true);
}

/**
 * Files attached to one todo (EI-242) — the Attachments section of
 * `TodoSheet`, between Notes and History.
 *
 * Self-contained rather than prop-threaded: it reads `useAttachments` and
 * calls the repository directly, the way `activity-sheet.tsx` and the
 * Settings sections already do. Nothing above it in the tree has any use for
 * this data, so routing it through `use-board-data` -> `board.tsx` ->
 * `TodoSheet` would be three files of plumbing for one consumer.
 *
 * `TodoSheetContent` is keyed by todo id, so this remounts per todo and the
 * upload state below never leaks between them.
 *
 * ## Offline
 *
 * Attachments are the one part of this app that genuinely needs the network:
 * the bytes live in R2, not Dexie (see `lib/attachments.ts`). Rather than let
 * that surface as a failed upload or a broken image, the section says so —
 * the picker is disabled and the rows render as plain text. That is a real
 * v1 limitation being stated, not hidden.
 */

/** Returns an ELEMENT, not a component type: aliasing a component inside a
 * render body trips `react-hooks/static-components`, and the alias bought
 * nothing here — there is exactly one use site. */
function iconFor(mimeType: string) {
  return mimeType.startsWith("image/") ? (
    <ImageIcon className="size-4" aria-hidden />
  ) : (
    <FileText className="size-4" aria-hidden />
  );
}

interface AttachmentRowProps {
  attachment: Attachment;
  online: boolean;
  onRemove: (attachment: Attachment) => void;
  onPreview: (attachment: Attachment) => void;
}

function AttachmentRow({ attachment, online, onRemove, onPreview }: AttachmentRowProps) {
  const isImage = attachment.mimeType.startsWith("image/");
  const href = attachmentUrl(attachment.id);
  // Offline the bytes are unreachable, so opening a preview would show a
  // spinner that never resolves. The row goes inert instead.
  const canPreview = online && previewKindFor(attachment.mimeType) !== null;

  return (
    <li className="flex items-center gap-2">
      {/*
        A real <img> pointing at the session-authenticated route, not a
        fetched blob URL: the browser's own cache then serves repeat views,
        which is what `Cache-Control: private, immutable` on that response is
        for, and there is no object URL to revoke. `next/image` is not usable
        here — the source is a runtime API route, not a known asset.
      */}
      {isImage && online ? (
        <button
          type="button"
          onClick={() => onPreview(attachment)}
          className="focus-ring shrink-0 rounded"
          // The filename button beside this one carries the accessible name
          // for the same action; a second identical label would just be two
          // stops on the same destination for a screen-reader user.
          aria-hidden
          tabIndex={-1}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={href}
            alt=""
            className="size-8 rounded border border-border object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">
          {iconFor(attachment.mimeType)}
        </span>
      )}

      {/*
        A button, not the whole `<li>` — the row already contains a download
        link and a remove button, and nesting controls inside a clickable
        container is how you get a click target that swallows both.
      */}
      {canPreview ? (
        <button
          type="button"
          onClick={() => onPreview(attachment)}
          className="focus-ring min-w-0 flex-1 rounded-sm text-left hover:underline"
          aria-label={`Preview ${attachment.filename}`}
        >
          <span className="block truncate text-sm">{attachment.filename}</span>
          <span className="block text-xs text-muted-foreground">
            {formatBytes(attachment.byteSize)}
          </span>
        </button>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{attachment.filename}</span>
          <span className="block text-xs text-muted-foreground">
            {formatBytes(attachment.byteSize)}
          </span>
        </span>
      )}

      {/*
        A real anchor styled as a button, not `<Button asChild>` — this
        `Button` wraps a primitive that has no `asChild`. `download` names the
        saved file; the server also sends `Content-Disposition: attachment`,
        so this is a convenience, not the thing that stops an upload from
        rendering inline.
      */}
      {online && (
        <a
          href={href}
          download={attachment.filename}
          aria-label={`Download ${attachment.filename}`}
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-6 shrink-0")}
        >
          <Download className="size-3.5" aria-hidden />
        </a>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(attachment)}
        aria-label={`Remove ${attachment.filename}`}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </li>
  );
}

export function AttachmentsSection({ todoId }: { todoId: string }) {
  const attachments = useAttachments(todoId);
  const online = useOnline();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held by id, not by object: the row re-renders from Dexie on every sync,
  // so a captured object would go stale while the dialog is open.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewing = attachments.find((a) => a.id === previewId) ?? null;

  const handlePick = async (file: File | undefined) => {
    // Clearing the input BEFORE the await, so picking the same file twice in
    // a row still fires `change` the second time.
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      await createAttachment(file, todoId);
    } catch (caught) {
      // `AttachmentError` messages are written for a person and say what to
      // do about it. Anything else is a bug or an outage and must not have
      // its raw message shown.
      setError(
        caught instanceof AttachmentError
          ? caught.message
          : "That file could not be attached.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (attachment: Attachment) => {
    setError(null);
    try {
      await deleteAttachment(attachment.id);
    } catch {
      setError("That file could not be removed.");
    }
  };

  return (
    <section className="space-y-1.5">
      <Label>
        Attachments
        {attachments.length > 0 && (
          <span className="font-normal text-muted-foreground"> ({attachments.length})</span>
        )}
      </Label>

      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              online={online}
              onRemove={handleRemove}
              onPreview={(a) => setPreviewId(a.id)}
            />
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(event) => void handlePick(event.target.files?.[0])}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("w-full justify-start gap-2", busy && "opacity-70")}
        disabled={busy || !online}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-3.5" aria-hidden />
        {busy ? "Uploading…" : "Attach a file"}
      </Button>

      <p className="text-xs text-muted-foreground">
        {online
          ? `Images, PDF, CSV and text. Up to ${maxAttachmentMb(false)} MB each.`
          : "Attachments need a connection — they're stored online, not on this device."}
      </p>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <AttachmentPreview
        attachment={previewing}
        onOpenChange={(open) => !open && setPreviewId(null)}
      />
    </section>
  );
}
