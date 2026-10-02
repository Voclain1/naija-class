// Pure portal-status rules (packages/types/src/guardians/guardian-portal-status.ts).
// Spec'd HERE, not beside the source: packages/types has no test runner, so a
// spec next to it would never execute in CI.
import { describe, expect, it } from "vitest";

import { deriveGuardianPortalStatus } from "@school-kit/types";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const future = new Date("2026-09-20T12:00:00.000Z");
const past = new Date("2026-09-10T12:00:00.000Z");
const inv = (over: Partial<{ acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }> = {}) => ({
  acceptedAt: null,
  revokedAt: null,
  expiresAt: future,
  ...over,
});

describe("deriveGuardianPortalStatus", () => {
  // 2026-10-02 — the school's switch outranks every other fact.
  it("a guardian whose portal access the school switched off is DEACTIVATED, whatever else is true", () => {
    const cases = [
      { hasEmail: true, hasPassword: true, invitations: [] },
      { hasEmail: false, hasPassword: true, invitations: [] },
      { hasEmail: true, hasPassword: false, invitations: [inv()] },
      { hasEmail: true, hasPassword: false, invitations: [inv({ expiresAt: past })] },
      { hasEmail: true, hasPassword: false, invitations: [] },
    ];
    for (const facts of cases) {
      const out = deriveGuardianPortalStatus({ portalDisabled: true, ...facts }, NOW);
      expect(out.status).toBe("DEACTIVATED");
      // A live invitation must not be reported as if it were usable.
      expect(out.liveInvitationExpiresAt).toBeNull();
    }
  });

  it("switching access back on returns the guardian to what their facts say — ACTIVE, since the password was kept", () => {
    expect(
      deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: true, hasPassword: true, invitations: [] }, NOW)
        .status,
    ).toBe("ACTIVE");
  });

  it("a guardian with a password is ACTIVE", () => {
    expect(deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: true, hasPassword: true, invitations: [] }, NOW).status).toBe("ACTIVE");
  });

  it("stays ACTIVE even when an old invitation expired unaccepted", () => {
    const out = deriveGuardianPortalStatus(
      { portalDisabled: false, hasEmail: true, hasPassword: true, invitations: [inv({ expiresAt: past })] },
      NOW,
    );
    expect(out.status).toBe("ACTIVE");
  });

  it("a guardian with a password but NO email is NO_EMAIL — sign-in is by email, so they cannot get in", () => {
    expect(deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: false, hasPassword: true, invitations: [] }, NOW).status).toBe(
      "NO_EMAIL",
    );
  });

  it("no email is NO_EMAIL, and outranks any invitation state", () => {
    expect(deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: false, hasPassword: false, invitations: [] }, NOW).status).toBe("NO_EMAIL");
    expect(
      deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: false, hasPassword: false, invitations: [inv()] }, NOW).status,
    ).toBe("NO_EMAIL");
  });

  it("a live invitation is INVITED, and reports its expiry", () => {
    const out = deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv()] }, NOW);
    expect(out.status).toBe("INVITED");
    expect(out.liveInvitationExpiresAt?.toISOString()).toBe(future.toISOString());
  });

  it("an expired unaccepted invitation is EXPIRED, not NOT_INVITED", () => {
    const out = deriveGuardianPortalStatus(
      { portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv({ expiresAt: past })] },
      NOW,
    );
    expect(out.status).toBe("EXPIRED");
    expect(out.liveInvitationExpiresAt).toBeNull();
  });

  it("a revoked invitation leaves the guardian NOT_INVITED — never INVITED or EXPIRED", () => {
    expect(
      deriveGuardianPortalStatus(
        { portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv({ revokedAt: NOW })] },
        NOW,
      ).status,
    ).toBe("NOT_INVITED");
    expect(
      deriveGuardianPortalStatus(
        { portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv({ revokedAt: NOW, expiresAt: past })] },
        NOW,
      ).status,
    ).toBe("NOT_INVITED");
  });

  it("an accepted-but-passwordless invitation does not read as INVITED", () => {
    expect(
      deriveGuardianPortalStatus(
        { portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv({ acceptedAt: NOW })] },
        NOW,
      ).status,
    ).toBe("NOT_INVITED");
  });

  it("one live invitation wins over older expired ones, and reports the LIVE expiry", () => {
    const out = deriveGuardianPortalStatus(
      { portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv({ expiresAt: past }), inv()] },
      NOW,
    );
    expect(out.status).toBe("INVITED");
    expect(out.liveInvitationExpiresAt?.toISOString()).toBe(future.toISOString());
  });

  it("expiry is exclusive at the boundary — expiring exactly now is EXPIRED", () => {
    expect(
      deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [inv({ expiresAt: NOW })] }, NOW)
        .status,
    ).toBe("EXPIRED");
  });

  it("no invitations at all is NOT_INVITED", () => {
    expect(deriveGuardianPortalStatus({ portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [] }, NOW).status).toBe(
      "NOT_INVITED",
    );
  });

  it("accepts ISO strings as well as Dates", () => {
    const out = deriveGuardianPortalStatus(
      { portalDisabled: false, hasEmail: true, hasPassword: false, invitations: [{ acceptedAt: null, revokedAt: null, expiresAt: future.toISOString() }] },
      NOW,
    );
    expect(out.status).toBe("INVITED");
  });
});
