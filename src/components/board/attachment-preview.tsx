"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  attachmentPreviewUrl,
  attachmentUrl,
  fetchAttachmentText,
  formatBytes,
  MAX_PREVIEW_CSV_ROWS,
  previewKindFor,
} from "@/lib/attachments";
import { parseCsv } from "@/lib/csv";
import type { Attachment } from "@/lib/schema";
import { cn } from "@/lib/utils";

/**
 * Full-size preview of one attachment (EI-243).
 *
 * ## What renders what, and why it differs
 *
 * - **Images** — a plain `<img>`. The download route already serves verified
 *   raster types `inline`, so this needs nothing special.
 * - **PDF** — an `<iframe>` at `?preview=1`, which is the only thing that
 *   makes the server send `inline` for a PDF, and which also attaches
 *   `Content-Security-Policy: sandbox`. The PDF therefore renders in an
 *   opaque origin: no script, no cookies, no reach into `myfaite.app`.
 * - **CSV and text** — FETCHED AS TEXT and drawn by us. Nothing is ever handed
 *   to the browser as markup, so there is no path from file contents to
 *   executed anything. This is also why markdown previews as source rather
 *   than rendered: rendering it would mean an HTML pipeline over an
 *   untrusted file, for a nicety.
 * - **Anything else** — no preview, and it says so. An honest empty state
 *   beats a viewer that shows a blank rectangle.
 */

interface AttachmentPreviewProps {
  /** The attachment to show, or null when the dialog is closed. */
  attachment: Attachment | null;
  onOpenChange: (open: boolean) => void;
}

/** Fetch-and-decode state for the two kinds we render ourselves. */
type TextState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; text: string; truncated: boolean };

function TextPreview({ attachment }: { attachment: Attachment }) {
  const [state, setState] = useState<TextState>({ status: "loading" });
  const isCsv = previewKindFor(attachment.mimeType) === "csv";

  // No `setState({status:"loading"})` reset here — `PreviewBody` keys this
  // component by attachment id, so switching files REMOUNTS it and the
  // initial state is the reset. That is also what `react-hooks`'
  // set-state-in-effect rule is pointing at: a synchronous setState in an
  // effect body is a render the component could have started in.
  useEffect(() => {
    let cancelled = false;
    fetchAttachmentText(attachment.id)
      .then((result) => {
        // The dialog can be closed, or switched to another attachment, while
        // this is in flight — writing state then would show one file's
        // contents under another file's name.
        if (!cancelled) setState({ status: "ready", ...result });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id]);

  if (state.status === "loading") {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span className="sr-only">Loading preview</span>
      </div>
    );
  }
  if (state.status === "error") {
    return <p className="py-8 text-center text-muted-foreground">That file could not be read.</p>;
  }

  const note = state.truncated ? "Showing the beginning of the file — download it for the rest." : null;

  if (!isCsv) {
    return (
      <div className="space-y-2">
        {/* `<pre>` with text content — React escapes it, so the file cannot
            contribute markup no matter what is in it. */}
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {state.text}
        </pre>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    );
  }

  const rows = parseCsv(state.text);
  if (rows.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">That file is empty.</p>;
  }

  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_PREVIEW_CSV_ROWS);
  const hidden = body.length - shown.length;
  // Ragged rows stay ragged in the parse (see `csv.ts`); padding happens here,
  // for display only, so a short row renders as empty cells rather than
  // collapsing the table.
  const columns = Math.max(header.length, ...body.map((r) => r.length));
  const pad = (row: string[]) => Array.from({ length: columns }, (_, i) => row[i] ?? "");

  return (
    <div className="space-y-2">
      <div className="max-h-[60vh] overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {pad(header).map((cell, i) => (
                <th key={i} className="border-b px-2 py-1.5 text-left font-medium whitespace-nowrap">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="even:bg-muted/40">
                {pad(row).map((cell, c) => (
                  <td key={c} className="border-b px-2 py-1 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hidden > 0 || state.truncated) && (
        <p className="text-xs text-muted-foreground">
          {hidden > 0 && `${hidden} more ${hidden === 1 ? "row" : "rows"} not shown. `}
          {note}
        </p>
      )}
    </div>
  );
}

function PreviewBody({ attachment }: { attachment: Attachment }) {
  const kind = previewKindFor(attachment.mimeType);

  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={attachmentUrl(attachment.id)}
        alt={attachment.filename}
        className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain"
      />
    );
  }

  if (kind === "pdf") {
    return (
      // NO `sandbox` attribute, deliberately, and this is the one decision
      // in the file worth reading before changing.
      //
      // Chrome's built-in PDF viewer refuses to render inside a sandboxed
      // iframe — measured with `sandbox=""`, `sandbox="allow-scripts"`, and
      // `sandbox="allow-scripts allow-popups"`. All three show a broken-file
      // icon and nothing else: no error, no console warning, a 200 response
      // with the right bytes.
      //
      // Containment comes from the ORIGIN instead (EI-244). `src` resolves,
      // via a 302, to `files.myfaite.app` — so this frame is cross-origin and
      // the same-origin policy isolates it: the app cannot read its
      // `contentDocument`, and its `localStorage` throws `SecurityError`.
      // Both measured. That is containment AND rendering, which no sandbox
      // flag could give.
      //
      // Re-adding `sandbox` would break rendering again and protect nothing
      // the origin split does not already cover. See docs/ATTACHMENTS.md
      // §"How the PDF preview is contained".
      <iframe
        src={attachmentPreviewUrl(attachment.id)}
        title={attachment.filename}
        className="h-[70vh] w-full rounded-md border bg-muted"
      />
    );
  }

  // Keyed so a switch between two text attachments starts clean rather than
  // showing the previous file's contents until the new fetch resolves.
  if (kind === "csv" || kind === "text") {
    return <TextPreview key={attachment.id} attachment={attachment} />;
  }

  return (
    <p className="py-8 text-center text-muted-foreground">
      No preview for this file type — download it to open it.
    </p>
  );
}

export function AttachmentPreview({ attachment, onOpenChange }: AttachmentPreviewProps) {
  return (
    <Dialog open={attachment !== null} onOpenChange={onOpenChange}>
      {/* Wider than the default `sm:max-w-sm`: this dialog exists to show
          something at a readable size, and a PDF at 24rem is not a preview. */}
      <DialogContent className="sm:max-w-3xl">
        {attachment && (
          <>
            <DialogHeader>
              {/* `pr-8` clears the absolutely-positioned close button. */}
              <DialogTitle className="truncate pr-8">{attachment.filename}</DialogTitle>
              <DialogDescription>{formatBytes(attachment.byteSize)}</DialogDescription>
            </DialogHeader>

            <PreviewBody attachment={attachment} />

            <div className="flex justify-end">
              <a
                href={attachmentUrl(attachment.id)}
                download={attachment.filename}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
              >
                <Download className="size-3.5" aria-hidden />
                Download
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
