import type { PlatformAdminSchoolDto } from "@school-kit/types";

// Pure helpers for the super-admin school dialog and roster (platform-admin
// tools, slice 1). Kept apart from the components so they are unit-testable.

export type OwnerStatus =
  | { kind: "HAS_OWNER" }
  | { kind: "INVITE_PENDING"; expiresAt: string }
  | { kind: "NO_OWNER" };

// The owner situation a row is in. NO_OWNER covers both "the invitation
// expired" and "it was cancelled" — either way nobody can sign in as owner
// and no link is open, which is what the operator needs to act on.
export function ownerStatusOf(
  school: Pick<
    PlatformAdminSchoolDto,
    "hasOwner" | "ownerInvitePending" | "ownerInviteExpiresAt"
  >,
): OwnerStatus {
  if (school.hasOwner) return { kind: "HAS_OWNER" };
  if (school.ownerInvitePending && school.ownerInviteExpiresAt) {
    return { kind: "INVITE_PENDING", expiresAt: school.ownerInviteExpiresAt };
  }
  return { kind: "NO_OWNER" };
}

// "750,000", "750000" or " 750 000 " → 750000. Anything that is not a whole,
// non-negative number of tokens → null. Commas and spaces are allowed because
// that is how people write big numbers; decimals are not, because a token
// budget is a count.
export function parseTokenCount(text: string): number | null {
  const compact = text.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(compact)) return null;
  const n = Number(compact);
  return Number.isSafeInteger(n) ? n : null;
}

// Compact form for a table cell: 2000000 → "2M", 750000 → "750k".
export function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
