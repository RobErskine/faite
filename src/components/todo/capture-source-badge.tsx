import { AppWindow, Globe, Mail, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { parseSource, type CapturedSource } from "@/lib/capture-source";
import { cn } from "@/lib/utils";

/**
 * "Where did this todo come from" — the first reader of `Todo.source`.
 *
 * **Generic by construction, not by accident.** `capture-source.ts` types
 * `kind` as an open `z.string()` on purpose, and documents the contract for
 * render code: *treat an unrecognized kind as generic capture, not throw*. A
 * client shipped today has to survive a blob written by a client shipped
 * later. So the switch below always has a default arm, and
 * `capture-source-badge.test.tsx` asserts on that arm specifically.
 *
 * Email (EI-186) is the first kind to exist. `browser` gained its first
 * writer in EI-312 — the Raycast extension's Quick Add, which records the
 * active tab so a to-do links back to what you were looking at. `app` is
 * still D5 desktop-capture groundwork (`docs/DESKTOP.md`).
 */

interface SourceDisplay {
  icon: LucideIcon;
  label: string;
  /** The address/URL/app the capture came from, when there is one. */
  detail?: string;
  /**
   * Where the detail POINTS, when it points anywhere.
   *
   * Only a browser capture has one. Without it the URL is decorative — you
   * would have to retype what you were already looking at, which defeats the
   * point of capturing it (EI-312).
   */
  href?: string;
}

/**
 * Only `http(s)` may become an anchor.
 *
 * `url` is an open `z.string()` on a blob this build did not write — the
 * Raycast extension, a future mobile share sheet, a client that has not
 * shipped yet. Rendering it into an `href` unchecked would make
 * `javascript:` a live XSS vector via a synced field, so the scheme is
 * checked rather than assumed. An unparseable or non-web URL still renders
 * as TEXT; it simply is not a link.
 */
function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export function describeSource(source: CapturedSource): SourceDisplay {
  switch (source.kind) {
    case "email":
      return { icon: Mail, label: "From email", detail: source.email?.from };
    case "browser":
      return {
        icon: Globe,
        label: "From browser",
        detail: source.pageTitle ?? source.url,
        href: safeHref(source.url),
      };
    case "app":
      return { icon: AppWindow, label: "From app", detail: source.app?.name };
    default:
      // The documented fallback. A kind this build has never heard of is
      // still a real capture — say so rather than rendering nothing (which
      // reads as "manually created") or throwing.
      return { icon: Sparkles, label: "Captured" };
  }
}

interface CaptureSourceBadgeProps {
  /** The raw `Todo.source` blob. Malformed, truncated, or absent → nothing
   * renders; `parseSource` already returns null for all three. */
  source: string | null | undefined;
  className?: string;
}

export function CaptureSourceBadge({ source, className }: CaptureSourceBadgeProps) {
  const parsed = parseSource(source ?? null);
  if (!parsed) return null;

  const { icon: Icon, label, detail, href } = describeSource(parsed);
  const text = detail ? `${label} · ${detail}` : label;

  const content = (
    <>
      <Icon aria-hidden />
      <span className="truncate">{text}</span>
    </>
  );

  if (!href) {
    return (
      <Badge variant="secondary" className={cn("max-w-full", className)}>
        {content}
      </Badge>
    );
  }

  // `render`, not a nested anchor — Base UI's `useRender` makes the anchor
  // BE the badge, so the whole chip is the hit area. `badgeVariants` already
  // carries `[a]:hover:` styles, which is the giveaway that this was the
  // intended usage. Same pattern as `Button`'s `render={<a />}` elsewhere.
  return (
    <Badge
      variant="secondary"
      className={cn("max-w-full", className)}
      render={
        <a
          href={href}
          target="_blank"
          // `noreferrer` implies `noopener`; both are stated because this
          // opens a page the user happened to be on, not one we vouch for.
          rel="noreferrer noopener"
          title={detail}
        />
      }
    >
      {content}
    </Badge>
  );
}
