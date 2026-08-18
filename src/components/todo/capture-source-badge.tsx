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
 * Email (EI-186) is the first kind to exist. `browser`/`app` are the D5
 * desktop-capture kinds (`docs/DESKTOP.md`); they are handled here so that
 * work needs no UI change, not because anything writes them yet.
 */

interface SourceDisplay {
  icon: LucideIcon;
  label: string;
  /** The address/URL/app the capture came from, when there is one. */
  detail?: string;
}

export function describeSource(source: CapturedSource): SourceDisplay {
  switch (source.kind) {
    case "email":
      return { icon: Mail, label: "From email", detail: source.email?.from };
    case "browser":
      return { icon: Globe, label: "From browser", detail: source.pageTitle ?? source.url };
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

  const { icon: Icon, label, detail } = describeSource(parsed);

  return (
    <Badge variant="secondary" className={cn("max-w-full", className)}>
      <Icon aria-hidden />
      <span className="truncate">{detail ? `${label} · ${detail}` : label}</span>
    </Badge>
  );
}
