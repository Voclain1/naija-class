import { afterAll, describe, expect, it } from "vitest";

import { basePrisma } from "@school-kit/db";

// School.aiEnabled and School.smartImportEnabled default TRUE — at the
// database level, not merely in schema.prisma (migration 20261125120000,
// 2026-10-25, the owner's decision to open AI and Smart Student Import to every
// school; they defaulted false from 2026-08-14 to then).
//
// WHY THIS SPEC EXISTS. What a new school starts with is a product decision,
// and nothing else in the suite asserts a column default, so a default that
// drifts would change it invisibly. The school's OWN opt-ins
// (parentSummaryEnabled, assignmentFeedbackAiEnabled) stay false: those are
// the school's choice, not the platform's, and are pinned here too so that
// "fixing" them to match trips a test.
//
// The DB-level assertion is the load-bearing one. Prisma's `@default()` and
// the Postgres column DEFAULT are two separate facts that a hand-written
// migration can put out of sync, and any writer that bypasses Prisma Client
// (raw SQL, psql, a future migration's backfill) sees only the Postgres one.
// So this checks both, plus that they agree.
describe("School.aiEnabled and smartImportEnabled default to true; the school's own AI opt-ins to false", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const createdSchoolIds: string[] = [];

  afterAll(async () => {
    if (createdSchoolIds.length > 0) {
      await basePrisma.school.deleteMany({ where: { id: { in: createdSchoolIds } } });
    }
  });

  it("the Postgres column DEFAULTs are true", async () => {
    const rows = await basePrisma.$queryRaw<{ column_name: string; column_default: string | null }[]>`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_name = 'schools' AND column_name IN ('ai_enabled', 'smart_import_enabled')
      ORDER BY column_name
    `;
    expect(rows).toEqual([
      { column_name: "ai_enabled", column_default: "true" },
      { column_name: "smart_import_enabled", column_default: "true" },
    ]);
  });

  it("a row inserted by RAW SQL that omits both lands true", async () => {
    // Deliberately bypasses Prisma Client: this is what proves the DATABASE
    // default is doing the work, independently of whatever the generated
    // client happens to send. `schools` has no RLS policy, so no GUC needed.
    const id = crypto.randomUUID();
    createdSchoolIds.push(id);
    await basePrisma.$executeRaw`
      INSERT INTO schools (id, name, slug, created_at, updated_at)
      VALUES (${id}, ${"AI Default Raw"}, ${`ai-default-raw-${runId}`}, now(), now())
    `;

    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id },
      select: { aiEnabled: true, smartImportEnabled: true },
    });
    expect(school).toEqual({ aiEnabled: true, smartImportEnabled: true });
  });

  it("a school created through Prisma without specifying them lands true", async () => {
    const school = await basePrisma.school.create({
      data: { name: "AI Default Prisma", slug: `ai-default-prisma-${runId}` },
      select: { id: true, aiEnabled: true, smartImportEnabled: true },
    });
    createdSchoolIds.push(school.id);
    expect(school.aiEnabled).toBe(true);
    expect(school.smartImportEnabled).toBe(true);
  });

  it("the school's own opt-ins still default false — a different decision", async () => {
    // parentSummaryEnabled and assignmentFeedbackAiEnabled are the SCHOOL's
    // choice (who reads the output), not the platform's (who may generate).
    // Asserted beside the platform switches so that "fixing" them to match
    // trips a test rather than passing silently.
    const school = await basePrisma.school.create({
      data: { name: "AI Default Both", slug: `ai-default-both-${runId}` },
      select: { id: true, aiEnabled: true, parentSummaryEnabled: true, assignmentFeedbackAiEnabled: true },
    });
    createdSchoolIds.push(school.id);
    expect(school.aiEnabled).toBe(true);
    expect(school.parentSummaryEnabled).toBe(false);
    expect(school.assignmentFeedbackAiEnabled).toBe(false);
  });
});
