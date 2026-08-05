"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAvatar } from "@/lib/profile";
import { useIdentity } from "@/lib/use-identity";
import type { Settings } from "@/lib/schema";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  settings: Settings | undefined;
  className?: string;
}

/**
 * Top-level rather than under board/ or settings/: both the header and the
 * profile settings section render it, so it belongs to neither.
 *
 * Base UI's Avatar falls back automatically when AvatarImage fails to load,
 * so a dead remote URL degrades to initials for free — no error handling
 * needed here.
 */
export function UserAvatar({ settings, className }: UserAvatarProps) {
  // Read internally rather than taken as a prop, so every render site gets the
  // signed-in identity without threading it — and so the settings preview and
  // the header cannot drift apart.
  const identity = useIdentity();
  const avatar = resolveAvatar(settings, identity);

  return (
    <Avatar className={cn(className)}>
      {avatar.kind === "image" && avatar.imageSrc ? (
        <AvatarImage src={avatar.imageSrc} alt="" />
      ) : null}
      <AvatarFallback>
        {avatar.kind === "emoji" && avatar.emoji ? avatar.emoji : avatar.initials}
      </AvatarFallback>
    </Avatar>
  );
}
