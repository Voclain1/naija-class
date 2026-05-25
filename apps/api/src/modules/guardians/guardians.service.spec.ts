import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StudentsService } from "../students/students.service";
import { GuardiansService } from "./guardians.service";

// Integration spec — real DB, real RLS, real audit. Mirrors students.service
// .spec.ts shape. Slice 5 adds two tables, two units of post-RLS error
// handling (the StudentGuardian (student_id, guardian_id) unique → P2002 →
// GUARDIAN_ALREADY_LINKED), one new transactional invariant (auto-demote
// of sibling primary links), and one PII-redaction extension
// (occupation|employer) — all four are pinned by tests below.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("GuardiansService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const studentsService = new StudentsService();
  const service = new GuardiansService();
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
        schoolName: `Guardians Spec ${suffix}`,
        schoolSlug: `gua-${suffix}-${runId}`,
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

  async function createStudent(
    authCtx: { sessionId: string; userId: string; schoolId: string },
    suffix: string,
    extras?: Partial<{ firstName: string; lastName: string }>,
  ) {
    return studentsService.create(
      authCtx,
      {
        admissionNumber: `ADM/${runId}/${suffix}`,
        firstName: extras?.firstName ?? "Ada",
        lastName: extras?.lastName ?? "Okafor",
        dateOfBirth: new Date("2014-03-15"),
        gender: "FEMALE",
      },
      reqCtx,
    );
  }

  const guardianFields = (suffix: string) => ({
    firstName: "Bola",
    lastName: `Parent-${suffix}`,
    relationship: "MOTHER" as const,
    phone: `+23480${suffix.padStart(8, "0")}`,
  });

  // -----------------------------------------------------------------------
  // create — flat /guardians, no link
  // -----------------------------------------------------------------------

  describe("create", () => {
    it("creates a guardian with required fields and writes audit", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");

      const created = await service.create(
        authCtx,
        guardianFields("11111111"),
        reqCtx,
      );

      expect(created.id).toBeTruthy();
      expect(created.firstName).toBe("Bola");
      expect(created.relationship).toBe("MOTHER");
      expect(created.email).toBeNull();
      expect(created.occupation).toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "guardian.create", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();
      const metadata = audit?.metadata as Record<string, unknown>;
      // Audit metadata must NOT contain identifying PII — only the
      // relationship enum (a bucket, not an identifier).
      expect(metadata).toMatchObject({ relationship: "MOTHER" });
      expect(metadata.firstName).toBeUndefined();
      expect(metadata.lastName).toBeUndefined();
      expect(metadata.phone).toBeUndefined();
      expect(metadata.email).toBeUndefined();
      expect(metadata.address).toBeUndefined();
      expect(metadata.occupation).toBeUndefined();
      expect(metadata.employer).toBeUndefined();
    });

    it("creates with optional fields populated", async () => {
      const { authCtx } = await createActiveSchool("create-full");
      const created = await service.create(
        authCtx,
        {
          ...guardianFields("22222222"),
          email: "bola@example.test",
          occupation: "Accountant",
          employer: "Lagos Tax Services",
          address: "14 Bode Thomas, Surulere",
          notes: "Mother — primary contact on weekdays",
        },
        reqCtx,
      );
      expect(created.email).toBe("bola@example.test");
      expect(created.occupation).toBe("Accountant");
      expect(created.employer).toBe("Lagos Tax Services");
      expect(created.address).toBe("14 Bode Thomas, Surulere");
    });

    it("two guardians with the same phone in the same school are allowed (no unique)", async () => {
      const { authCtx } = await createActiveSchool("dup-phone");
      const sharedPhone = "+2348011111111";
      await service.create(
        authCtx,
        { ...guardianFields("D1"), firstName: "Bola", phone: sharedPhone },
        reqCtx,
      );
      await expect(
        service.create(
          authCtx,
          { ...guardianFields("D2"), firstName: "Tunde", phone: sharedPhone },
          reqCtx,
        ),
      ).resolves.toBeTruthy();
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(
        schoolId,
        "forbidden",
      );
      await expect(
        service.create(noRoleCtx, guardianFields("33333333"), reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------
  // findById — detail with linked students
  // -----------------------------------------------------------------------

  describe("findById", () => {
    it("returns guardian with empty students array when not linked", async () => {
      const { authCtx } = await createActiveSchool("fid-empty");
      const g = await service.create(authCtx, guardianFields("44444444"), reqCtx);
      const fetched = await service.findById(authCtx, g.id);
      expect(fetched.id).toBe(g.id);
      expect(fetched.students).toEqual([]);
    });

    it("returns guardian with linked students populated", async () => {
      const { authCtx } = await createActiveSchool("fid-linked");
      const student = await createStudent(authCtx, "F1");
      const g = await service.create(authCtx, guardianFields("55555555"), reqCtx);
      await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g.id, isPrimary: true },
        reqCtx,
      );

      const fetched = await service.findById(authCtx, g.id);
      expect(fetched.students).toHaveLength(1);
      expect(fetched.students[0]).toMatchObject({
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        isPrimary: true,
        canPickup: true,
      });
    });

    it("unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("fid-nf");
      await expect(
        service.findById(authCtx, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // list — cursor + search + studentId filter
  // -----------------------------------------------------------------------

  describe("list", () => {
    it("returns all guardians with empty meta when under limit", async () => {
      const { authCtx } = await createActiveSchool("list-small");
      const a = await service.create(
        authCtx,
        guardianFields("66666661"),
        reqCtx,
      );
      const b = await service.create(
        authCtx,
        { ...guardianFields("66666662"), firstName: "Tunde" },
        reqCtx,
      );
      const result = await service.list(authCtx, {});
      expect(result.data.map((g) => g.id).sort()).toEqual([a.id, b.id].sort());
      expect(result.meta.cursor).toBeUndefined();
    });

    it("paginates by id ASC; meta.cursor advances on the next page", async () => {
      const { authCtx } = await createActiveSchool("list-page");
      const created: { id: string }[] = [];
      for (let i = 0; i < 5; i++) {
        created.push(
          await service.create(
            authCtx,
            { ...guardianFields(`7${i}000000`), lastName: `Pager-${i}` },
            reqCtx,
          ),
        );
      }
      const sortedIds = created.map((c) => c.id).sort();

      const page1 = await service.list(authCtx, { limit: 2 });
      expect(page1.data.map((g) => g.id)).toEqual(sortedIds.slice(0, 2));
      expect(page1.meta.cursor).toBe(sortedIds[1]);

      const page2 = await service.list(authCtx, {
        limit: 2,
        cursor: page1.meta.cursor,
      });
      expect(page2.data.map((g) => g.id)).toEqual(sortedIds.slice(2, 4));

      const page3 = await service.list(authCtx, {
        limit: 2,
        cursor: page2.meta.cursor,
      });
      expect(page3.data.map((g) => g.id)).toEqual([sortedIds[4]]);
      expect(page3.meta.cursor).toBeUndefined();
    });

    it("search matches firstName / lastName / phone (OR'd, case-insensitive)", async () => {
      const { authCtx } = await createActiveSchool("list-search");
      const ada = await service.create(
        authCtx,
        { ...guardianFields("80000001"), firstName: "Adaobi", lastName: "Eze" },
        reqCtx,
      );
      const bello = await service.create(
        authCtx,
        { ...guardianFields("80000002"), firstName: "Bayo", lastName: "Bello" },
        reqCtx,
      );

      const byFirst = await service.list(authCtx, { search: "adaobi" });
      expect(byFirst.data.map((g) => g.id)).toContain(ada.id);
      expect(byFirst.data.map((g) => g.id)).not.toContain(bello.id);

      const byLast = await service.list(authCtx, { search: "BELLO" });
      expect(byLast.data.map((g) => g.id)).toContain(bello.id);

      const byPhone = await service.list(authCtx, { search: "80000001" });
      expect(byPhone.data.map((g) => g.id)).toContain(ada.id);
      expect(byPhone.data.map((g) => g.id)).not.toContain(bello.id);
    });

    it("studentId filter returns only guardians linked to that student", async () => {
      const { authCtx } = await createActiveSchool("list-stu");
      const s1 = await createStudent(authCtx, "L1");
      const s2 = await createStudent(authCtx, "L2", { lastName: "Bello" });
      const linkedToS1 = await service.create(
        authCtx,
        guardianFields("90000001"),
        reqCtx,
      );
      const linkedToS2 = await service.create(
        authCtx,
        { ...guardianFields("90000002"), firstName: "Tunde" },
        reqCtx,
      );
      const unlinked = await service.create(
        authCtx,
        { ...guardianFields("90000003"), firstName: "Ngozi" },
        reqCtx,
      );
      await service.linkExisting(
        authCtx,
        s1.id,
        { guardianId: linkedToS1.id },
        reqCtx,
      );
      await service.linkExisting(
        authCtx,
        s2.id,
        { guardianId: linkedToS2.id },
        reqCtx,
      );

      const result = await service.list(authCtx, { studentId: s1.id });
      const ids = result.data.map((g) => g.id);
      expect(ids).toContain(linkedToS1.id);
      expect(ids).not.toContain(linkedToS2.id);
      expect(ids).not.toContain(unlinked.id);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe("update", () => {
    it("partial-updates and writes audit (metadata = changed field names only)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upd");
      const g = await service.create(authCtx, guardianFields("a1000000"), reqCtx);
      const updated = await service.update(
        authCtx,
        g.id,
        { occupation: "Doctor" },
        reqCtx,
      );
      expect(updated.occupation).toBe("Doctor");

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "guardian.update", entityId: g.id },
          orderBy: { createdAt: "desc" },
        }),
      );
      const metadata = audit?.metadata as Record<string, unknown>;
      expect(metadata.changed).toEqual(["occupation"]);
      // No PII value should appear in audit metadata — only the field name.
      expect(metadata.occupation).toBeUndefined();
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
  // delete — gated on no links
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("hard-deletes a guardian with no links", async () => {
      const { authCtx, schoolId } = await createActiveSchool("del-ok");
      const g = await service.create(authCtx, guardianFields("b1000000"), reqCtx);
      await service.delete(authCtx, g.id, reqCtx);

      const fetched = await withTenant(schoolId, (db) =>
        db.guardian.findUnique({ where: { id: g.id } }),
      );
      expect(fetched).toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "guardian.delete", entityId: g.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("refuses delete while links exist → GUARDIAN_HAS_LINKS", async () => {
      const { authCtx } = await createActiveSchool("del-linked");
      const student = await createStudent(authCtx, "D1");
      const g = await service.create(authCtx, guardianFields("b2000000"), reqCtx);
      await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g.id },
        reqCtx,
      );
      await expect(
        service.delete(authCtx, g.id, reqCtx),
      ).rejects.toMatchObject({ code: "GUARDIAN_HAS_LINKS" });
    });

    it("unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("del-nf");
      await expect(
        service.delete(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // linkExisting — POST /students/:studentId/guardians
  // -----------------------------------------------------------------------

  describe("linkExisting", () => {
    it("links a guardian to a student and writes audit", async () => {
      const { authCtx, schoolId } = await createActiveSchool("link");
      const student = await createStudent(authCtx, "K1");
      const g = await service.create(authCtx, guardianFields("c1000000"), reqCtx);

      const result = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g.id, isPrimary: true, canPickup: false },
        reqCtx,
      );
      expect(result.createdGuardian).toBe(false);
      expect(result.link.studentId).toBe(student.id);
      expect(result.link.guardianId).toBe(g.id);
      expect(result.link.isPrimary).toBe(true);
      expect(result.link.canPickup).toBe(false);
      expect(result.guardian.id).toBe(g.id);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: {
            schoolId,
            action: "student-guardian.create",
            entityId: result.link.id,
          },
        }),
      );
      expect(audit).toBeTruthy();
      const metadata = audit?.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({
        studentId: student.id,
        guardianId: g.id,
        isPrimary: true,
        canPickup: false,
      });
    });

    it("duplicate link → GUARDIAN_ALREADY_LINKED (P2002 mapped)", async () => {
      const { authCtx } = await createActiveSchool("link-dup");
      const student = await createStudent(authCtx, "K2");
      const g = await service.create(authCtx, guardianFields("c2000000"), reqCtx);
      await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g.id },
        reqCtx,
      );
      await expect(
        service.linkExisting(
          authCtx,
          student.id,
          { guardianId: g.id },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "GUARDIAN_ALREADY_LINKED" });
    });

    it("isPrimary=true auto-demotes an existing primary on the same student", async () => {
      const { authCtx, schoolId } = await createActiveSchool("link-demote");
      const student = await createStudent(authCtx, "K3");
      const mum = await service.create(
        authCtx,
        guardianFields("c3000001"),
        reqCtx,
      );
      const dad = await service.create(
        authCtx,
        {
          ...guardianFields("c3000002"),
          firstName: "Tunde",
          relationship: "FATHER",
        },
        reqCtx,
      );

      const firstLink = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: mum.id, isPrimary: true },
        reqCtx,
      );
      expect(firstLink.link.isPrimary).toBe(true);

      const secondLink = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: dad.id, isPrimary: true },
        reqCtx,
      );
      expect(secondLink.link.isPrimary).toBe(true);

      // After the second link, only one link should be isPrimary=true for
      // this student; the mum's link should have been demoted.
      const links = await withTenant(schoolId, (db) =>
        db.studentGuardian.findMany({ where: { studentId: student.id } }),
      );
      const primaries = links.filter((l) => l.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].guardianId).toBe(dad.id);
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { authCtx, schoolId } = await createActiveSchool("link-forbidden");
      const student = await createStudent(authCtx, "K4");
      const g = await service.create(authCtx, guardianFields("c4000000"), reqCtx);
      const { authCtx: noRoleCtx } = await createUserWithoutRole(
        schoolId,
        "link-forbidden",
      );
      await expect(
        service.linkExisting(
          noRoleCtx,
          student.id,
          { guardianId: g.id },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("unknown student → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("link-no-stu");
      const g = await service.create(authCtx, guardianFields("c5000000"), reqCtx);
      await expect(
        service.linkExisting(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          { guardianId: g.id },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("unknown guardian → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("link-no-gua");
      const student = await createStudent(authCtx, "K5");
      await expect(
        service.linkExisting(
          authCtx,
          student.id,
          { guardianId: "00000000-0000-0000-0000-000000000000" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // createAndLink — POST /students/:studentId/guardians/new
  // -----------------------------------------------------------------------

  describe("createAndLink", () => {
    it("creates a Guardian AND a link in one go; both audit rows land", async () => {
      const { authCtx, schoolId } = await createActiveSchool("cnl");
      const student = await createStudent(authCtx, "N1");

      const result = await service.createAndLink(
        authCtx,
        student.id,
        {
          ...guardianFields("d1000000"),
          isPrimary: true,
          canPickup: true,
        },
        reqCtx,
      );
      expect(result.createdGuardian).toBe(true);
      expect(result.guardian.firstName).toBe("Bola");
      expect(result.link.studentId).toBe(student.id);
      expect(result.link.guardianId).toBe(result.guardian.id);
      expect(result.link.isPrimary).toBe(true);

      const audits = await withTenant(schoolId, (db) =>
        db.auditLog.findMany({
          where: {
            schoolId,
            action: { in: ["guardian.create", "student-guardian.create"] },
          },
        }),
      );
      expect(audits.map((a) => a.action).sort()).toEqual([
        "guardian.create",
        "student-guardian.create",
      ]);
    });

    it("isPrimary=true auto-demotes an existing primary on the same student", async () => {
      const { authCtx, schoolId } = await createActiveSchool("cnl-demote");
      const student = await createStudent(authCtx, "N2");
      const mum = await service.create(
        authCtx,
        guardianFields("d2000001"),
        reqCtx,
      );
      await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: mum.id, isPrimary: true },
        reqCtx,
      );

      await service.createAndLink(
        authCtx,
        student.id,
        {
          ...guardianFields("d2000002"),
          firstName: "Tunde",
          relationship: "FATHER",
          isPrimary: true,
        },
        reqCtx,
      );

      const links = await withTenant(schoolId, (db) =>
        db.studentGuardian.findMany({ where: { studentId: student.id } }),
      );
      const primaries = links.filter((l) => l.isPrimary);
      expect(primaries).toHaveLength(1);
      // The newly-created link is the surviving primary.
      const mumLink = links.find((l) => l.guardianId === mum.id);
      expect(mumLink?.isPrimary).toBe(false);
    });

    it("unknown student → NotFoundError; no orphan Guardian is created", async () => {
      const { authCtx, schoolId } = await createActiveSchool("cnl-no-stu");
      await expect(
        service.createAndLink(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          { ...guardianFields("d3000000") },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);

      const orphans = await withTenant(schoolId, (db) =>
        db.guardian.findMany({ where: { firstName: "Bola" } }),
      );
      // No Guardian row was committed (transaction rolled back).
      expect(orphans).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // updateLink — PATCH /student-guardians/:id
  // -----------------------------------------------------------------------

  describe("updateLink", () => {
    it("toggles canPickup without affecting any other link", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upl-pickup");
      const student = await createStudent(authCtx, "U1");
      const g1 = await service.create(authCtx, guardianFields("e1000001"), reqCtx);
      const g2 = await service.create(authCtx, guardianFields("e1000002"), reqCtx);
      const link1 = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g1.id },
        reqCtx,
      );
      const link2 = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g2.id },
        reqCtx,
      );

      await service.updateLink(authCtx, link1.link.id, { canPickup: false }, reqCtx);

      const links = await withTenant(schoolId, (db) =>
        db.studentGuardian.findMany({ where: { studentId: student.id } }),
      );
      const l1After = links.find((l) => l.id === link1.link.id);
      const l2After = links.find((l) => l.id === link2.link.id);
      expect(l1After?.canPickup).toBe(false);
      expect(l2After?.canPickup).toBe(true);
    });

    it("promoting to isPrimary triggers auto-demote", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upl-promote");
      const student = await createStudent(authCtx, "U2");
      const g1 = await service.create(authCtx, guardianFields("e2000001"), reqCtx);
      const g2 = await service.create(authCtx, guardianFields("e2000002"), reqCtx);
      const link1 = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g1.id, isPrimary: true },
        reqCtx,
      );
      const link2 = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g2.id },
        reqCtx,
      );

      await service.updateLink(authCtx, link2.link.id, { isPrimary: true }, reqCtx);

      const links = await withTenant(schoolId, (db) =>
        db.studentGuardian.findMany({ where: { studentId: student.id } }),
      );
      const primaries = links.filter((l) => l.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(link2.link.id);

      const l1After = links.find((l) => l.id === link1.link.id);
      expect(l1After?.isPrimary).toBe(false);
    });

    it("unknown link id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("upl-nf");
      await expect(
        service.updateLink(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          { canPickup: false },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // unlink — DELETE /student-guardians/:id
  // -----------------------------------------------------------------------

  describe("unlink", () => {
    it("removes the link but preserves the Guardian", async () => {
      const { authCtx, schoolId } = await createActiveSchool("unl");
      const student = await createStudent(authCtx, "X1");
      const g = await service.create(authCtx, guardianFields("f1000000"), reqCtx);
      const link = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g.id },
        reqCtx,
      );

      await service.unlink(authCtx, link.link.id, reqCtx);

      const linkAfter = await withTenant(schoolId, (db) =>
        db.studentGuardian.findUnique({ where: { id: link.link.id } }),
      );
      expect(linkAfter).toBeNull();

      const guardianAfter = await withTenant(schoolId, (db) =>
        db.guardian.findUnique({ where: { id: g.id } }),
      );
      expect(guardianAfter).not.toBeNull();
    });

    it("can re-link after unlinking", async () => {
      const { authCtx } = await createActiveSchool("unl-relink");
      const student = await createStudent(authCtx, "X2");
      const g = await service.create(authCtx, guardianFields("f2000000"), reqCtx);
      const link = await service.linkExisting(
        authCtx,
        student.id,
        { guardianId: g.id },
        reqCtx,
      );
      await service.unlink(authCtx, link.link.id, reqCtx);
      await expect(
        service.linkExisting(authCtx, student.id, { guardianId: g.id }, reqCtx),
      ).resolves.toBeTruthy();
    });

    it("unknown link id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("unl-nf");
      await expect(
        service.unlink(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

// Reference imports to satisfy unused-import linting when only used as matchers.
void ConflictError;
