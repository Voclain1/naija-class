import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StudentsService } from "./students.service";

// Integration spec — real DB, real RLS, real audit. Mirrors the shape of
// subjects.service.spec.ts. Student is the first slice carrying durable
// child PII; the test surface is deliberately wide because every later
// slice (CSV import, enrollment, AI) leans on these invariants.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("StudentsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new StudentsService();
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
        schoolName: `Students Spec ${suffix}`,
        schoolSlug: `stu-${suffix}-${runId}`,
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

  const requiredFields = (suffix: string) => ({
    admissionNumber: `ADM/${runId}/${suffix}`,
    firstName: "Ada",
    lastName: "Okafor",
    dateOfBirth: new Date("2014-03-15"),
    gender: "FEMALE" as const,
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe("create", () => {
    it("creates a student with required fields and writes audit", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");

      const created = await service.create(
        authCtx,
        requiredFields("001"),
        reqCtx,
      );

      expect(created.id).toBeTruthy();
      expect(created.firstName).toBe("Ada");
      expect(created.lastName).toBe("Okafor");
      expect(created.status).toBe("ACTIVE");
      expect(created.nationality).toBe("Nigerian");
      expect(created.withdrawnAt).toBeNull();
      expect(created.graduatedAt).toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "student.create", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();
      // Audit metadata must NOT contain identifying PII — only admissionNumber + gender.
      const metadata = audit?.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({
        admissionNumber: created.admissionNumber,
        gender: "FEMALE",
      });
      expect(metadata.firstName).toBeUndefined();
      expect(metadata.lastName).toBeUndefined();
      expect(metadata.dateOfBirth).toBeUndefined();
      expect(metadata.medicalNotes).toBeUndefined();
    });

    it("creates with optional fields populated", async () => {
      const { authCtx } = await createActiveSchool("create-full");
      const created = await service.create(
        authCtx,
        {
          ...requiredFields("002"),
          middleName: "Chioma",
          phone: "+2348012345678",
          email: "ada@example.test",
          address: "12 Allen Avenue, Ikeja",
          bloodGroup: "O+",
          medicalNotes: "Asthma — inhaler in school bag",
          religion: "Christian",
          stateOfOrigin: "Anambra",
          notes: "Strong in mathematics",
        },
        reqCtx,
      );
      expect(created.middleName).toBe("Chioma");
      expect(created.bloodGroup).toBe("O+");
      expect(created.medicalNotes).toBe("Asthma — inhaler in school bag");
    });

    it("duplicate admissionNumber per school → ConflictError ADMISSION_NUMBER_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("dup-adm");
      await service.create(authCtx, requiredFields("X"), reqCtx);
      await expect(
        service.create(authCtx, requiredFields("X"), reqCtx),
      ).rejects.toMatchObject({ code: "ADMISSION_NUMBER_TAKEN" });
    });

    it("same admissionNumber allowed across different schools", async () => {
      const a = await createActiveSchool("samenum-a");
      const b = await createActiveSchool("samenum-b");
      await service.create(a.authCtx, requiredFields("X"), reqCtx);
      await expect(
        service.create(b.authCtx, requiredFields("X"), reqCtx),
      ).resolves.toBeTruthy();
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(
        schoolId,
        "forbidden",
      );
      await expect(
        service.create(noRoleCtx, requiredFields("X"), reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------
  // findById
  // -----------------------------------------------------------------------

  describe("findById", () => {
    it("returns student with empty guardians array when no links exist", async () => {
      // Slice 5 populates guardians from real StudentGuardian rows; a
      // freshly-created student has none, so the array is still empty.
      const { authCtx } = await createActiveSchool("fid");
      const created = await service.create(authCtx, requiredFields("F1"), reqCtx);
      const fetched = await service.findById(authCtx, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.guardians).toEqual([]);
    });

    it("unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("fid-nf");
      await expect(
        service.findById(authCtx, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // list — cursor + search + status filter
  // -----------------------------------------------------------------------

  describe("list", () => {
    it("returns all active students with empty meta when under limit", async () => {
      const { authCtx } = await createActiveSchool("list-small");
      const a = await service.create(authCtx, requiredFields("L1"), reqCtx);
      const b = await service.create(
        authCtx,
        { ...requiredFields("L2"), lastName: "Bello" },
        reqCtx,
      );
      const result = await service.list(authCtx, {});
      expect(result.data.map((s) => s.id).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      expect(result.meta.cursor).toBeUndefined();
    });

    it("paginates by id ASC; meta.cursor advances on the next page", async () => {
      const { authCtx } = await createActiveSchool("list-page");
      const created: { id: string }[] = [];
      for (let i = 0; i < 5; i++) {
        created.push(
          await service.create(
            authCtx,
            { ...requiredFields(`P${i}`), lastName: `Pager-${i}` },
            reqCtx,
          ),
        );
      }
      const sortedIds = created.map((c) => c.id).sort();

      const page1 = await service.list(authCtx, { limit: 2 });
      expect(page1.data).toHaveLength(2);
      expect(page1.data.map((s) => s.id)).toEqual(sortedIds.slice(0, 2));
      expect(page1.meta.cursor).toBe(sortedIds[1]);

      const page2 = await service.list(authCtx, {
        limit: 2,
        cursor: page1.meta.cursor,
      });
      expect(page2.data.map((s) => s.id)).toEqual(sortedIds.slice(2, 4));
      expect(page2.meta.cursor).toBe(sortedIds[3]);

      const page3 = await service.list(authCtx, {
        limit: 2,
        cursor: page2.meta.cursor,
      });
      expect(page3.data.map((s) => s.id)).toEqual([sortedIds[4]]);
      expect(page3.meta.cursor).toBeUndefined();
    });

    it("filters by status", async () => {
      const { authCtx } = await createActiveSchool("list-status");
      const active = await service.create(
        authCtx,
        requiredFields("S1"),
        reqCtx,
      );
      const toWithdraw = await service.create(
        authCtx,
        { ...requiredFields("S2"), lastName: "Wynd" },
        reqCtx,
      );
      await service.withdraw(authCtx, toWithdraw.id, {}, reqCtx);

      const activeOnly = await service.list(authCtx, { status: "ACTIVE" });
      expect(activeOnly.data.map((s) => s.id)).toContain(active.id);
      expect(activeOnly.data.map((s) => s.id)).not.toContain(toWithdraw.id);

      const withdrawnOnly = await service.list(authCtx, {
        status: "WITHDRAWN",
      });
      expect(withdrawnOnly.data.map((s) => s.id)).toContain(toWithdraw.id);
      expect(withdrawnOnly.data.map((s) => s.id)).not.toContain(active.id);
    });

    it("search matches admissionNumber, lastName, or firstName (OR'd, case-insensitive)", async () => {
      const { authCtx } = await createActiveSchool("list-search");
      const adaOk = await service.create(
        authCtx,
        { ...requiredFields("Q1") },
        reqCtx,
      );
      const ifeBel = await service.create(
        authCtx,
        {
          admissionNumber: `BEL/${runId}/Q2`,
          firstName: "Ifeoma",
          lastName: "Bello",
          dateOfBirth: new Date("2013-05-01"),
          gender: "FEMALE",
        },
        reqCtx,
      );

      const byFirst = await service.list(authCtx, { search: "ada" });
      expect(byFirst.data.map((s) => s.id)).toContain(adaOk.id);
      expect(byFirst.data.map((s) => s.id)).not.toContain(ifeBel.id);

      const byLast = await service.list(authCtx, { search: "BELLO" });
      expect(byLast.data.map((s) => s.id)).toContain(ifeBel.id);

      const byAdm = await service.list(authCtx, { search: "BEL/" });
      expect(byAdm.data.map((s) => s.id)).toContain(ifeBel.id);
    });

    it("status + search compose (AND)", async () => {
      const { authCtx } = await createActiveSchool("list-and");
      await service.create(
        authCtx,
        { ...requiredFields("C1"), lastName: "Compose" },
        reqCtx,
      );
      const otherActive = await service.create(
        authCtx,
        { ...requiredFields("C2"), lastName: "Compose-Two" },
        reqCtx,
      );
      const wd = await service.create(
        authCtx,
        { ...requiredFields("C3"), lastName: "Compose-Three" },
        reqCtx,
      );
      await service.withdraw(authCtx, wd.id, {}, reqCtx);

      const result = await service.list(authCtx, {
        status: "ACTIVE",
        search: "compose",
      });
      const ids = result.data.map((s) => s.id);
      expect(ids).toContain(otherActive.id);
      expect(ids).not.toContain(wd.id);
    });

    it("silently ignores classArmId and academicYearId until slice 9", async () => {
      const { authCtx } = await createActiveSchool("list-ignore");
      await service.create(authCtx, requiredFields("I1"), reqCtx);
      // Both are accepted (Zod accepts uuids) and dropped at the service.
      const result = await service.list(authCtx, {
        classArmId: "00000000-0000-0000-0000-000000000000",
        academicYearId: "00000000-0000-0000-0000-000000000000",
      });
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe("update", () => {
    it("partial-updates a student and bumps audit (metadata = changed field names only)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upd");
      const s = await service.create(authCtx, requiredFields("U1"), reqCtx);
      const updated = await service.update(
        authCtx,
        s.id,
        { medicalNotes: "Updated note" },
        reqCtx,
      );
      expect(updated.medicalNotes).toBe("Updated note");

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "student.update", entityId: s.id },
          orderBy: { createdAt: "desc" },
        }),
      );
      const metadata = audit?.metadata as Record<string, unknown>;
      expect(metadata.changed).toEqual(["medicalNotes"]);
      // No PII value should appear in audit metadata.
      expect(metadata.medicalNotes).toBeUndefined();
    });

    it("renaming admissionNumber to an existing one → ADMISSION_NUMBER_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("upd-dup");
      const a = await service.create(authCtx, requiredFields("D1"), reqCtx);
      void a;
      const b = await service.create(
        authCtx,
        { ...requiredFields("D2"), lastName: "Two" },
        reqCtx,
      );
      await expect(
        service.update(
          authCtx,
          b.id,
          { admissionNumber: requiredFields("D1").admissionNumber },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "ADMISSION_NUMBER_TAKEN" });
    });

    it("unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("upd-nf");
      await expect(
        service.update(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          { firstName: "X" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // withdraw / graduate / reactivate
  // -----------------------------------------------------------------------

  describe("withdraw", () => {
    it("ACTIVE → WITHDRAWN sets withdrawnAt; audit row lands", async () => {
      const { authCtx, schoolId } = await createActiveSchool("wd");
      const s = await service.create(authCtx, requiredFields("W1"), reqCtx);
      expect(s.withdrawnAt).toBeNull();

      const result = await service.withdraw(
        authCtx,
        s.id,
        { reason: "Family relocated" },
        reqCtx,
      );
      expect(result.status).toBe("WITHDRAWN");
      expect(result.withdrawnAt).not.toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "student.withdraw", entityId: s.id },
        }),
      );
      expect(audit).toBeTruthy();
      const metadata = audit?.metadata as Record<string, unknown>;
      expect(metadata.previousStatus).toBe("ACTIVE");
      expect(metadata.reason).toBe("Family relocated");
    });

    it("uses provided withdrawnAt when set", async () => {
      const { authCtx } = await createActiveSchool("wd-at");
      const s = await service.create(authCtx, requiredFields("W2"), reqCtx);
      const at = new Date("2025-10-15T10:00:00Z");
      const result = await service.withdraw(authCtx, s.id, { withdrawnAt: at }, reqCtx);
      expect(new Date(result.withdrawnAt as string).toISOString()).toBe(
        at.toISOString(),
      );
    });

    it("already WITHDRAWN → ALREADY_WITHDRAWN conflict (no silent no-op)", async () => {
      const { authCtx } = await createActiveSchool("wd-dup");
      const s = await service.create(authCtx, requiredFields("W3"), reqCtx);
      await service.withdraw(authCtx, s.id, {}, reqCtx);
      await expect(
        service.withdraw(authCtx, s.id, {}, reqCtx),
      ).rejects.toMatchObject({ code: "ALREADY_WITHDRAWN" });
    });

    it("withdrawing a GRADUATED student → INVALID_TRANSITION", async () => {
      const { authCtx } = await createActiveSchool("wd-grad");
      const s = await service.create(authCtx, requiredFields("W4"), reqCtx);
      await service.graduate(authCtx, s.id, {}, reqCtx);
      await expect(
        service.withdraw(authCtx, s.id, {}, reqCtx),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    });
  });

  describe("graduate", () => {
    it("ACTIVE → GRADUATED sets graduatedAt", async () => {
      const { authCtx } = await createActiveSchool("grad");
      const s = await service.create(authCtx, requiredFields("G1"), reqCtx);
      const result = await service.graduate(authCtx, s.id, {}, reqCtx);
      expect(result.status).toBe("GRADUATED");
      expect(result.graduatedAt).not.toBeNull();
    });

    it("already GRADUATED → ALREADY_GRADUATED", async () => {
      const { authCtx } = await createActiveSchool("grad-dup");
      const s = await service.create(authCtx, requiredFields("G2"), reqCtx);
      await service.graduate(authCtx, s.id, {}, reqCtx);
      await expect(
        service.graduate(authCtx, s.id, {}, reqCtx),
      ).rejects.toMatchObject({ code: "ALREADY_GRADUATED" });
    });
  });

  describe("reactivate", () => {
    it("WITHDRAWN → ACTIVE clears withdrawnAt", async () => {
      const { authCtx } = await createActiveSchool("react-wd");
      const s = await service.create(authCtx, requiredFields("R1"), reqCtx);
      await service.withdraw(authCtx, s.id, {}, reqCtx);
      const result = await service.reactivate(authCtx, s.id, undefined, reqCtx);
      expect(result.status).toBe("ACTIVE");
      expect(result.withdrawnAt).toBeNull();
      expect(result.graduatedAt).toBeNull();
    });

    it("GRADUATED → ACTIVE clears graduatedAt", async () => {
      const { authCtx } = await createActiveSchool("react-grad");
      const s = await service.create(authCtx, requiredFields("R2"), reqCtx);
      await service.graduate(authCtx, s.id, {}, reqCtx);
      const result = await service.reactivate(authCtx, s.id, undefined, reqCtx);
      expect(result.status).toBe("ACTIVE");
      expect(result.graduatedAt).toBeNull();
    });

    it("already ACTIVE → ALREADY_ACTIVE conflict", async () => {
      const { authCtx } = await createActiveSchool("react-active");
      const s = await service.create(authCtx, requiredFields("R3"), reqCtx);
      await expect(
        service.reactivate(authCtx, s.id, undefined, reqCtx),
      ).rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
    });
  });
});

// Reference imports to satisfy unused-import linting when only used as matchers.
void ConflictError;
