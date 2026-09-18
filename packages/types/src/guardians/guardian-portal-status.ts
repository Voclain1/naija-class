import type { GuardianPortalStatusDto } from "./guardian.dto.js";

// Deriving a guardian's portal standing (2026-09-16).
//
// Pure, and deliberately separate from the service: "can this parent get in?"
// is the question the whole parent-facing product depends on, and it is
// answered from three facts that live in two tables. Keeping it here means the
// roster, the student page and any future caller cannot disagree about it.
//
// ORDER MATTERS, and each step is a real-world case:
//   1. NO_EMAIL first — even ahead of ACTIVE. Portal sign-in looks a guardian
//      up BY EMAIL (auth_lookup_guardians_for_login), so a parent whose email
//      was removed cannot sign in, password or not. Calling them ACTIVE would
//      tell an admin access works when it does not. (First written the other
//      way round; a surviving mutation exposed it, 2026-09-16.) Adding the
//      email back restores ACTIVE, since the password is untouched.
//   2. ACTIVE next — a guardian with a password is active even if some older
//      invitation row also expired. Their password is the fact.
//   3. A live invitation (not accepted, not revoked, still in date) → INVITED.
//   4. Otherwise, if any invitation ever expired unaccepted → EXPIRED, which
//      is what makes "5 of 17 expired" visible on a roster instead of
//      indistinguishable from "never invited".
//   5. Otherwise NOT_INVITED — including the case where every invitation was
//      revoked, since a revoked invitation is one that was deliberately taken
//      back, leaving the guardian exactly where they started.
export interface GuardianPortalFacts {
  hasEmail: boolean;
  /** The guardian has a password_hash — they can sign in. Never the hash itself. */
  hasPassword: boolean;
  invitations: Array<{
    acceptedAt: Date | string | null;
    revokedAt: Date | string | null;
    expiresAt: Date | string;
  }>;
}

const ms = (v: Date | string): number => (v instanceof Date ? v.getTime() : new Date(v).getTime());

export function deriveGuardianPortalStatus(
  facts: GuardianPortalFacts,
  now: Date = new Date(),
): { status: GuardianPortalStatusDto; liveInvitationExpiresAt: Date | null } {
  if (!facts.hasEmail) return { status: "NO_EMAIL", liveInvitationExpiresAt: null };
  if (facts.hasPassword) return { status: "ACTIVE", liveInvitationExpiresAt: null };

  const t = now.getTime();
  const usable = facts.invitations.filter((i) => i.acceptedAt === null && i.revokedAt === null);

  let live: Date | null = null;
  for (const i of usable) {
    if (ms(i.expiresAt) > t && (live === null || ms(i.expiresAt) > live.getTime())) {
      live = new Date(ms(i.expiresAt));
    }
  }
  if (live !== null) return { status: "INVITED", liveInvitationExpiresAt: live };

  if (usable.some((i) => ms(i.expiresAt) <= t)) {
    return { status: "EXPIRED", liveInvitationExpiresAt: null };
  }
  return { status: "NOT_INVITED", liveInvitationExpiresAt: null };
}
