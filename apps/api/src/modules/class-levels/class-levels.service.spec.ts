import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_CLASS_LEVELS, basePrisma, withTenant } from "@school-kit/db";
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
    it("hard-deletes a level and removes it from the list (slice-3 will add a dependent-arms guard)", async () => {
      const { authCtx } = await createActiveSchool("del");
      const list = await service.list(authCtx);
      const sss3 = list.find((l) => l.code === "sss3")!;
      await service.delete(authCtx, sss3.id, reqCtx);
      const after = await service.list(authCtx);
      expect(after.map((l) => l.id)).not.toContain(sss3.id);
      expect(after).toHaveLength(13);
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
