import { afterAll, describe, expect, it } from "vitest";

import { basePrisma } from "@school-kit/db";

// School.aiEnabled must default FALSE — at the database level, not merely in
// schema.prisma (migration 20260814120000, 2026-08-14).
//
// WHY THIS SPEC EXISTS. AI rollout is one school at a time: the platform-wide
// AI_ENABLED env var is the outer gate, and this per-school column is the
// inner one. A default that silently drifts back to `true` re-opens the inner
// gate for every school created after the drift, which is exactly the failure
// this whole rollout is built to prevent — and it would do so invisibly, since
// nothing else in the suite asserts a column default. The concrete precedent:
// the local database gained 3 schools in one afternoon while this work was in
// progress, all of them AI-on, immediately undoing a backfill that had just
// finished.
//
// The DB-level assertion is the load-bearing one. Prisma's `@default()` and
// the Postgres column DEFAULT are two separate facts that a hand-written
// migration can put out of sync, and any writer that bypasses Prisma Client
// (raw SQL, psql, a future migration's backfill) sees only the Postgres one.
// So this checks both, plus that they agree.
describe("School.aiEnabled defaults to false (AI rollout inner gate)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const createdSchoolIds: string[] = [];

  afterAll(async () => {
    if (createdSchoolIds.length > 0) {
      await basePrisma.school.deleteMany({ where: { id: { in: createdSchoolIds } } });
    }
  });

  it("the Postgres column DEFAULT is false", async () => {
    const rows = await basePrisma.$queryRaw<{ column_default: string | null }[]>`
      SELECT column_default
      FROM information_schema.columns
      WHERE table_name = 'schools' AND column_name = 'ai_enabled'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.column_default).toBe("false");
  });

  it("a row inserted by RAW SQL that omits ai_enabled lands false", async () => {
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
      select: { aiEnabled: true },
    });
    expect(school.aiEnabled).toBe(false);
  });

  it("a school created through Prisma without specifying aiEnabled lands false", async () => {
    const school = await basePrisma.school.create({
      data: { name: "AI Default Prisma", slug: `ai-default-prisma-${runId}` },
      select: { id: true, aiEnabled: true },
    });
    createdSchoolIds.push(school.id);
    expect(school.aiEnabled).toBe(false);
  });

  it("parentSummaryEnabled also defaults false — separate decision, same direction", async () => {
    // Guards the D16 amendment: both columns default false for DIFFERENT
    // reasons (who authorises enablement vs. who reads the output). Asserted
    // together so that "fixing" one to match the other trips a test rather
    // than passing silently.
    const school = await basePrisma.school.create({
      data: { name: "AI Default Both", slug: `ai-default-both-${runId}` },
      select: { id: true, aiEnabled: true, parentSummaryEnabled: true },
    });
    createdSchoolIds.push(school.id);
    expect(school.aiEnabled).toBe(false);
    expect(school.parentSummaryEnabled).toBe(false);
  });
});
