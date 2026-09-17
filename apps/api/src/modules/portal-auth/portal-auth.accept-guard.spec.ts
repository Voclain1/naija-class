import { createHash, randomBytes } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { GuardiansService } from "../guardians/guardians.service";
import { PortalAuthService } from "./portal-auth.service";

// Integration spec — real Postgres, real RLS, real SECURITY DEFINER resolver.
//
// THE HOLE THIS CLOSES (found 2026-09-16 while adding invite resend/revoke):
// accepting a guardian invitation unconditionally replaced the guardian's
// password and signed the acceptor in, and GuardiansService.invite never
// checked whether the guardian already had portal access. The admin UI shows
// staff the accept link. So an owner or admin could invite a parent who was
// ALREADY ACTIVE, open that link themselves, choose a password, and be signed
// in as the parent — who would then be locked out of their own account.
//
// The accept endpoint is the security boundary, so the decisive tests below
// bypass GuardiansService.invite entirely and insert the invitation row
// directly: that is exactly the state an invitation issued BEFORE this fix is
// in, and it must still be refused.

describe("guardian invitation accept — never overwrites an existing password", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const auth = new AuthService();
  const portalAuth = new PortalAuthService({ send: async () => undefined } as never);
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const phone = () => `+234${Math.floor(700_0000000 + Math.random() * 99_9999999)}`.slice(0, 14);

  async function hash(plain: string): Promise<string> {
    const password = await import("../../common/auth/password");
    return password.hashPassword(plain);
  }

  async function school(suffix: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Accept Guard ${suffix}`,
        schoolSlug: `accept-guard-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `accept-guard-${suffix}-${runId}@example.test`,
        ownerPhone: phone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function guardian(schoolId: string, passwordHash: string | null) {
    return withTenant(schoolId, async (db) =>
      (
        await db.guardian.create({
          data: {
            schoolId,
            firstName: "Adaora",
            lastName: "Parent",
            relationship: "MOTHER",
            phone: phone(),
            email: `parent-${Math.random().toString(36).slice(2, 8)}@example.test`,
            passwordHash,
            emailVerified: passwordHash !== null,
          },
          select: { id: true },
        })
      ).id,
    );
  }

  /** An invitation row written directly — the state a pre-fix invite is in. */
  async function rawInvitation(schoolId: string, guardianId: string, invitedBy: string) {
    const token = randomBytes(32).toString("base64url");
    await withTenant(schoolId, (db) =>
      db.guardianInvitation.create({
        data: {
          schoolId,
          guardianId,
          invitedBy,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      }),
    );
    return token;
  }

  const acceptInput = (password: string) =>
    ({ password, confirmPassword: password, ndprConsent: true }) as never;

  it("refuses to accept for a guardian who already has a password — the password is unchanged", async () => {
    const { schoolId, ownerId } = await school("active");
    const originalHash = await hash("Parents-Own-Password-1");
    const guardianId = await guardian(schoolId, originalHash);
    const token = await rawInvitation(schoolId, guardianId, ownerId);

    await expect(portalAuth.acceptInvitation(token, acceptInput("Attacker-Chosen-9!"), reqCtx)).rejects.toMatchObject({
      code: "GUARDIAN_ALREADY_ACTIVE",
    });

    const after = await withTenant(schoolId, (db) =>
      db.guardian.findUniqueOrThrow({ where: { id: guardianId }, select: { passwordHash: true } }),
    );
    expect(after.passwordHash).toBe(originalHash);
  });

  it("the refused accept issues no session, and does not burn the invitation", async () => {
    const { schoolId, ownerId } = await school("nosession");
    const guardianId = await guardian(schoolId, await hash("Parents-Own-Password-1"));
    const token = await rawInvitation(schoolId, guardianId, ownerId);

    await expect(portalAuth.acceptInvitation(token, acceptInput("Attacker-Chosen-9!"), reqCtx)).rejects.toBeInstanceOf(
      ConflictError,
    );

    const state = await withTenant(schoolId, async (db) => ({
      sessions: await db.guardianSession.count({ where: { guardianId } }),
      acceptedAt: (
        await db.guardianInvitation.findFirstOrThrow({ where: { guardianId }, select: { acceptedAt: true } })
      ).acceptedAt,
      acceptAudit: await db.auditLog.count({ where: { entityType: "guardian-invitation", schoolId } }),
    }));
    expect(state.sessions).toBe(0);
    expect(state.acceptedAt).toBeNull(); // the claim rolled back with the refusal
    expect(state.acceptAudit).toBe(0); // and nothing claims it was accepted
  });

  it("control: a guardian WITHOUT a password still accepts normally and gets a session", async () => {
    const { schoolId, ownerId } = await school("control");
    const guardianId = await guardian(schoolId, null);
    const token = await rawInvitation(schoolId, guardianId, ownerId);

    const res = await portalAuth.acceptInvitation(token, acceptInput("First-Password-9!"), reqCtx);

    expect(res.token).toBeTruthy();
    const state = await withTenant(schoolId, async (db) => ({
      hasPassword:
        (await db.guardian.findUniqueOrThrow({ where: { id: guardianId }, select: { passwordHash: true } }))
          .passwordHash !== null,
      sessions: await db.guardianSession.count({ where: { guardianId } }),
    }));
    expect(state).toEqual({ hasPassword: true, sessions: 1 });
  });

  it("a second accept of the SAME link, after a first successful one, cannot re-set the password", async () => {
    const { schoolId, ownerId } = await school("twice");
    const guardianId = await guardian(schoolId, null);
    const token = await rawInvitation(schoolId, guardianId, ownerId);
    await portalAuth.acceptInvitation(token, acceptInput("First-Password-9!"), reqCtx);
    const afterFirst = await withTenant(schoolId, (db) =>
      db.guardian.findUniqueOrThrow({ where: { id: guardianId }, select: { passwordHash: true } }),
    );

    await expect(portalAuth.acceptInvitation(token, acceptInput("Second-Password-9!"), reqCtx)).rejects.toBeTruthy();

    const afterSecond = await withTenant(schoolId, (db) =>
      db.guardian.findUniqueOrThrow({ where: { id: guardianId }, select: { passwordHash: true } }),
    );
    expect(afterSecond.passwordHash).toBe(afterFirst.passwordHash);
  });

  it("GuardiansService.invite refuses to issue a link for an active guardian", async () => {
    const { schoolId, ownerId } = await school("noissue");
    const guardianId = await guardian(schoolId, await hash("Parents-Own-Password-1"));
    const guardians = new GuardiansService(
      { send: async () => undefined } as never,
      { sendSms: async () => undefined } as never,
      { getEnabledChannels: async () => ({ email: true, sms: false, push: false }) } as never,
    );
    const authCtx = { sessionId: "spec", userId: ownerId, schoolId };

    await expect(guardians.invite(authCtx, guardianId, reqCtx)).rejects.toMatchObject({
      code: "GUARDIAN_ALREADY_ACTIVE",
    });
    const issued = await withTenant(schoolId, (db) => db.guardianInvitation.count({ where: { guardianId } }));
    expect(issued).toBe(0);
  });
});
