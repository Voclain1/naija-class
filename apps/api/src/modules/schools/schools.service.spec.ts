import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, UnauthorizedError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { SchoolsService, type OnboardingStepPayload } from "./schools.service";

// Integration spec — talks to the real dev Postgres. Same rationale as
// auth.service.spec.ts: the bug classes we care about here (RLS,
// transaction atomicity, role-grant lookup under FORCE RLS) only manifest
// against real Postgres.
//
// Each `describe` block creates its OWN school via the real signupOwner
// path, so tests are independent and we exercise the realistic state
// transition (signup → wizard) rather than a synthetic fixture.

// Each call returns a phone number guaranteed not to have been used inside
// this process before. Format matches the signup PHONE_RE: optional +, then
// 10–15 digits. We prefix +234 + a fixed 5-digit tag so the suite's phones
// are visually distinct from any organic data, then 8 random digits.
let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("SchoolsService (Slice 6)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  const authService = new AuthService();
  const schoolsService = new SchoolsService();

  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // Helper: create a fresh school + owner via the real signup flow. Returns
  // the AuthContext shape the controller would have attached to req.user.
  // Each call gets a unique random phone so the global phone-unique
  // constraint on `users` doesn't collide across tests.
  async function createOwnedSchool(suffix: string) {
    const uniquePhone = randomPhone();
    const signed = await authService.signupOwner(
      {
        schoolName: `Slice 6 Academy ${suffix}`,
        schoolSlug: `s6-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `owner-${suffix}-${runId}@example.test`,
        ownerPhone: uniquePhone,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      ctx,
    );
    schoolIdsToCleanup.add(signed.school.id);
    return {
      schoolId: signed.school.id,
      userId: signed.user.id,
      authCtx: { sessionId: "sess-placeholder", userId: signed.user.id, schoolId: signed.school.id },
    };
  }

  // Helper: create an admin user inside an existing school. Uses raw
  // withTenant inserts because there is no public "create user" path yet
  // (Slice 7). Returns the admin's AuthContext shape.
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
          passwordHash: "argon2id$placeholder", // login path not exercised here
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

  // Helper: build a typed onboarding payload. Saves a lot of `as` casts in
  // the test bodies and mirrors what the controller's parseStepPayload does.
  function payload<S extends OnboardingStepPayload["step"]>(
    step: S,
    data: Extract<OnboardingStepPayload, { step: S }>["data"],
  ): OnboardingStepPayload {
    return { step, data } as OnboardingStepPayload;
  }

  // -----------------------------------------------------------------------
  // findMe + patchMe
  // -----------------------------------------------------------------------

  describe("findMe / patchMe", () => {
    it("findMe — returns the authed user's school with the wider SchoolMeDto fields", async () => {
      const { authCtx, schoolId } = await createOwnedSchool("find");

      const school = await schoolsService.findMe(authCtx);

      expect(school.id).toBe(schoolId);
      expect(school.status).toBe("ONBOARDING");
      expect(school.onboardingStep).toBe(0);
      // Wider DTO surface
      expect(school).toHaveProperty("motto");
      expect(school).toHaveProperty("logoUrl");
      expect(school).toHaveProperty("address");
      expect(school).toHaveProperty("primaryColor");
      expect(school).toHaveProperty("ndprConsentAt");
    });

    it("patchMe as owner — updates fields and writes an audit row, does NOT bump onboardingStep", async () => {
      const { authCtx, schoolId } = await createOwnedSchool("patch-owner");

      const updated = await schoolsService.patchMe(
        authCtx,
        { name: "Renamed Academy", motto: "Learn well." },
        ctx,
      );

      expect(updated.name).toBe("Renamed Academy");
      expect(updated.motto).toBe("Learn well.");
      expect(updated.onboardingStep).toBe(0); // unchanged

      await withTenant(schoolId, async (db) => {
        const audit = await db.auditLog.findFirst({
          where: { schoolId, action: "school.update" },
        });
        expect(audit).toBeTruthy();
        const meta = audit!.metadata as Record<string, unknown>;
        expect(meta.changed).toEqual(expect.arrayContaining(["name", "motto"]));
      });
    });

    it("patchMe as admin — succeeds (owner+admin policy)", async () => {
      const { schoolId } = await createOwnedSchool("patch-admin");
      const { authCtx: adminCtx } = await createAdminUser(schoolId, "patch-admin");

      const updated = await schoolsService.patchMe(
        adminCtx,
        { primaryColor: "#1A2B3C" },
        ctx,
      );

      expect(updated.primaryColor).toBe("#1A2B3C");
    });

    it("patchMe — rejects a user with no owner/admin grant with ForbiddenError", async () => {
      const { schoolId } = await createOwnedSchool("patch-nope");
      // A user with NO role grants at all.
      const { authCtx: noRoleCtx } = await withTenant(schoolId, async (db) => {
        const u = await db.user.create({
          data: {
            schoolId,
            firstName: "No",
            lastName: "Role",
            email: `norole-${runId}-pn@example.test`,
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
        schoolsService.patchMe(noRoleCtx, { name: "Nope" }, ctx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("patchMe — deactivated user is rejected with USER_INACTIVE even if owner-granted", async () => {
      const { authCtx, schoolId, userId } = await createOwnedSchool("patch-deactivated");
      await withTenant(schoolId, async (db) => {
        await db.user.update({ where: { id: userId }, data: { isActive: false } });
      });

      await expect(
        schoolsService.patchMe(authCtx, { name: "X" }, ctx),
      ).rejects.toMatchObject({ code: "USER_INACTIVE" });
      await expect(
        schoolsService.patchMe(authCtx, { name: "X" }, ctx),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  // -----------------------------------------------------------------------
  // advanceOnboarding — happy path
  // -----------------------------------------------------------------------

  describe("advanceOnboarding — happy path through all 5 steps", () => {
    it("walks 1→2→3→4→5, persists each step, and flips status to ACTIVE on completion", async () => {
      const { authCtx, schoolId } = await createOwnedSchool("walk");

      const step1 = await schoolsService.advanceOnboarding(
        authCtx,
        payload(1, {
          name: "Walked Academy",
          motto: "Step by step.",
          address: "12 Test Road, Lagos",
          phone: "+2348012345678",
          email: `school-walk-${runId}@example.test`,
        }),
        ctx,
      );
      expect(step1.school.onboardingStep).toBe(1);
      expect(step1.school.name).toBe("Walked Academy");
      expect(step1.school.motto).toBe("Step by step.");

      const step2 = await schoolsService.advanceOnboarding(
        authCtx,
        payload(2, {
          logoUrl: "https://example.test/logo.png",
          primaryColor: "#0099FF",
        }),
        ctx,
      );
      expect(step2.school.onboardingStep).toBe(2);
      expect(step2.school.logoUrl).toBe("https://example.test/logo.png");
      expect(step2.school.primaryColor).toBe("#0099FF");

      const step3 = await schoolsService.advanceOnboarding(
        authCtx,
        payload(3, {
          invites: [
            { email: `invitee1-${runId}@example.test`, firstName: "Inv", lastName: "One" },
            { email: `invitee2-${runId}@example.test` },
          ],
        }),
        ctx,
      );
      expect(step3.school.onboardingStep).toBe(3);

      // Two Invitation rows exist for this school.
      const invitations = await withTenant(schoolId, (db) =>
        db.invitation.findMany({ where: { schoolId }, select: { email: true, roleKey: true } }),
      );
      expect(invitations).toHaveLength(2);
      expect(invitations.every((i) => i.roleKey === "admin")).toBe(true);

      const step4 = await schoolsService.advanceOnboarding(
        authCtx,
        payload(4, { ndprConsent: true }),
        ctx,
      );
      expect(step4.school.onboardingStep).toBe(4);
      expect(step4.school.ndprConsent).toBe(true);
      expect(step4.school.ndprConsentAt).toBeInstanceOf(Date);

      const step5 = await schoolsService.advanceOnboarding(authCtx, payload(5, {}), ctx);
      expect(step5.school.onboardingStep).toBe(5);
      expect(step5.school.status).toBe("ACTIVE");

      // Audit chain: one row per step.
      const auditActions = await withTenant(schoolId, (db) =>
        db.auditLog.findMany({
          where: { schoolId },
          orderBy: { createdAt: "asc" },
          select: { action: true },
        }),
      );
      const onboardingActions = auditActions.map((a) => a.action).filter((a) => a.startsWith("onboarding."));
      expect(onboardingActions).toEqual([
        "onboarding.step1_complete",
        "onboarding.step2_complete",
        "onboarding.step3_complete",
        "onboarding.step4_complete",
        "onboarding.complete",
      ]);
    });

    it("step 2 accepts an empty payload {} as a valid advance (branding is optional)", async () => {
      const { authCtx } = await createOwnedSchool("step2-empty");

      await schoolsService.advanceOnboarding(
        authCtx,
        payload(1, {
          name: "Empty Step 2 Academy",
          phone: "+2348012345679",
          email: `step2-empty-${runId}@example.test`,
        }),
        ctx,
      );

      const step2 = await schoolsService.advanceOnboarding(authCtx, payload(2, {}), ctx);

      expect(step2.school.onboardingStep).toBe(2);
      expect(step2.school.logoUrl).toBeNull();
      expect(step2.school.primaryColor).toBeNull();
    });

    it("step 3 accepts an empty invites array (skip)", async () => {
      const { authCtx, schoolId } = await createOwnedSchool("step3-skip");

      await schoolsService.advanceOnboarding(
        authCtx,
        payload(1, {
          name: "Skip Invites Academy",
          phone: "+2348012345680",
          email: `skip-${runId}@example.test`,
        }),
        ctx,
      );
      await schoolsService.advanceOnboarding(authCtx, payload(2, {}), ctx);

      const step3 = await schoolsService.advanceOnboarding(authCtx, payload(3, { invites: [] }), ctx);

      expect(step3.school.onboardingStep).toBe(3);
      const invitations = await withTenant(schoolId, (db) =>
        db.invitation.findMany({ where: { schoolId } }),
      );
      expect(invitations).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // advanceOnboarding — gate violations
  // -----------------------------------------------------------------------

  describe("advanceOnboarding — gate enforcement", () => {
    it("rejects skip-ahead with INVALID_ONBOARDING_STEP (POST step 3 when on step 1)", async () => {
      const { authCtx } = await createOwnedSchool("skip-ahead");
      // Complete step 1 only.
      await schoolsService.advanceOnboarding(
        authCtx,
        payload(1, {
          name: "Skip Ahead",
          phone: "+2348012345681",
          email: `skip-${runId}-sa@example.test`,
        }),
        ctx,
      );

      // Try step 3 — onboardingStep is 1, gate wants 2.
      await expect(
        schoolsService.advanceOnboarding(
          authCtx,
          payload(3, { invites: [] }),
          ctx,
        ),
      ).rejects.toMatchObject({ code: "INVALID_ONBOARDING_STEP" });
    });

    it("rejects POST step 5 when status is already ACTIVE (ONBOARDING_ALREADY_COMPLETE)", async () => {
      const { authCtx } = await createOwnedSchool("already-done");
      // Walk the whole wizard.
      await schoolsService.advanceOnboarding(
        authCtx,
        payload(1, {
          name: "Done",
          phone: "+2348012345682",
          email: `done-${runId}@example.test`,
        }),
        ctx,
      );
      await schoolsService.advanceOnboarding(authCtx, payload(2, {}), ctx);
      await schoolsService.advanceOnboarding(authCtx, payload(3, { invites: [] }), ctx);
      await schoolsService.advanceOnboarding(authCtx, payload(4, { ndprConsent: true }), ctx);
      await schoolsService.advanceOnboarding(authCtx, payload(5, {}), ctx);

      // Now status is ACTIVE; POST anything → ONBOARDING_ALREADY_COMPLETE.
      await expect(
        schoolsService.advanceOnboarding(authCtx, payload(1, {
          name: "Re-do",
          phone: "+2348012345683",
          email: `redo-${runId}@example.test`,
        }), ctx),
      ).rejects.toMatchObject({ code: "ONBOARDING_ALREADY_COMPLETE" });
    });

    it("PATCH /schools/me as owner during onboarding — allowed, does not move the step counter", async () => {
      const { authCtx, schoolId } = await createOwnedSchool("patch-during");

      // Advance to step 3.
      await schoolsService.advanceOnboarding(
        authCtx,
        payload(1, {
          name: "Original",
          phone: "+2348012345684",
          email: `od-${runId}@example.test`,
        }),
        ctx,
      );
      await schoolsService.advanceOnboarding(authCtx, payload(2, {}), ctx);
      await schoolsService.advanceOnboarding(authCtx, payload(3, { invites: [] }), ctx);

      const beforeStep = (await schoolsService.findMe(authCtx)).onboardingStep;
      expect(beforeStep).toBe(3);

      await schoolsService.patchMe(authCtx, { name: "Edited Back On Step 1" }, ctx);

      const after = await schoolsService.findMe(authCtx);
      expect(after.name).toBe("Edited Back On Step 1");
      expect(after.onboardingStep).toBe(3); // unchanged
      // Sanity: still ONBOARDING (status stays put too).
      expect(after.status).toBe("ONBOARDING");
      void schoolId;
    });
  });

  // -----------------------------------------------------------------------
  // advanceOnboarding — authorisation
  // -----------------------------------------------------------------------

  describe("advanceOnboarding — owner-only", () => {
    it("rejects an admin (non-owner) with ForbiddenError", async () => {
      const { schoolId } = await createOwnedSchool("admin-cant");
      const { authCtx: adminCtx } = await createAdminUser(schoolId, "admin-cant");

      await expect(
        schoolsService.advanceOnboarding(
          adminCtx,
          payload(1, {
            name: "Admin Tried",
            phone: "+2348012345685",
            email: `at-${runId}@example.test`,
          }),
          ctx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
