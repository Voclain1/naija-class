import * as crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { GoneError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { UsersService } from "../users/users.service";
import { InvitationsService } from "./invitations.service";

// Integration spec — real Postgres. Covers the bug classes that matter:
//   - SECURITY DEFINER lookup wiring (resolveOrThrow)
//   - Atomic claim → user → role → audit transaction (race condition test)
//   - 404 vs 410 status discrimination
//   - PII never leaked through the public DTO

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23889${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("InvitationsService (Slice 7)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const authService = new AuthService();
  const usersService = new UsersService();
  const invitationsService = new InvitationsService();

  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Build a fresh ACTIVE school with an owner that can issue invitations.
  async function createActiveSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Inv Spec Academy ${suffix}`,
        schoolSlug: `inv-${suffix}-${runId}`,
        ownerFirstName: "Ola",
        ownerLastName: "Owner",
        ownerEmail: `inv-owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      ctx,
    );
    schoolIdsToCleanup.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return {
      schoolId: signed.school.id,
      ownerId: signed.user.id,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  // -----------------------------------------------------------------------
  // getByToken
  // -----------------------------------------------------------------------

  describe("getByToken", () => {
    it("happy path — returns PublicInvitationDto with no schoolId/invitationId/tokenHash", async () => {
      const { authCtx } = await createActiveSchool("get-ok");
      const created = await usersService.invite(
        authCtx,
        {
          email: `get-ok-${runId}@example.test`,
          firstName: "Inv",
          lastName: "Itee",
        },
        ctx,
      );

      const dto = await invitationsService.getByToken(created.token);

      expect(dto.schoolName).toBe(`Inv Spec Academy get-ok`);
      expect(dto.roleKey).toBe("admin");
      expect(dto.email).toBe(`get-ok-${runId}@example.test`);
      expect(dto.firstName).toBe("Inv");
      expect(dto.lastName).toBe("Itee");
      expect(dto.invitedByName).toBe("Ola Owner");

      // Public-safe shape: no internal ids on the wire. The DTO has a
      // friendly `invitedByName` field for "Invited by Jane Doe"; what it
      // must NOT have is the structured `invitedBy: { id, ... }` shape
      // used by the authed listing endpoint, nor any raw schoolId / tokenHash.
      const flat = JSON.stringify(dto);
      expect(flat).not.toContain(created.invitation.id);
      expect(flat).not.toContain("tokenHash");
      expect((dto as unknown as Record<string, unknown>).schoolId).toBeUndefined();
      expect((dto as unknown as Record<string, unknown>).invitedBy).toBeUndefined();
    });

    it("bogus token — NotFoundError (404)", async () => {
      const bogus = crypto.randomBytes(32).toString("base64url");
      await expect(invitationsService.getByToken(bogus)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("already-accepted token — GoneError INVITATION_ALREADY_ACCEPTED (410)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("get-accepted");
      const created = await usersService.invite(
        authCtx,
        { email: `accepted-get-${runId}@example.test` },
        ctx,
      );
      await withTenant(schoolId, (db) =>
        db.invitation.update({
          where: { id: created.invitation.id },
          data: { acceptedAt: new Date() },
        }),
      );

      await expect(invitationsService.getByToken(created.token)).rejects.toMatchObject({
        code: "INVITATION_ALREADY_ACCEPTED",
      });
      await expect(invitationsService.getByToken(created.token)).rejects.toBeInstanceOf(GoneError);
    });

    it("expired token — GoneError INVITATION_EXPIRED (410)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("get-expired");
      const created = await usersService.invite(
        authCtx,
        { email: `expired-get-${runId}@example.test` },
        ctx,
      );
      await withTenant(schoolId, (db) =>
        db.invitation.update({
          where: { id: created.invitation.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        }),
      );

      await expect(invitationsService.getByToken(created.token)).rejects.toMatchObject({
        code: "INVITATION_EXPIRED",
      });
    });
  });

  // -----------------------------------------------------------------------
  // accept
  // -----------------------------------------------------------------------

  describe("accept", () => {
    const acceptInput = {
      firstName: "Acc",
      lastName: "Epted",
      password: "Strong-Pass-9",
      ndprConsent: true as const,
    };

    it("happy path — creates user, assigns admin role, mints session, writes audit, marks accepted", async () => {
      const { authCtx, schoolId } = await createActiveSchool("acc-ok");
      const created = await usersService.invite(
        authCtx,
        { email: `acc-ok-${runId}@example.test`, firstName: "Acc", lastName: "Epted" },
        ctx,
      );

      const res = await invitationsService.accept(created.token, acceptInput, ctx);

      // Response shape mirrors LoginResponse.
      expect(res.user.email).toBe(`acc-ok-${runId}@example.test`);
      expect(res.user.firstName).toBe("Acc");
      expect(res.user.lastName).toBe("Epted");
      expect(res.school.id).toBe(schoolId);
      expect(res.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

      // User row was created with the admin role grant.
      const grant = await withTenant(schoolId, (db) =>
        db.userRole.findFirst({
          where: { userId: res.user.id },
          select: { role: { select: { key: true } } },
        }),
      );
      expect(grant?.role.key).toBe("admin");

      // Invitation row is now marked accepted.
      const inv = await withTenant(schoolId, (db) =>
        db.invitation.findUnique({
          where: { id: created.invitation.id },
          select: { acceptedAt: true },
        }),
      );
      expect(inv?.acceptedAt).toBeInstanceOf(Date);

      // Session row exists for the new user.
      const sessions = await withTenant(schoolId, (db) =>
        db.session.count({ where: { userId: res.user.id } }),
      );
      expect(sessions).toBeGreaterThanOrEqual(1);

      // Audit row written, with redacted email + no raw token.
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { action: "invitation.accept", userId: res.user.id },
        }),
      );
      expect(audit).toBeTruthy();
      const meta = audit!.metadata as Record<string, unknown>;
      expect(meta.email).not.toBe(`acc-ok-${runId}@example.test`);
      expect(meta.roleKey).toBe("admin");
      expect(JSON.stringify(meta)).not.toContain(res.token);
    });

    it("expired token — GoneError INVITATION_EXPIRED", async () => {
      const { authCtx, schoolId } = await createActiveSchool("acc-expired");
      const created = await usersService.invite(
        authCtx,
        { email: `acc-expired-${runId}@example.test` },
        ctx,
      );
      await withTenant(schoolId, (db) =>
        db.invitation.update({
          where: { id: created.invitation.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        }),
      );

      await expect(
        invitationsService.accept(created.token, acceptInput, ctx),
      ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });
    });

    it("already-accepted token — GoneError INVITATION_ALREADY_ACCEPTED", async () => {
      const { authCtx, schoolId } = await createActiveSchool("acc-twice");
      const created = await usersService.invite(
        authCtx,
        { email: `acc-twice-${runId}@example.test` },
        ctx,
      );
      await invitationsService.accept(created.token, acceptInput, ctx);

      // Second attempt with same token
      await expect(
        invitationsService.accept(created.token, acceptInput, ctx),
      ).rejects.toMatchObject({ code: "INVITATION_ALREADY_ACCEPTED" });

      // And only one user row was created for that email.
      const users = await withTenant(schoolId, (db) =>
        db.user.findMany({ where: { email: `acc-twice-${runId}@example.test` } }),
      );
      expect(users).toHaveLength(1);
    });

    it("bogus token — NotFoundError", async () => {
      const bogus = crypto.randomBytes(32).toString("base64url");
      await expect(
        invitationsService.accept(bogus, acceptInput, ctx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("race condition — two concurrent accepts: exactly one succeeds, the other gets INVITATION_ALREADY_ACCEPTED", async () => {
      const { authCtx, schoolId } = await createActiveSchool("acc-race");
      const created = await usersService.invite(
        authCtx,
        { email: `acc-race-${runId}@example.test` },
        ctx,
      );

      // Fire both concurrently. The atomic claim (UPDATE ... WHERE
      // acceptedAt IS NULL) inside withTenant's $transaction should serialise
      // them: exactly one updates the row, the other sees count=0 and
      // throws GoneError.
      const [a, b] = await Promise.allSettled([
        invitationsService.accept(created.token, acceptInput, ctx),
        invitationsService.accept(created.token, acceptInput, ctx),
      ]);

      const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
      const rejected = [a, b].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ code: "INVITATION_ALREADY_ACCEPTED" });

      // Exactly one user with that email exists.
      const users = await withTenant(schoolId, (db) =>
        db.user.findMany({ where: { email: `acc-race-${runId}@example.test` } }),
      );
      expect(users).toHaveLength(1);

      // Exactly one invitation.accept audit row.
      const auditCount = await withTenant(schoolId, (db) =>
        db.auditLog.count({
          where: { action: "invitation.accept", entityId: created.invitation.id },
        }),
      );
      expect(auditCount).toBe(1);
    });
  });
});
