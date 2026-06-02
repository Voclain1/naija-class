import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { GradingService } from "./grading.service";

// Integration spec — real DB, real RLS, real audit. Each test creates its own
// school via the live signup path (which now seeds the default grading config),
// so the cases are independent. Same shape as academic-years.service.spec.ts.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("GradingService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new GradingService();
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
        schoolName: `Grading Spec ${suffix}`,
        schoolSlug: `grading-${suffix}-${runId}`,
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

  // -------------------------------------------------------------------------
  // Default seed shape (acceptance #1 + #2)
  // -------------------------------------------------------------------------

  it("seeds one scheme with CA1/CA2/Exam = 20/20/60 (Σ=100) on fresh signup", async () => {
    const { authCtx } = await createActiveSchool("seed-scheme");
    const scheme = await service.getScheme(authCtx);

    expect(scheme.name).toBe("WAEC-style (default)");
    expect(scheme.isActive).toBe(true);
    expect(scheme.components.map((c) => [c.key, c.weight])).toEqual([
      ["ca1", 20],
      ["ca2", 20],
      ["exam", 60],
    ]);
    expect(scheme.components.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it("seeds exactly one scheme, three components, nine boundaries (no duplicates)", async () => {
    const { schoolId } = await createActiveSchool("seed-counts");
    const counts = await withTenant(schoolId, async (db) => ({
      schemes: await db.gradingScheme.count(),
      components: await db.gradingComponent.count(),
      boundaries: await db.gradeBoundary.count(),
    }));
    expect(counts).toEqual({ schemes: 1, components: 3, boundaries: 9 });
  });

  it("seeds the WAEC bands with EXACT values A1=75-100 … F9=0-39", async () => {
    const { authCtx } = await createActiveSchool("seed-bands");
    const bands = await service.listBoundaries(authCtx);
    expect(bands.map((b) => [b.letter, b.minScore, b.maxScore])).toEqual([
      ["A1", 75, 100],
      ["B2", 70, 74],
      ["B3", 65, 69],
      ["C4", 60, 64],
      ["C5", 55, 59],
      ["C6", 50, 54],
      ["D7", 45, 49],
      ["E8", 40, 44],
      ["F9", 0, 39],
    ]);
  });

  it("upserting the scheme seed again does not create a duplicate (retry idempotency)", async () => {
    const { schoolId } = await createActiveSchool("seed-idem");
    await withTenant(schoolId, (db) =>
      db.gradingScheme.upsert({
        where: { schoolId },
        update: {},
        create: { schoolId, name: "WAEC-style (default)" },
        select: { id: true },
      }),
    );
    const count = await withTenant(schoolId, (db) => db.gradingScheme.count());
    expect(count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Sum-to-100 invariant (acceptance #3)
  // -------------------------------------------------------------------------

  it("replaceComponents accepts a set summing to 100 (15/15/10/60)", async () => {
    const { authCtx } = await createActiveSchool("sum-ok");
    const scheme = await service.replaceComponents(
      authCtx,
      {
        components: [
          { key: "ca1", label: "First CA", weight: 15, orderIndex: 1 },
          { key: "ca2", label: "Second CA", weight: 15, orderIndex: 2 },
          { key: "project", label: "Project", weight: 10, orderIndex: 3 },
          { key: "exam", label: "Exam", weight: 60, orderIndex: 4 },
        ],
      },
      reqCtx,
    );
    expect(scheme.components.map((c) => c.key)).toEqual(["ca1", "ca2", "project", "exam"]);
    expect(scheme.components.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });

  it("replaceComponents rejects a set that does not sum to 100 and rolls back", async () => {
    const { authCtx } = await createActiveSchool("sum-bad");
    await expect(
      service.replaceComponents(
        authCtx,
        {
          components: [
            { key: "ca1", label: "First CA", weight: 20, orderIndex: 1 },
            { key: "ca2", label: "Second CA", weight: 20, orderIndex: 2 },
            { key: "exam", label: "Exam", weight: 52, orderIndex: 3 }, // Σ = 92
          ],
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // Original seed is untouched.
    const scheme = await service.getScheme(authCtx);
    expect(scheme.components.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(scheme.components).toHaveLength(3);
  });

  it("createComponent that breaks the sum is rejected and rolled back", async () => {
    const { authCtx } = await createActiveSchool("create-breaks");
    await expect(
      service.createComponent(
        authCtx,
        { key: "project", label: "Project", weight: 10, orderIndex: 4 }, // Σ would be 110
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const scheme = await service.getScheme(authCtx);
    expect(scheme.components).toHaveLength(3); // no new row survived
  });

  it("updateComponent that breaks the sum is rejected and rolled back", async () => {
    const { authCtx } = await createActiveSchool("update-breaks");
    const scheme = await service.getScheme(authCtx);
    const ca1 = scheme.components.find((c) => c.key === "ca1")!;
    await expect(
      service.updateComponent(authCtx, ca1.id, { weight: 30 }, reqCtx), // Σ would be 110
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await service.getScheme(authCtx);
    expect(after.components.find((c) => c.key === "ca1")!.weight).toBe(20);
  });

  it("deleteComponent that breaks the sum is rejected and rolled back", async () => {
    const { authCtx } = await createActiveSchool("delete-breaks");
    const scheme = await service.getScheme(authCtx);
    const exam = scheme.components.find((c) => c.key === "exam")!;
    await expect(
      service.deleteComponent(authCtx, exam.id, reqCtx), // Σ would be 40
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await service.getScheme(authCtx);
    expect(after.components).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Boundary tile-0-100 invariant (acceptance #2)
  // -------------------------------------------------------------------------

  it("replaceBoundaries accepts a valid custom set that tiles 0..100", async () => {
    const { authCtx } = await createActiveSchool("tile-ok");
    const bands = await service.replaceBoundaries(
      authCtx,
      {
        boundaries: [
          { letter: "A", minScore: 70, maxScore: 100, remark: "Distinction", orderIndex: 1 },
          { letter: "B", minScore: 50, maxScore: 69, remark: "Merit", orderIndex: 2 },
          { letter: "F", minScore: 0, maxScore: 49, remark: "Fail", orderIndex: 3 },
        ],
      },
      reqCtx,
    );
    expect(bands.map((b) => b.letter)).toEqual(["A", "B", "F"]);
  });

  it("replaceBoundaries rejects a set with a gap", async () => {
    const { authCtx } = await createActiveSchool("tile-gap");
    await expect(
      service.replaceBoundaries(
        authCtx,
        {
          boundaries: [
            { letter: "A", minScore: 70, maxScore: 100, orderIndex: 1 },
            { letter: "F", minScore: 0, maxScore: 60, orderIndex: 2 }, // gap 61..69
          ],
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("replaceBoundaries rejects a set with an overlap", async () => {
    const { authCtx } = await createActiveSchool("tile-overlap");
    await expect(
      service.replaceBoundaries(
        authCtx,
        {
          boundaries: [
            { letter: "A", minScore: 60, maxScore: 100, orderIndex: 1 },
            { letter: "F", minScore: 0, maxScore: 65, orderIndex: 2 }, // overlap 60..65
          ],
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("replaceBoundaries rejects a set that does not reach 100", async () => {
    const { authCtx } = await createActiveSchool("tile-short");
    await expect(
      service.replaceBoundaries(
        authCtx,
        {
          boundaries: [
            { letter: "A", minScore: 50, maxScore: 99, orderIndex: 1 }, // tops out at 99
            { letter: "F", minScore: 0, maxScore: 49, orderIndex: 2 },
          ],
        },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updateBoundary that breaks the tiling is rejected and rolled back", async () => {
    const { authCtx } = await createActiveSchool("update-tile");
    const bands = await service.listBoundaries(authCtx);
    const a1 = bands.find((b) => b.letter === "A1")!;
    await expect(
      service.updateBoundary(authCtx, a1.id, { maxScore: 99 }, reqCtx), // top no longer 100
    ).rejects.toBeInstanceOf(ValidationError);

    const after = await service.listBoundaries(authCtx);
    expect(after.find((b) => b.letter === "A1")!.maxScore).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Role gate + not-found
  // -------------------------------------------------------------------------

  it("rejects a user without owner/admin role", async () => {
    const { schoolId } = await createActiveSchool("role-gate");
    const { authCtx } = await createUserWithoutRole(schoolId, "role-gate");
    await expect(service.getScheme(authCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("updateScheme renames the scheme and writes an audit row", async () => {
    const { authCtx, schoolId } = await createActiveSchool("rename");
    const updated = await service.updateScheme(authCtx, { name: "House scheme" }, reqCtx);
    expect(updated.name).toBe("House scheme");

    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: "grading-scheme.update" }, select: { id: true } }),
    );
    expect(audit).not.toBeNull();
  });

  it("getScheme throws NotFound when a school somehow has no scheme", async () => {
    const { schoolId, authCtx } = await createActiveSchool("no-scheme");
    // Force the pathological state the backfill + seed normally prevent.
    await withTenant(schoolId, (db) => db.gradingScheme.deleteMany({}));
    await expect(service.getScheme(authCtx)).rejects.toBeInstanceOf(NotFoundError);
  });
});
