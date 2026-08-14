// One-off backfill: give schools that were provisioned WITHOUT academic
// structure the same defaults every other school got.
//
// WHY THIS EXISTS. PlatformAdminService.createSchool shipped 2026-08-07
// creating a School + owner Invitation and nothing else — no class levels, no
// arms, no subject catalogue, no grading scheme. Four schools provisioned on
// 2026-08-08 were left unusable: their owners could accept the invitation, log
// in, and then do nothing, because every academic workflow in the product
// depends on a class arm existing. The code path is fixed as of 2026-08-14
// (both provisioning and signup now call applySchoolDefaults), but that fix is
// forward-only. This script repairs the schools already created.
//
// SAFETY — this touches real schools' data, so every rail is deliberate:
//
//   1. DRY RUN BY DEFAULT. Writes only with an explicit `--apply` flag. With
//      no flag it prints exactly which schools it would touch and exits 0.
//   2. NARROW PREDICATE. A school qualifies only when class levels, class
//      arms, subjects AND grading schemes are ALL zero. A school that has any
//      of them has been set up or customised, and is skipped — this is not a
//      "top up to 14 levels" script. It matters: real schools in this database
//      have 6 and 15 levels, having deleted and added to the defaults. A
//      looser predicate would overwrite deliberate configuration.
//   3. STUDENT GUARD. Any school with students is skipped regardless. No
//      current candidate has students; this is belt-and-braces against the
//      script being re-run later against a database that has moved on.
//   4. RLS-SCOPED, NOT SUPERUSER. Connects as the ordinary runtime role
//      (DATABASE_URL / app_user) and sets app.current_school_id per school,
//      exactly like the application does. It deliberately does NOT use
//      DIRECT_URL: a backfill has no business bypassing RLS, and running
//      under the same policies the app runs under means a tenancy mistake
//      fails loudly here instead of silently writing across tenants.
//   5. SHARED SEED DEFINITION. Calls the same applySchoolDefaults() the
//      application calls. A SQL script would have had to restate the seed
//      data, reintroducing precisely the drift this whole fix removes.
//   6. IDEMPOTENT. applySchoolDefaults is createMany/skipDuplicates + upsert
//      throughout, so a re-run is a no-op rather than a constraint violation.
//   7. AUDITED. One audit_logs row per school, tenant-scoped.
//
// USAGE (from the repo root):
//   pnpm db:backfill-school-defaults            # dry run, prints candidates
//   pnpm db:backfill-school-defaults -- --apply # performs the backfill
//
// Point DATABASE_URL at the target database. Against production that means
// the production app_user URL — the same one the API itself runs with.

// NOTE: like prisma/seed.ts and prisma/dev-seed.ts, this file sits outside
// `src/` and is therefore NOT covered by `pnpm typecheck` (the package's
// tsconfig sets rootDir/include to src only). Types here are written
// explicitly rather than inferred through helper generics, and the dry run is
// the real verification step before any --apply.
import { Prisma, basePrisma, applySchoolDefaults } from "../src/index.js";

const BACKFILL_AUDIT_ACTION = "platform_admin.schools.backfill_defaults";

// Same 20s as both application callers, for the same reason: ~8 sequential
// round-trips against Neon latency overruns Prisma's 5000ms default.
const BACKFILL_TRANSACTION_TIMEOUT_MS = 20_000;

interface Candidate {
  id: string;
  name: string;
  status: string;
}

// Runs `fn` with the tenant GUC set, the same way withTenant() does — spelled
// out here rather than imported because this script also needs the counts and
// the seed call inside ONE transaction per school.
async function inTenant<T>(
  schoolId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_school_id', $1, true)`, schoolId);
      return fn(tx);
    },
    { timeout: BACKFILL_TRANSACTION_TIMEOUT_MS },
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  // `schools` is the one table with no RLS policy — it IS the tenant table
  // every other policy keys off — so this read needs no GUC.
  const schools = await basePrisma.school.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  const candidates: Candidate[] = [];
  let skippedConfigured = 0;
  let skippedHasStudents = 0;

  for (const school of schools) {
    const counts = await inTenant(school.id, async (tx) => ({
      levels: await tx.classLevel.count(),
      arms: await tx.classArm.count(),
      subjects: await tx.subject.count(),
      schemes: await tx.gradingScheme.count(),
      students: await tx.student.count(),
    }));

    const isEmpty =
      counts.levels === 0 && counts.arms === 0 && counts.subjects === 0 && counts.schemes === 0;

    if (!isEmpty) {
      skippedConfigured += 1;
      continue;
    }
    if (counts.students > 0) {
      // Structurally empty but has students — should be impossible, and is
      // exactly the case where guessing would be worst. Report, never touch.
      skippedHasStudents += 1;
      console.log(
        `  !! SKIPPED (has ${counts.students} students but no structure): ${school.name}`,
      );
      continue;
    }
    candidates.push({ id: school.id, name: school.name, status: school.status });
  }

  console.log(`\nScanned ${schools.length} schools.`);
  console.log(`  already configured (skipped): ${skippedConfigured}`);
  if (skippedHasStudents > 0) {
    console.log(`  empty but has students (skipped): ${skippedHasStudents}`);
  }
  console.log(`  backfill candidates: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`    - ${c.name} [${c.status}]`);
  }

  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (!apply) {
    console.log("\nDRY RUN — no rows written. Re-run with --apply to perform the backfill.");
    return;
  }

  console.log("\nApplying...");
  for (const c of candidates) {
    await inTenant(c.id, async (tx) => {
      await applySchoolDefaults(tx, c.id);
      await tx.auditLog.create({
        data: {
          schoolId: c.id,
          // No acting user: this is an operator-run repair script, not a
          // request. Left null rather than attributed to a platform admin who
          // did not personally trigger this school's write.
          userId: null,
          action: BACKFILL_AUDIT_ACTION,
          entityType: "school",
          entityId: c.id,
          metadata: {
            reason: "provisioned before applySchoolDefaults was wired into createSchool",
          },
        },
      });
    });

    // Verify from a fresh read rather than trusting the write.
    const after = await inTenant(c.id, async (tx) => ({
      levels: await tx.classLevel.count(),
      arms: await tx.classArm.count(),
      subjects: await tx.subject.count(),
      components: await tx.gradingComponent.count(),
      boundaries: await tx.gradeBoundary.count(),
    }));
    console.log(
      `  OK ${c.name}: levels=${after.levels} arms=${after.arms} subjects=${after.subjects} ` +
        `components=${after.components} boundaries=${after.boundaries}`,
    );
  }
  console.log(`\nBackfilled ${candidates.length} schools.`);
}

main()
  .catch((err: unknown) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
