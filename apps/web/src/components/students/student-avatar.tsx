"use client";

import { cn } from "@/lib/utils";

interface Props {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-2xl",
} as const;

export function StudentAvatar({
  firstName,
  lastName,
  photoUrl,
  size = "md",
  className,
}: Props) {
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const sizeClass = SIZES[size];

  if (photoUrl) {
    return (
      // Plain <img> rather than next/image — photoUrl is free-text in Phase 1
      // (admins paste arbitrary URLs), so Next.js can't be given a configured
      // remotePatterns list yet. Phase 2/4 photo-upload will move these onto
      // R2 with a known host and we'll switch to next/image then.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`${firstName} ${lastName}`}
        className={cn(
          sizeClass,
          "shrink-0 rounded-full object-cover",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-label={`${firstName} ${lastName}`}
      className={cn(
        sizeClass,
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}
