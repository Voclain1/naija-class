import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AcademicYearsService } from "../academic-years/academic-years.service";
import { TermsService } from "./terms.service";

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23489${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("TermsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const yearsService = new AcademicYearsService();
  const termsService = new TermsService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function setupSchoolWithYear(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Terms Spec ${suffix}`,
        schoolSlug: `t-${suffix}-${runId}`,
        ownerFirstName: "Tara",
        ownerLastName: "Owner",
        ownerEmail: `t-${suffix}-${runId}@example.test`,
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
    const authCtx = { sessionId: "sess-placeholder", userId: signed.user.id, schoolId: signed.school.id };
    const year = await yearsService.create(
      authCtx,
      { label: `${suffix}-2025/2026`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
      reqCtx,
    );
    return { schoolId: signed.school.id, userId: signed.user.id, authCtx, year };
  }

  // -----------------------------------------------------------------------
  // create / list / get
  // -----------------------------------------------------------------------

  describe("create / listForYear / findById", () => {
    it("creates three terms within a year, in sequence", async () => {
      const { authCtx, year, schoolId } = await setupSchoolWithYear("crud");

      const t1 = await termsService.create(
        authCtx,
        year.id,
        {
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        reqCtx,
      );
      expect(t1.academicYearId).toBe(year.id);

      await termsService.create(
        authCtx,
        year.id,
        {
          sequence: 2,
          name: "Second Term",
          startDate: new Date("2026-01-10"),
          endDate: new Date("2026-04-10"),
        },
        reqCtx,
      );
      await termsService.create(
        authCtx,
        year.id,
        {
          sequence: 3,
          name: "Third Term",
          startDate: new Date("2026-04-25"),
          endDate: new Date("2026-07-25"),
        },
        reqCtx,
      );

      const list = await termsService.listForYear(authCtx, year.id);
      expect(list.map((t) => t.sequence)).toEqual([1, 2, 3]);

      // Audit row landed for create.
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "term.create", entityId: t1.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("duplicate sequence within a year → ConflictError SEQUENCE_TAKEN", async () => {
      const { authCtx, year } = await setupSchoolWithYear("dup-seq");
      await termsService.create(
        authCtx,
        year.id,
        { sequence: 1, name: "T1", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        reqCtx,
      );
      await expect(
        termsService.create(
          authCtx,
          year.id,
          { sequence: 1, name: "Also T1", startDate: new Date("2025-09-15"), endDate: new Date("2025-12-20") },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "SEQUENCE_TAKEN" });
    });

    it("dates outside the parent year → VALIDATION_ERROR", async () => {
      const { authCtx, year } = await setupSchoolWithYear("outside");
      await expect(
        termsService.create(
          authCtx,
          year.id,
          {
            sequence: 1,
            name: "Way Too Early",
            startDate: new Date("2024-01-01"),
            endDate: new Date("2024-04-01"),
          },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("unknown parent year → NotFoundError", async () => {
      const { authCtx } = await setupSchoolWithYear("nfy");
      await expect(
        termsService.create(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          {
            sequence: 1,
            name: "Orphan",
            startDate: new Date("2025-09-01"),
            endDate: new Date("2025-12-15"),
          },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // delete (cascade from year)
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("deleting a year cascades to its terms", async () => {
      const { authCtx, year } = await setupSchoolWithYear("cascade");
      const t = await termsService.create(
        authCtx,
        year.id,
        { sequence: 1, name: "T1", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        reqCtx,
      );
      await yearsService.delete(authCtx, year.id, reqCtx);
      await expect(termsService.findById(authCtx, t.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // SET-CURRENT CASCADE — the key Phase 1 / Slice 1 invariant.
  //
  // Setting Term 2 current must ALSO set its parent academic_year to current.
  // This is the one invariant the DB does not enforce (the partial unique
  // index guarantees uniqueness per school, but doesn't link year ↔ term).
  // The test re-fetches the parent year AFTER setCurrent and asserts
  // isCurrent === true.
  // -----------------------------------------------------------------------

  describe("setCurrent (cascade to parent year)", () => {
    it("setting a term current sets its parent year current AND unflips other years/terms", async () => {
      const { authCtx } = await setupSchoolWithYear("cascade-current");

      // Build two years, each with one term. Start with y1/term-y1 as current.
      const y1 = await yearsService.create(
        authCtx,
        { label: "CC-Y1", startDate: new Date("2024-09-01"), endDate: new Date("2025-07-31") },
        reqCtx,
      );
      const y2 = await yearsService.create(
        authCtx,
        { label: "CC-Y2", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );
      const ty1 = await termsService.create(
        authCtx,
        y1.id,
        { sequence: 1, name: "Y1 T1", startDate: new Date("2024-09-01"), endDate: new Date("2024-12-15") },
        reqCtx,
      );
      const ty2 = await termsService.create(
        authCtx,
        y2.id,
        { sequence: 1, name: "Y2 T1", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        reqCtx,
      );

      await yearsService.setCurrent(authCtx, y1.id, reqCtx);
      await termsService.setCurrent(authCtx, ty1.id, reqCtx);

      // Sanity: y1 / ty1 are current.
      let years = await yearsService.list(authCtx);
      expect(years.find((y) => y.id === y1.id)?.isCurrent).toBe(true);
      expect(years.find((y) => y.id === y2.id)?.isCurrent).toBe(false);
      let terms = [
        ...(await termsService.listForYear(authCtx, y1.id)),
        ...(await termsService.listForYear(authCtx, y2.id)),
      ];
      expect(terms.find((t) => t.id === ty1.id)?.isCurrent).toBe(true);
      expect(terms.find((t) => t.id === ty2.id)?.isCurrent).toBe(false);

      // Now the load-bearing call: set ty2 current.
      const updated = await termsService.setCurrent(authCtx, ty2.id, reqCtx);
      expect(updated.isCurrent).toBe(true);

      // CASCADE ASSERTION — y2 must now be current and y1 unflipped.
      years = await yearsService.list(authCtx);
      const y1After = years.find((y) => y.id === y1.id);
      const y2After = years.find((y) => y.id === y2.id);
      expect(y2After?.isCurrent).toBe(true);
      expect(y1After?.isCurrent).toBe(false);

      // And ty1 must have been unflipped (only one current term per school).
      terms = [
        ...(await termsService.listForYear(authCtx, y1.id)),
        ...(await termsService.listForYear(authCtx, y2.id)),
      ];
      expect(terms.find((t) => t.id === ty1.id)?.isCurrent).toBe(false);
      expect(terms.find((t) => t.id === ty2.id)?.isCurrent).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // PARTIAL UNIQUE INDEX — one current term per school
  // -----------------------------------------------------------------------

  describe("partial unique index: one current term per school", () => {
    it("DB rejects flipping a second term to is_current=true for the same school", async () => {
      const { schoolId, authCtx, year } = await setupSchoolWithYear("idx");
      const a = await termsService.create(
        authCtx,
        year.id,
        { sequence: 1, name: "A", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        reqCtx,
      );
      const b = await termsService.create(
        authCtx,
        year.id,
        { sequence: 2, name: "B", startDate: new Date("2026-01-10"), endDate: new Date("2026-04-10") },
        reqCtx,
      );

      await termsService.setCurrent(authCtx, a.id, reqCtx);

      await expect(
        withTenant(schoolId, (db) =>
          db.term.update({ where: { id: b.id }, data: { isCurrent: true } }),
        ),
      ).rejects.toThrow();
    });
  });
});

void ConflictError;
