import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AcademicYearsService } from "./academic-years.service";

// Integration spec — same shape as users.service.spec.ts. Real DB, real
// RLS, real audit. Each test creates its own school via the live signup
// path so they're independent.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("AcademicYearsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new AcademicYearsService();
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
        schoolName: `Academic Years Spec ${suffix}`,
        schoolSlug: `ay-${suffix}-${runId}`,
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
      authCtx: { sessionId: "sess-placeholder", userId: signed.user.id, schoolId: signed.school.id },
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
  // create + list + get
  // -----------------------------------------------------------------------

  describe("create / list / findById", () => {
    it("owner creates an academic year and lists it", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");

      const created = await service.create(
        authCtx,
        {
          label: "2025/2026",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        reqCtx,
      );

      expect(created.id).toBeTruthy();
      expect(created.label).toBe("2025/2026");
      expect(created.isCurrent).toBe(false);

      const list = await service.list(authCtx);
      expect(list.map((y) => y.id)).toContain(created.id);

      const fetched = await service.findById(authCtx, created.id);
      expect(fetched.id).toBe(created.id);

      // Audit row landed.
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "academic-year.create", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();
    });

    it("duplicate label per school → ConflictError LABEL_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("dup-label");
      await service.create(
        authCtx,
        { label: "2025/2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );
      await expect(
        service.create(
          authCtx,
          { label: "2025/2026", startDate: new Date("2025-09-15"), endDate: new Date("2026-07-20") },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "LABEL_TAKEN" });
    });

    it("same label allowed in different schools", async () => {
      const a = await createActiveSchool("samelabel-a");
      const b = await createActiveSchool("samelabel-b");
      const startDate = new Date("2025-09-01");
      const endDate = new Date("2026-07-31");
      await service.create(a.authCtx, { label: "2025/2026", startDate, endDate }, reqCtx);
      // Must not collide because schools are different tenants.
      await expect(
        service.create(b.authCtx, { label: "2025/2026", startDate, endDate }, reqCtx),
      ).resolves.toBeTruthy();
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "forbidden");
      await expect(
        service.create(
          noRoleCtx,
          { label: "X", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("findById returns NotFoundError for unknown id", async () => {
      const { authCtx } = await createActiveSchool("nfid");
      await expect(
        service.findById(authCtx, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe("update", () => {
    it("updates label and dates; cross-field date check uses existing row when one date moves", async () => {
      const { authCtx } = await createActiveSchool("upd");
      const yr = await service.create(
        authCtx,
        { label: "Old", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );

      const renamed = await service.update(authCtx, yr.id, { label: "New" }, reqCtx);
      expect(renamed.label).toBe("New");

      // Move ONLY endDate — service must combine with current startDate.
      const movedEnd = await service.update(authCtx, yr.id, { endDate: new Date("2026-08-15") }, reqCtx);
      expect(new Date(movedEnd.endDate).toISOString().slice(0, 10)).toBe("2026-08-15");

      // Move ONLY startDate to a value that would invert against the row's
      // current endDate — should reject.
      await expect(
        service.update(authCtx, yr.id, { startDate: new Date("2026-09-01") }, reqCtx),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rename to existing label → ConflictError LABEL_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("upd-dup");
      await service.create(
        authCtx,
        { label: "Y1", startDate: new Date("2024-09-01"), endDate: new Date("2025-07-31") },
        reqCtx,
      );
      const y2 = await service.create(
        authCtx,
        { label: "Y2", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );
      await expect(
        service.update(authCtx, y2.id, { label: "Y1" }, reqCtx),
      ).rejects.toMatchObject({ code: "LABEL_TAKEN" });
    });
  });

  // -----------------------------------------------------------------------
  // delete (cascade through to terms is tested in terms.service.spec)
  // -----------------------------------------------------------------------

  describe("delete", () => {
    it("hard-deletes a year and removes it from the list", async () => {
      const { authCtx } = await createActiveSchool("del");
      const yr = await service.create(
        authCtx,
        { label: "DEL", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );
      await service.delete(authCtx, yr.id, reqCtx);
      const list = await service.list(authCtx);
      expect(list.map((y) => y.id)).not.toContain(yr.id);
    });
  });

  // -----------------------------------------------------------------------
  // setCurrent
  // -----------------------------------------------------------------------

  describe("setCurrent", () => {
    it("flips siblings to false and sets the target to current", async () => {
      const { authCtx } = await createActiveSchool("sc");
      const y1 = await service.create(
        authCtx,
        { label: "Y1", startDate: new Date("2024-09-01"), endDate: new Date("2025-07-31") },
        reqCtx,
      );
      const y2 = await service.create(
        authCtx,
        { label: "Y2", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );

      await service.setCurrent(authCtx, y1.id, reqCtx);
      let list = await service.list(authCtx);
      expect(list.find((y) => y.id === y1.id)?.isCurrent).toBe(true);
      expect(list.find((y) => y.id === y2.id)?.isCurrent).toBe(false);

      await service.setCurrent(authCtx, y2.id, reqCtx);
      list = await service.list(authCtx);
      expect(list.find((y) => y.id === y1.id)?.isCurrent).toBe(false);
      expect(list.find((y) => y.id === y2.id)?.isCurrent).toBe(true);
    });

    it("idempotent on a row that is already current", async () => {
      const { authCtx } = await createActiveSchool("sc-idem");
      const yr = await service.create(
        authCtx,
        { label: "I", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );
      await service.setCurrent(authCtx, yr.id, reqCtx);
      await expect(service.setCurrent(authCtx, yr.id, reqCtx)).resolves.toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // PARTIAL UNIQUE INDEX — correct-by-construction guard against
  // "two rows with is_current=true for the same school"
  // -----------------------------------------------------------------------
  // The service is supposed to flip siblings before setting a new current.
  // If a future hand-edit forgets that flip, the partial unique index is
  // the safety net. This test reaches under the service to confirm the
  // index works by forcing the violation directly.
  describe("partial unique index: one current per school", () => {
    it("DB rejects a second row being flipped to is_current=true for the same school", async () => {
      const { schoolId, authCtx } = await createActiveSchool("idx");
      const y1 = await service.create(
        authCtx,
        { label: "Y1", startDate: new Date("2024-09-01"), endDate: new Date("2025-07-31") },
        reqCtx,
      );
      const y2 = await service.create(
        authCtx,
        { label: "Y2", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        reqCtx,
      );

      // Set y1 current via the service (uses the partial index correctly).
      await service.setCurrent(authCtx, y1.id, reqCtx);

      // Now reach in directly to try to flip y2 to current WITHOUT first
      // unflipping y1. The DB must reject.
      await expect(
        withTenant(schoolId, (db) =>
          db.academicYear.update({ where: { id: y2.id }, data: { isCurrent: true } }),
        ),
      ).rejects.toThrow();
    });
  });
});

// Silence unused-import warning when ConflictError is referenced only by
// matchers above.
void ConflictError;
