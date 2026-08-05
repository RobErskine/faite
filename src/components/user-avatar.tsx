"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveAvatar } from "@/lib/profile";
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
  const avatar = resolveAvatar(settings);

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
