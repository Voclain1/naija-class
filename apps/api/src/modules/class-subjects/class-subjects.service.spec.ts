import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { SubjectsService } from "../subjects/subjects.service";
import { ClassSubjectsService } from "./class-subjects.service";

// Integration spec — real DB, real RLS, real audit. The /bulk endpoint is
// the security-critical surface here: a single rollback boundary, no
// partial state. The atomicity test in the "bulk" block is the proof.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("ClassSubjectsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const subjectsService = new SubjectsService();
  const service = new ClassSubjectsService();
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
        schoolName: `Class Subjects Spec ${suffix}`,
        schoolSlug: `cs-${suffix}-${runId}`,
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

  async function firstSeededLevel(schoolId: string): Promise<string> {
    const row = await withTenant(schoolId, (db) =>
      db.classLevel.findFirst({
        where: { code: "kg1" },
        select: { id: true },
      }),
    );
    if (!row) throw new Error("KG 1 seed missing");
    return row.id;
  }

  async function makeSubject(authCtx: { schoolId: string; userId: string; sessionId: string }, suffix: string) {
    return subjectsService.create(
      authCtx,
      { name: `Subject ${suffix}`, code: `s-${suffix}` },
      reqCtx,
    );
  }

  // -----------------------------------------------------------------------
  // single create / list / findById
  // -----------------------------------------------------------------------

  describe("create (single) / list / findById", () => {
    it("owner links a subject to a level; audit row lands", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");
      const levelId = await firstSeededLevel(schoolId);
      const subject = await makeSubject(authCtx, "math");

      const link = await service.create(
        authCtx,
        levelId,
        { subjectId: subject.id },
        reqCtx,
      );

      expect(link.classLevelId).toBe(levelId);
      expect(link.subjectId).toBe(subject.id);
      expect(link.isCore).toBe(true);

      const list = await service.listForLevel(authCtx, levelId);
      expect(list.map((l) => l.id)).toContain(link.id);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "class-subject.create", entityId: link.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("create with subject from another school → NotFoundError", async () => {
      const a = await createActiveSchool("xt-a");
      const b = await createActiveSchool("xt-b");
      const levelA = await firstSeededLevel(a.schoolId);
      const subjectB = await makeSubject(b.authCtx, "xt");
      await expect(
        service.create(a.authCtx, levelA, { subjectId: subjectB.id }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("create under another school's level → NotFoundError", async () => {
      const a = await createActiveSchool("xt-l-a");
      const b = await createActiveSchool("xt-l-b");
      const levelB = await firstSeededLevel(b.schoolId);
      const subjectA = await makeSubject(a.authCtx, "math");
      await expect(
        service.create(a.authCtx, levelB, { subjectId: subjectA.id }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("duplicate (level, subject) → ConflictError LINK_EXISTS", async () => {
      const { authCtx, schoolId } = await createActiveSchool("dup-link");
      const levelId = await firstSeededLevel(schoolId);
      const subject = await makeSubject(authCtx, "math");
      await service.create(authCtx, levelId, { subjectId: subject.id }, reqCtx);
      await expect(
        service.create(authCtx, levelId, { subjectId: subject.id }, reqCtx),
      ).rejects.toMatchObject({ code: "LINK_EXISTS" });
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const levelId = await firstSeededLevel(schoolId);
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "forbidden");
      await expect(
        service.create(
          noRoleCtx,
          levelId,
          { subjectId: "00000000-0000-0000-0000-000000000000" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -----------------------------------------------------------------------
  // update (toggle isCore)
  // -----------------------------------------------------------------------

  describe("update", () => {
    it("flips isCore", async () => {
      const { authCtx, schoolId } = await createActiveSchool("upd");
      const levelId = await firstSeededLevel(schoolId);
      const subject = await makeSubject(authCtx, "math");
      const link = await service.create(authCtx, levelId, { subjectId: subject.id }, reqCtx);
      const updated = await service.update(authCtx, link.id, { isCore: false }, reqCtx);
      expect(updated.isCore).toBe(false);
    });

    it("update unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("upd-nf");
      await expect(
        service.update(authCtx, "00000000-0000-0000-0000-000000000000", { isCore: true }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("unlinks a subject from a level", async () => {
      const { authCtx, schoolId } = await createActiveSchool("del");
      const levelId = await firstSeededLevel(schoolId);
      const subject = await makeSubject(authCtx, "math");
      const link = await service.create(authCtx, levelId, { subjectId: subject.id }, reqCtx);
      await service.delete(authCtx, link.id, reqCtx);
      const list = await service.listForLevel(authCtx, levelId);
      expect(list.map((l) => l.id)).not.toContain(link.id);
    });
  });

  // -----------------------------------------------------------------------
  // BULK — the load-bearing atomicity tests
  // -----------------------------------------------------------------------

  describe("bulk (atomic create + delete in single transaction)", () => {
    it("creates multiple links in one call; audit logs ONE bulk row, not N", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-create");
      const levelId = await firstSeededLevel(schoolId);
      const s1 = await makeSubject(authCtx, "m");
      const s2 = await makeSubject(authCtx, "e");
      const s3 = await makeSubject(authCtx, "c");

      const result = await service.bulk(
        authCtx,
        levelId,
        {
          create: [
            { subjectId: s1.id },
            { subjectId: s2.id, isCore: false },
            { subjectId: s3.id },
          ],
          delete: [],
        },
        reqCtx,
      );

      const subjectIds = result.map((r) => r.subjectId);
      expect(subjectIds).toEqual(expect.arrayContaining([s1.id, s2.id, s3.id]));
      const elective = result.find((r) => r.subjectId === s2.id);
      expect(elective?.isCore).toBe(false);

      const auditRows = await withTenant(schoolId, (db) =>
        db.auditLog.findMany({
          where: { schoolId, action: "class-subject.bulk" },
          select: { id: true, metadata: true },
        }),
      );
      expect(auditRows).toHaveLength(1);
      expect((auditRows[0].metadata as { createdCount?: number })?.createdCount).toBe(3);

      // No per-entry class-subject.create rows from the bulk path.
      const perEntryRows = await withTenant(schoolId, (db) =>
        db.auditLog.findMany({
          where: { schoolId, action: "class-subject.create" },
        }),
      );
      expect(perEntryRows).toHaveLength(0);
    });

    it("deletes existing links + creates new ones in the same call", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-mixed");
      const levelId = await firstSeededLevel(schoolId);
      const oldSub = await makeSubject(authCtx, "old");
      const newSub = await makeSubject(authCtx, "new");
      const oldLink = await service.create(authCtx, levelId, { subjectId: oldSub.id }, reqCtx);

      const after = await service.bulk(
        authCtx,
        levelId,
        {
          create: [{ subjectId: newSub.id }],
          delete: [oldLink.id],
        },
        reqCtx,
      );

      const subjectIds = after.map((r) => r.subjectId);
      expect(subjectIds).toContain(newSub.id);
      expect(subjectIds).not.toContain(oldSub.id);
    });

    // ---------------------------------------------------------------------
    // ATOMICITY PROOF — the "tests pass / runtime fails" gate the user
    // explicitly called out. One valid + one invalid entry; the whole
    // batch must roll back; the valid entry must NOT persist.
    // ---------------------------------------------------------------------
    it("ATOMICITY: one valid + one invalid subjectId → entire batch rolls back, nothing persists", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-atomic");
      const levelId = await firstSeededLevel(schoolId);
      const validSubject = await makeSubject(authCtx, "valid");
      const fakeSubjectId = "00000000-0000-0000-0000-000000000001";

      // Pre-state: zero links on the level.
      const before = await service.listForLevel(authCtx, levelId);
      expect(before).toHaveLength(0);

      // Send a bulk with one good + one bad; the bad subject id doesn't
      // exist in this tenant, so the up-front validate must reject and the
      // whole tx rolls back BEFORE the good entry's create is attempted.
      await expect(
        service.bulk(
          authCtx,
          levelId,
          {
            create: [{ subjectId: validSubject.id }, { subjectId: fakeSubjectId }],
            delete: [],
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);

      // Post-state: still zero links — the valid one is NOT half-created.
      const after = await service.listForLevel(authCtx, levelId);
      expect(after).toHaveLength(0);

      // No audit row from a failed bulk (the audit write is the last step
      // inside the tx; rollback discards it).
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "class-subject.bulk" },
        }),
      );
      expect(audit).toBeNull();
    });

    it("ATOMICITY: pre-existing link + duplicate in create payload → rollback, original survives unchanged", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-dup-survive");
      const levelId = await firstSeededLevel(schoolId);
      const subject = await makeSubject(authCtx, "math");
      const original = await service.create(
        authCtx,
        levelId,
        { subjectId: subject.id, isCore: true },
        reqCtx,
      );

      // Try to "re-link" the same subject in a bulk op — the unique
      // (school_id, level_id, subject_id) constraint fires; the whole
      // batch rolls back; the original link must remain intact and
      // unchanged.
      await expect(
        service.bulk(
          authCtx,
          levelId,
          {
            create: [{ subjectId: subject.id, isCore: false }],
            delete: [],
          },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "LINK_EXISTS" });

      const survivor = await service.findById(authCtx, original.id);
      expect(survivor.id).toBe(original.id);
      expect(survivor.isCore).toBe(true); // NOT toggled to false by the rolled-back op
    });

    it("ATOMICITY: delete-of-nonexistent-id → rollback, no creates persisted", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-del-nf");
      const levelId = await firstSeededLevel(schoolId);
      const sub = await makeSubject(authCtx, "math");
      const fakeLinkId = "00000000-0000-0000-0000-000000000002";

      await expect(
        service.bulk(
          authCtx,
          levelId,
          { create: [{ subjectId: sub.id }], delete: [fakeLinkId] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);

      const after = await service.listForLevel(authCtx, levelId);
      expect(after).toHaveLength(0);
    });

    it("rejects duplicate subjectId within a single bulk payload (pre-DB)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-pay-dup");
      const levelId = await firstSeededLevel(schoolId);
      const sub = await makeSubject(authCtx, "math");

      await expect(
        service.bulk(
          authCtx,
          levelId,
          {
            create: [{ subjectId: sub.id }, { subjectId: sub.id, isCore: false }],
            delete: [],
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);

      const after = await service.listForLevel(authCtx, levelId);
      expect(after).toHaveLength(0);
    });

    it("bulk on another school's level → NotFoundError, nothing persisted in either school", async () => {
      const a = await createActiveSchool("bulk-xt-a");
      const b = await createActiveSchool("bulk-xt-b");
      const levelB = await firstSeededLevel(b.schoolId);
      const subA = await makeSubject(a.authCtx, "math");

      await expect(
        service.bulk(
          a.authCtx,
          levelB,
          { create: [{ subjectId: subA.id }], delete: [] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);

      const afterB = await service.listForLevel(b.authCtx, levelB);
      expect(afterB).toHaveLength(0);
    });

    it("delete-only bulk op succeeds (create array empty)", async () => {
      const { authCtx, schoolId } = await createActiveSchool("bulk-del-only");
      const levelId = await firstSeededLevel(schoolId);
      const s = await makeSubject(authCtx, "math");
      const link = await service.create(authCtx, levelId, { subjectId: s.id }, reqCtx);

      const result = await service.bulk(
        authCtx,
        levelId,
        { create: [], delete: [link.id] },
        reqCtx,
      );
      expect(result).toHaveLength(0);
    });
  });
});

// Reference matchers so unused-import lint stays quiet.
void ConflictError;
void ValidationError;
