import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_CLASS_LEVELS, basePrisma, defaultArmFor, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { ClassLevelsService } from "./class-levels.service";

// Integration spec — same shape as academic-years.service.spec.ts. Real DB,
// real RLS, real audit, real signup path (so we exercise the seed-on-signup
// from slice 2 as a side effect of every test setup).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("ClassLevelsService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new ClassLevelsService();
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
        schoolName: `Class Levels Spec ${suffix}`,
        schoolSlug: `cl-${suffix}-${runId}`,
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

  // ----------------------------------------------------------------------
  // seed-on-signup
  // ----------------------------------------------------------------------

  describe("seed-on-signup", () => {
    it("fresh signup auto-seeds exactly the 14 default class levels in correct order", async () => {
      const { authCtx } = await createActiveSchool("seed");
      const list = await service.list(authCtx);

      expect(list).toHaveLength(DEFAULT_CLASS_LEVELS.length);
      // Compare ordered (code, name, stage, orderIndex) against the seed
      // constant — guarantees the seed source-of-truth and the DB rows agree.
      const expected = [...DEFAULT_CLASS_LEVELS].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      list.forEach((row, i) => {
        expect(row.code).toBe(expected[i]!.code);
        expect(row.name).toBe(expected[i]!.name);
        expect(row.stage).toBe(expected[i]!.stage);
        expect(row.orderIndex).toBe(expected[i]!.orderIndex);
        expect(row.isActive).toBe(true);
      });
    });

    it("fresh signup also auto-creates one default arm per seeded level (e.g. \"JSS 1\" -> \"JSS 1A\")", async () => {
      // 2026-08-02: each of the 14 seeded levels now gets exactly one arm at
      // signup, so a single-arm school can enroll students without a manual
      // "create an arm" step. Query class_arms directly rather than through
      // ClassArmsService — this spec is about ClassLevelsService's (and
      // AuthService's) responsibility for making this true, not that
      // service's own behavior.
      const { authCtx, schoolId } = await createActiveSchool("seed-arms");
      const levels = await service.list(authCtx);
      expect(levels).toHaveLength(14);

      const arms = await withTenant(schoolId, (db) =>
        db.classArm.findMany({ where: { schoolId }, select: { classLevelId: true, name: true, code: true } }),
      );
      expect(arms).toHaveLength(14);

      for (const level of levels) {
        const arm = arms.find((a) => a.classLevelId === level.id);
        expect(arm, `level ${level.code} should have exactly one default arm`).toBeTruthy();
        const expected = defaultArmFor(level);
        expect(arm!.name).toBe(expected.name);
        expect(arm!.code).toBe(expected.code);
      }

      // Signup bootstrap attributes the whole seed to auth.signup_owner, not
      // one audit row per arm (same precedent as the level seed itself).
      const armAuditRows = await withTenant(schoolId, (db) =>
        db.auditLog.count({ where: { schoolId, action: "class-arm.create" } }),
      );
      expect(armAuditRows).toBe(0);
    });

    it("two separate signups each get their own 14 — no cross-tenant leakage", async () => {
      const a = await createActiveSchool("iso-a");
      const b = await createActiveSchool("iso-b");
      const listA = await service.list(a.authCtx);
      const listB = await service.list(b.authCtx);
      expect(listA).toHaveLength(14);
      expect(listB).toHaveLength(14);
      // Different ids per school but matching codes (deterministic seed).
      expect(new Set(listA.map((l) => l.id)).size).toBe(14);
      const aIds = new Set(listA.map((l) => l.id));
      for (const row of listB) {
        expect(aIds.has(row.id)).toBe(false);
      }
    });
  });

  // ----------------------------------------------------------------------
  // create + list + get
  // ----------------------------------------------------------------------

  describe("create / list / findById", () => {
    it("owner creates a custom class level and it appears in the list at its orderIndex", async () => {
      const { authCtx, schoolId } = await createActiveSchool("create");

      const created = await service.create(
        authCtx,
        { name: "Crèche", code: "creche", stage: "NURSERY", orderIndex: 0 },
        reqCtx,
      );

      expect(created.id).toBeTruthy();
      expect(created.name).toBe("Crèche");
      expect(created.code).toBe("creche");
      expect(created.orderIndex).toBe(0);
      expect(created.isActive).toBe(true);

      // Now 15 total (14 seeded + 1 custom). The custom row sorts first
      // because orderIndex=0 is below the seed's 1..14.
      const list = await service.list(authCtx);
      expect(list).toHaveLength(15);
      expect(list[0]!.id).toBe(created.id);

      // Audit row landed.
      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "class-level.create", entityId: created.id },
        }),
      );
      expect(audit).toBeTruthy();

      // Default arm was also created — "Crèche" -> "CrècheA" / "creche-a" —
      // and unlike the signup-bootstrap seed, THIS path (a standalone admin
      // mutation) writes its own class-arm.create audit row, tagged
      // autoCreated so it's distinguishable from one typed in by hand.
      const arm = await withTenant(schoolId, (db) =>
        db.classArm.findFirst({ where: { schoolId, classLevelId: created.id } }),
      );
      expect(arm).toBeTruthy();
      expect(arm!.name).toBe("CrècheA");
      expect(arm!.code).toBe("creche-a");
      expect(arm!.classTeacherId).toBeNull();
      expect(arm!.capacity).toBeNull();
      expect(arm!.isActive).toBe(true);

      const armAudit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({
          where: { schoolId, action: "class-arm.create", entityId: arm!.id },
        }),
      );
      expect(armAudit).toBeTruthy();
      expect((armAudit!.metadata as { autoCreated?: boolean }).autoCreated).toBe(true);
    });

    it("duplicate code per school → ConflictError CODE_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("dup-code");
      // jss1 is in the seed — colliding with it must reject.
      await expect(
        service.create(
          authCtx,
          { name: "Junior Secondary 1", code: "jss1", stage: "JSS", orderIndex: 50 },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "CODE_TAKEN" });
    });

    it("same code allowed in different schools (tenant scoping)", async () => {
      const a = await createActiveSchool("samecode-a");
      const b = await createActiveSchool("samecode-b");
      // Both schools already have jss1 from the seed → the seed itself proves
      // tenant scoping of (school_id, code). Explicitly create another shared
      // custom code to belt-and-brace it.
      await service.create(
        a.authCtx,
        { name: "Pre-K", code: "prek", stage: "NURSERY", orderIndex: 0 },
        reqCtx,
      );
      await expect(
        service.create(
          b.authCtx,
          { name: "Pre-K", code: "prek", stage: "NURSERY", orderIndex: 0 },
          reqCtx,
        ),
      ).resolves.toBeTruthy();
    });

    it("non-owner/admin → ForbiddenError", async () => {
      const { schoolId } = await createActiveSchool("forbidden");
      const { authCtx: noRoleCtx } = await createUserWithoutRole(schoolId, "forbidden");
      await expect(
        service.create(
          noRoleCtx,
          { name: "X", code: "x1", stage: "PRIMARY", orderIndex: 100 },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.list(noRoleCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("findById returns NotFoundError for unknown id", async () => {
      const { authCtx } = await createActiveSchool("nfid");
      await expect(
        service.findById(authCtx, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ----------------------------------------------------------------------
  // update
  // ----------------------------------------------------------------------

  describe("update", () => {
    it("updates name, stage, orderIndex; isActive=false soft-deletes from default list", async () => {
      const { authCtx } = await createActiveSchool("upd");
      const list = await service.list(authCtx);
      const kg1 = list.find((l) => l.code === "kg1")!;

      const renamed = await service.update(
        authCtx,
        kg1.id,
        { name: "Nursery 1" },
        reqCtx,
      );
      expect(renamed.name).toBe("Nursery 1");
      expect(renamed.code).toBe("kg1");

      // Toggle off → drops from default (active-only) list, but visible with
      // includeInactive=true.
      await service.update(authCtx, kg1.id, { isActive: false }, reqCtx);
      const active = await service.list(authCtx);
      expect(active.find((l) => l.id === kg1.id)).toBeUndefined();
      const all = await service.list(authCtx, { includeInactive: true });
      expect(all.find((l) => l.id === kg1.id)?.isActive).toBe(false);
    });

    it("rename to existing code → ConflictError CODE_TAKEN", async () => {
      const { authCtx } = await createActiveSchool("upd-dup");
      const list = await service.list(authCtx);
      const kg1 = list.find((l) => l.code === "kg1")!;
      // Try to overwrite kg1's code with kg2's code (already in the seed).
      await expect(
        service.update(authCtx, kg1.id, { code: "kg2" }, reqCtx),
      ).rejects.toMatchObject({ code: "CODE_TAKEN" });
    });

    it("update unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("upd-nf");
      await expect(
        service.update(
          authCtx,
          "00000000-0000-0000-0000-000000000000",
          { name: "x" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ----------------------------------------------------------------------
  // delete
  // ----------------------------------------------------------------------

  describe("delete", () => {
    it("hard-deletes a level, removes it from the list, and cascades to its default arm", async () => {
      // Every level now has a default arm (2026-08-02), so this also proves
      // ClassArm's onDelete: Cascade FK still holds rather than blocking the
      // delete with an FK violation — there is no application-level
      // dependent-arms guard (the commented-out one in class-levels.service.ts
      // was never built, and building it now would need to explicitly
      // special-case "just the default arm" or every level would become
      // undeletable).
      const { authCtx, schoolId } = await createActiveSchool("del");
      const list = await service.list(authCtx);
      const sss3 = list.find((l) => l.code === "sss3")!;
      const armBefore = await withTenant(schoolId, (db) =>
        db.classArm.findFirst({ where: { schoolId, classLevelId: sss3.id } }),
      );
      expect(armBefore).toBeTruthy();

      await service.delete(authCtx, sss3.id, reqCtx);

      const after = await service.list(authCtx);
      expect(after.map((l) => l.id)).not.toContain(sss3.id);
      expect(after).toHaveLength(13);

      const armAfter = await withTenant(schoolId, (db) =>
        db.classArm.findUnique({ where: { id: armBefore!.id } }),
      );
      expect(armAfter).toBeNull();
    });

    it("delete unknown id → NotFoundError", async () => {
      const { authCtx } = await createActiveSchool("del-nf");
      await expect(
        service.delete(authCtx, "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

// Keep ConflictError referenced for matchers above.
void ConflictError;
