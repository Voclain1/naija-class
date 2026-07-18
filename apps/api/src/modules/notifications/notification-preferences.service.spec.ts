import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { NotificationPreferencesService } from "./notification-preferences.service";

// Integration spec — real DB, real RLS, real audit. Phase 4 / Slice 6.
// No row is seeded at school signup (unlike GradingScheme) — get() returns
// schema defaults for an unconfigured school; the row is created only on
// first update() (upsert). See notification-preferences.service.ts's own
// header comment.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23489${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("NotificationPreferencesService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new NotificationPreferencesService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function createActiveSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Notif Prefs Spec ${suffix}`,
        schoolSlug: `notif-prefs-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIdsToCleanup.add(signed.school.id);
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

  async function createUserWithoutRole(schoolId: string, suffix: string) {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: "No",
          lastName: "Role",
          email: `norole-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      return { authCtx: { sessionId: "sess-placeholder", userId: u.id, schoolId } };
    });
  }

  describe("get", () => {
    it("returns schema defaults (email on, SMS/push off) for an unconfigured school — no row created", async () => {
      const { authCtx, schoolId } = await createActiveSchool("get-default");

      const prefs = await service.get(authCtx);
      expect(prefs).toEqual({
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        updatedBy: null,
        updatedAt: null,
      });

      const row = await withTenant(schoolId, (db) =>
        db.notificationPreference.findUnique({ where: { schoolId } }),
      );
      expect(row).toBeNull();
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("get-forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "get-forbidden");
      await expect(service.get(noRoleCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("update", () => {
    it("creates the row on first update (upsert) and writes audit", async () => {
      const { authCtx, schoolId, userId } = await createActiveSchool("update-create");

      const result = await service.update(
        authCtx,
        { emailEnabled: false, smsEnabled: true },
        reqCtx,
      );

      expect(result.emailEnabled).toBe(false);
      expect(result.smsEnabled).toBe(true);
      expect(result.pushEnabled).toBe(false);
      expect(result.updatedBy).toBe(userId);
      expect(result.updatedAt).not.toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "notification-preferences.update" },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(audit).not.toBeNull();
      expect(audit?.metadata).toMatchObject({ emailEnabled: false, smsEnabled: true });
    });

    it("updates the existing row (not a second insert) on a subsequent call", async () => {
      const { authCtx, schoolId } = await createActiveSchool("update-twice");

      await service.update(authCtx, { emailEnabled: true, smsEnabled: false }, reqCtx);
      await service.update(authCtx, { emailEnabled: false, smsEnabled: true }, reqCtx);

      const rows = await withTenant(schoolId, (db) =>
        db.notificationPreference.findMany({ where: { schoolId } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].emailEnabled).toBe(false);
      expect(rows[0].smsEnabled).toBe(true);
    });

    it("get() reflects a prior update()", async () => {
      const { authCtx } = await createActiveSchool("update-then-get");
      await service.update(authCtx, { emailEnabled: false, smsEnabled: true }, reqCtx);

      const prefs = await service.get(authCtx);
      expect(prefs.emailEnabled).toBe(false);
      expect(prefs.smsEnabled).toBe(true);
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("update-forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "update-forbidden");
      await expect(
        service.update(noRoleCtx, { emailEnabled: true, smsEnabled: false }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ---------------------------------------------------------------------
  // getEnabledChannels — the enforcement helper other services call before
  // sending. Direct coverage of the phase's acceptance criterion #6: "a
  // school with SMS disabled sends no Termii messages regardless of event
  // type." (docs/modules/phase-4.md §6)
  // ---------------------------------------------------------------------

  describe("getEnabledChannels", () => {
    it("returns schema defaults for an unconfigured school", async () => {
      const { schoolId } = await createActiveSchool("channels-default");
      await expect(service.getEnabledChannels(schoolId)).resolves.toEqual({
        email: true,
        sms: false,
      });
    });

    it("reflects a school that has disabled email and enabled SMS", async () => {
      const { authCtx, schoolId } = await createActiveSchool("channels-custom");
      await service.update(authCtx, { emailEnabled: false, smsEnabled: true }, reqCtx);

      await expect(service.getEnabledChannels(schoolId)).resolves.toEqual({
        email: false,
        sms: true,
      });
    });

    it("reflects a school with both channels disabled", async () => {
      const { authCtx, schoolId } = await createActiveSchool("channels-both-off");
      await service.update(authCtx, { emailEnabled: false, smsEnabled: false }, reqCtx);

      await expect(service.getEnabledChannels(schoolId)).resolves.toEqual({
        email: false,
        sms: false,
      });
    });
  });
});
