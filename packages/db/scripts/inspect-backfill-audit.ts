// Read-only: dump the backfill audit rows for one school, to confirm the
// backfill wrote a correct, tenant-scoped audit entry and did not duplicate
// it on a second --apply. Verification helper, not shipped behaviour.

import { basePrisma } from "../src/index.js";

const ACTION = "platform_admin.schools.backfill_defaults";

async function main(): Promise<void> {
  const needle = process.argv[2] ?? "AU 41py14";
  const school = await basePrisma.school.findFirst({
    where: { name: { contains: needle } },
    select: { id: true, name: true },
  });
  if (!school) {
    console.log(`no school matching "${needle}"`);
    return;
  }

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.current_school_id', $1, true)`,
      school.id,
    );
    const rows = await tx.auditLog.findMany({
      where: { action: ACTION },
      select: {
        action: true,
        schoolId: true,
        userId: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    });
    console.log(`school: ${school.name}`);
    console.log(`backfill audit rows: ${rows.length}`);
    for (const r of rows) {
      console.log(
        JSON.stringify({
          action: r.action,
          schoolIdMatches: r.schoolId === school.id,
          userId: r.userId,
          entityType: r.entityType,
          entityIdMatches: r.entityId === school.id,
          metadata: r.metadata,
          createdAt: r.createdAt.toISOString(),
        }),
      );
    }
  });
}

main()
  .catch((err: unknown) => {
    console.error("inspect failed:", err);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
