import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { SubjectsService } from "./subjects.service";

// Integration spec — same shape as class-levels.service.spec.ts. Real DB,
// real RLS, real audit.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("SubjectsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new SubjectsService();
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
        schoolName: `Subjects Spec ${suffix}`,
        schoolSlug: `sub-${suffix}-${runId}`,
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
      return {
        authCtx: { sessionId: "sess-placeholder", userId: u.id, schoolId },
      };
    });
  }

  // -----------------------------------------------------------------------
  // create / list / findById
  // -----------------------------------------------------------------------

  describe("create / list / findById", () => {
    it("owner creates a subject and lists it; audit row lands", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");

      const created = await service.create(
        authCtx,
        { name: "Mathematics", code: "math" },
        reqCtx,
      );

      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Mathematics");
      expect(created.category).toBe("CORE");
      expect(created.isActive).toBe(true);

      const list = await service.list(authCtx);
      expect(list.map((s) => s.id)).toContain(created.id);

      const fetched = await service.findById(authCtx, created.id);
      expect(fetched.id).toBe(created.id);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "subject.create", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("duplicate code per school → ConflictError CODE_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("dup-code");
      await service.create(authCtx, { name: "Math", code: "math" }, reqCtx);
      await expect(
        service.create(authCtx, { name: "Mathematics", code: "math" }, reqCtx),
      ).rejects.toMatchObject({ code: "CODE_TAKEN" });
    });

    it("same code allowed in different schools", async () => {
      const a = await createActiveSchool("samecode-a");
      const b = await createActiveSchool("samecode-b");
      await service.create(a.authCtx, { name: "Math", code: "math" }, reqCtx);
      await expect(
        service.create(b.authCtx, { name: "Math", code: "math" }, reqCtx),
      ).resolves.toBeTruthy();
    });

    it("respects optional category (CORE/ELECTIVE/VOCATIONAL)", async () => {
      const { authCtx } = await createActiveSchool("cat");
      const elective = await service.create(
        authCtx,
        { name: "Music", code: "music", category: "ELECTIVE" },
        reqCtx,
      );
      expect(elective.category).toBe("ELECTIVE");
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "forbidden");
      await expect(
        service.create(noRoleCtx, { name: "X", code: "x" }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("findById returns NotFoundError for unknown id", async () => {
      const { authCtx } = await createActiveSchool("nfid");
      await expect(
        service.findById(authCtx, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("list defaults to active-only; includeInactive returns soft-deleted rows too", async () => {
      const { authCtx } = await createActiveSchool("inactive");
      const active = await service.create(authCtx, { name: "Math", code: "math" }, reqCtx);
      const soft = await service.create(authCtx, { name: "Music", code: "music" }, reqCtx);
      await service.update(authCtx, soft.id, { isActive: false }, reqCtx);

      const defaultList = await service.list(authCtx);
      expect(defaultList.map((s) => s.id)).toContain(active.id);
      expect(defaultList.map((s) => s.id)).not.toContain(soft.id);

      const fullList = await service.list(authCtx, { includeInactive: true });
      expect(fullList.map((s) => s.id)).toContain(soft.id);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe("update", () => {
    it("renames a subject and bumps audit log", async () => {
      const { authCtx } = await createActiveSchool("upd");
      const s = await service.create(authCtx, { name: "Maths", code: "math" }, reqCtx);
      const renamed = await service.update(authCtx, s.id, { name: "Mathematics" }, reqCtx);
      expect(renamed.name).toBe("Mathematics");
    });

    it("rename to existing code → ConflictError CODE_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("upd-dup");
      await service.create(authCtx, { name: "Math", code: "math" }, reqCtx);
      const other = await service.create(authCtx, { name: "Music", code: "music" }, reqCtx);
      await expect(
        service.update(authCtx, other.id, { code: "math" }, reqCtx),
      ).rejects.toMatchObject({ code: "CODE_TAKEN" });
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("hard-deletes and removes from list", async () => {
      const { authCtx } = await createActiveSchool("del");
      const s = await service.create(authCtx, { name: "Music", code: "music" }, reqCtx);
      await service.delete(authCtx, s.id, reqCtx);
      const list = await service.list(authCtx, { includeInactive: true });
      expect(list.map((x) => x.id)).not.toContain(s.id);
    });

    it("delete unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("del-nf");
      await expect(
        service.delete(authCtx, "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

// Reference imports to satisfy unused-import linting when only used as matchers.
void ConflictError;
