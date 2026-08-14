// Read-only verification helper for the backfill proof (2026-08-14).
// Prints structure counts + backfill audit rows for every school that is
// EITHER structurally empty OR has already been backfilled — i.e. exactly the
// before/after population, identified the same way both times so the two runs
// are comparable.
//
// Not part of the shipped backfill. Kept out of `src/` deliberately, same as
// the backfill script itself.

import { Prisma, basePrisma } from "../src/index.js";

const BACKFILL_AUDIT_ACTION = "platform_admin.schools.backfill_defaults";

async function inTenant<T>(
  schoolId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_school_id', $1, true)`, schoolId);
      return fn(tx);
    },
    { timeout: 20_000 },
  );
}

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  const schools = await basePrisma.school.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  const targets = schools.filter((s) => (names.length ? names.some((n) => s.name.includes(n)) : true));

  for (const s of targets) {
    const r = await inTenant(s.id, async (tx) => ({
      levels: await tx.classLevel.count(),
      arms: await tx.classArm.count(),
      subjects: await tx.subject.count(),
      schemes: await tx.gradingScheme.count(),
      components: await tx.gradingComponent.count(),
      boundaries: await tx.gradeBoundary.count(),
      students: await tx.student.count(),
      backfillAudits: await tx.auditLog.count({ where: { action: BACKFILL_AUDIT_ACTION } }),
    }));
    console.log(
      `${s.name} [${s.status}] levels=${r.levels} arms=${r.arms} subjects=${r.subjects} ` +
        `schemes=${r.schemes} components=${r.components} boundaries=${r.boundaries} ` +
        `students=${r.students} backfillAuditRows=${r.backfillAudits}`,
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error("verify failed:", err);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
