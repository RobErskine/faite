"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAvatar } from "@/lib/profile";
import { useIdentity } from "@/lib/use-identity";
import type { Settings } from "@/lib/schema";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  settings: Settings | undefined;
  className?: string;
  /**
   * Hide the initials/emoji from assistive tech. Set where the avatar sits
   * inside a control that names itself ("Account" in the header): the
   * initials are then visible text the name does not contain, a WCAG 2.5.3
   * Label-in-Name mismatch (EI-377). The glyph is then drawn as generated
   * content rather than text (EI-391).
   */
  decorative?: boolean;
}

/**
 * Top-level rather than under board/ or settings/: both the header and the
 * profile settings section render it, so it belongs to neither.
 *
 * Base UI's Avatar falls back automatically when AvatarImage fails to load,
 * so a dead remote URL degrades to initials for free — no error handling
 * needed here.
 */
export function UserAvatar({ settings, className, decorative }: UserAvatarProps) {
  // Read internally rather than taken as a prop, so every render site gets the
  // signed-in identity without threading it — and so the settings preview and
  // the header cannot drift apart.
  const identity = useIdentity();
  const avatar = resolveAvatar(settings, identity);

  const glyph = avatar.kind === "emoji" && avatar.emoji ? avatar.emoji : avatar.initials;

  return (
    <Avatar className={cn(className)} aria-hidden={decorative || undefined}>
      {avatar.kind === "image" && avatar.imageSrc ? (
        <AvatarImage src={avatar.imageSrc} alt="" />
      ) : null}
      {/*
        `text-foreground/60` over the fallback's `bg-muted` (EI-378): the
        shared muted ink measured 4.35:1 there, just under 4.5:1 for 12px
        initials. 5.11:1 light, 6.15:1 dark.

        Decorative, the glyph is drawn by CSS, not written as text (EI-391).
        `aria-hidden` alone was not enough: axe's (and so Lighthouse's)
        `label-content-name-mismatch` takes "visible text" from what is on
        screen, not from what assistive tech gets, so "LU" inside an
        "Account" trigger still failed WCAG 2.5.3. Generated content is not a
        text node, so it is not a label to match; `aria-hidden` stays for
        browsers that would otherwise read it.
      */}
      <AvatarFallback
        className={cn("text-foreground/60", decorative && "before:content-[attr(data-glyph)]")}
        data-glyph={decorative ? glyph : undefined}
      >
        {decorative ? null : glyph}
      </AvatarFallback>
    </Avatar>
  );
}
