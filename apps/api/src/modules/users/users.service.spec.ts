import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { UsersService } from "./users.service";

// Integration spec — talks to real Postgres. Same rationale as
// schools.service.spec.ts and auth.service.spec.ts: the bug classes we
// care about (RLS, audit redaction, ACTIVE-vs-ONBOARDING gating, pending-
// invitation dedupe) only manifest against real rows.
//
// Each test creates its OWN school via the real signupOwner path so tests
// are independent and we exercise the realistic post-signup state.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("UsersService (Slice 7)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const authService = new AuthService();
  const usersService = new UsersService();

  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Creates a fresh school + owner via the real signup flow, then immediately
  // walks through onboarding to ACTIVE so the invite gate (status===ACTIVE)
  // is satisfied. Returns the owner's AuthContext.
  async function createActiveSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Users Spec Academy ${suffix}`,
        schoolSlug: `us-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      ctx,
    );
    schoolIdsToCleanup.add(signed.school.id);

    // Flip status to ACTIVE directly so we don't have to walk the whole
    // wizard for tests that aren't about onboarding.
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });

    return {
      schoolId: signed.school.id,
      userId: signed.user.id,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  // Creates an admin user inside an existing school. Same helper as
  // schools.service.spec.ts — direct withTenant insert because there's no
  // public "create-user-without-invitation" path.
  async function createAdminUser(schoolId: string, suffix: string) {
    const adminRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "admin", isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          firstName: "Adam",
          lastName: "Admin",
          email: `admin-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      await db.userRole.create({
        data: { userId: user.id, roleId: adminRole.id },
      });
      return {
        userId: user.id,
        authCtx: { sessionId: "sess-placeholder", userId: user.id, schoolId },
      };
    });
  }

  // -----------------------------------------------------------------------
  // invite — happy path + audit
  // -----------------------------------------------------------------------

  describe("invite", () => {
    it("owner invites — creates invitation row with hashed token, writes user.invite audit row", async () => {
      const { authCtx, schoolId } = await createActiveSchool("inv-owner");

      const result = await usersService.invite(
        authCtx,
        { email: `invitee-1-${runId}@example.test`, firstName: "Iva", lastName: "Invitee" },
        ctx,
      );

      // Returned shape
      expect(result.invitation.email).toBe(`invitee-1-${runId}@example.test`);
      expect(result.invitation.firstName).toBe("Iva");
      expect(result.invitation.lastName).toBe("Invitee");
      expect(result.invitation.roleKey).toBe("admin");
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(result.acceptUrl).toContain(`/invitations/${result.token}`);

      // Invitation row was persisted with the HASH not the raw token.
      const rows = await withTenant(schoolId, (db) =>
        db.invitation.findMany({
          where: { email: `invitee-1-${runId}@example.test` },
          select: { tokenHash: true, firstName: true, lastName: true },
        }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(result.token);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].firstName).toBe("Iva");
      expect(rows[0].lastName).toBe("Invitee");

      // Audit row written with redacted email, no raw token in metadata.
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { schoolId, action: "user.invite" } }),
      );
      expect(audit).toBeTruthy();
      const meta = audit!.metadata as Record<string, unknown>;
      expect(meta.roleKey).toBe("admin");
      // Redacted: not the literal email
      expect(meta.email).not.toBe(`invitee-1-${runId}@example.test`);
      // And no token anywhere in the audit metadata
      expect(JSON.stringify(meta)).not.toContain(result.token);
    });

    it("admin invites — succeeds (owner+admin policy)", async () => {
      const { schoolId } = await createActiveSchool("inv-admin");
      const { authCtx: adminCtx } = await createAdminUser(schoolId, "inv-admin");

      const result = await usersService.invite(
        adminCtx,
        { email: `invitee-2-${runId}@example.test` },
        ctx,
      );

      expect(result.invitation.id).toBeDefined();
    });

    it("user without owner/admin grant — ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("inv-nope");
      const { authCtx: noRoleCtx } = await withTenant(schoolId, async (db) => {
        const u = await db.user.create({
          data: {
            schoolId,
            firstName: "No",
            lastName: "Role",
            email: `norole-inv-${runId}@example.test`,
            phone: randomPhone(),
            passwordHash: "argon2id$placeholder",
          },
          select: { id: true },
        });
        return {
          authCtx: { sessionId: "sess-placeholder", userId: u.id, schoolId },
        };
      });

      await expect(
        usersService.invite(
          noRoleCtx,
          { email: `nope-${runId}@example.test` },
          ctx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("school still ONBOARDING — ConflictError SCHOOL_NOT_ACTIVE", async () => {
      const { authCtx, schoolId } = await createActiveSchool("inv-onb");
      // Reverse to ONBOARDING so the gate kicks in.
      await basePrisma.school.update({
        where: { id: schoolId },
        data: { status: "ONBOARDING", onboardingStep: 2 },
      });

      await expect(
        usersService.invite(
          authCtx,
          { email: `onboard-${runId}@example.test` },
          ctx,
        ),
      ).rejects.toMatchObject({ code: "SCHOOL_NOT_ACTIVE" });
    });

    it("invite for email already a user in this school — ConflictError EMAIL_TAKEN", async () => {
      const { authCtx, schoolId } = await createActiveSchool("inv-dup-user");

      // Plant a user with the target email.
      const targetEmail = `existing-${runId}@example.test`;
      await withTenant(schoolId, async (db) => {
        await db.user.create({
          data: {
            schoolId,
            firstName: "Existing",
            lastName: "Body",
            email: targetEmail,
            phone: randomPhone(),
            passwordHash: "argon2id$placeholder",
          },
        });
      });

      await expect(
        usersService.invite(authCtx, { email: targetEmail }, ctx),
      ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    });

    it("invite for email with pending unexpired invitation — ConflictError INVITATION_ALREADY_PENDING", async () => {
      const { authCtx } = await createActiveSchool("inv-dup-inv");
      const targetEmail = `dup-pending-${runId}@example.test`;

      // First invite OK
      await usersService.invite(authCtx, { email: targetEmail }, ctx);
      // Second invite for same email should be rejected
      await expect(
        usersService.invite(authCtx, { email: targetEmail }, ctx),
      ).rejects.toMatchObject({ code: "INVITATION_ALREADY_PENDING" });
    });

    it("accept URL respects WEB_BASE_URL env var", async () => {
      const { authCtx } = await createActiveSchool("inv-url");

      const original = process.env.WEB_BASE_URL;
      process.env.WEB_BASE_URL = "https://prod.example.test";
      try {
        const result = await usersService.invite(
          authCtx,
          { email: `url-${runId}@example.test` },
          ctx,
        );
        expect(result.acceptUrl.startsWith("https://prod.example.test/invitations/")).toBe(true);
      } finally {
        if (original === undefined) delete process.env.WEB_BASE_URL;
        else process.env.WEB_BASE_URL = original;
      }
    });
  });

  // -----------------------------------------------------------------------
  // listUsers / listPendingInvitations
  // -----------------------------------------------------------------------

  describe("listUsers", () => {
    it("excludes the requester from the returned list", async () => {
      const { authCtx, schoolId, userId } = await createActiveSchool("list-self");

      // Create another user so the list isn't empty.
      await createAdminUser(schoolId, "list-self");

      const users = await usersService.listUsers(authCtx);
      expect(users.length).toBeGreaterThanOrEqual(1);
      expect(users.every((u) => u.id !== userId)).toBe(true);
    });

    it("rejects callers without owner/admin role", async () => {
      const { schoolId } = await createActiveSchool("list-nope");
      const { authCtx: noRoleCtx } = await withTenant(schoolId, async (db) => {
        const u = await db.user.create({
          data: {
            schoolId,
            firstName: "No",
            lastName: "Role",
            email: `list-norole-${runId}@example.test`,
            phone: randomPhone(),
            passwordHash: "argon2id$placeholder",
          },
          select: { id: true },
        });
        return {
          authCtx: { sessionId: "sess-placeholder", userId: u.id, schoolId },
        };
      });

      await expect(usersService.listUsers(noRoleCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("listPendingInvitations", () => {
    it("returns only invitations that are not accepted AND not expired, with inviter denormalised", async () => {
      const { authCtx, schoolId, userId } = await createActiveSchool("list-inv");

      // Create three invitations: one fresh, one already accepted, one expired.
      const fresh = await usersService.invite(
        authCtx,
        { email: `fresh-${runId}@example.test` },
        ctx,
      );
      const accepted = await usersService.invite(
        authCtx,
        { email: `accepted-${runId}@example.test` },
        ctx,
      );
      const expired = await usersService.invite(
        authCtx,
        { email: `expired-${runId}@example.test` },
        ctx,
      );

      // Mark one accepted, push another into the past.
      await withTenant(schoolId, async (db) => {
        await db.invitation.update({
          where: { id: accepted.invitation.id },
          data: { acceptedAt: new Date() },
        });
        await db.invitation.update({
          where: { id: expired.invitation.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });
      });

      const pending = await usersService.listPendingInvitations(authCtx);
      const emails = pending.map((p) => p.email);
      expect(emails).toContain(`fresh-${runId}@example.test`);
      expect(emails).not.toContain(`accepted-${runId}@example.test`);
      expect(emails).not.toContain(`expired-${runId}@example.test`);

      const freshOut = pending.find((p) => p.id === fresh.invitation.id);
      expect(freshOut?.invitedBy.id).toBe(userId);
      expect(freshOut?.invitedBy.firstName).toBe("Owen");
    });
  });
});
