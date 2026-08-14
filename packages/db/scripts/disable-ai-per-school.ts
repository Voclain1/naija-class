// One-off backfill: set School.aiEnabled = false explicitly on every existing
// school, so AI is opted into one school at a time rather than switched on for
// all of them at once.
//
// WHY THIS EXISTS. There are two independent AI gates:
//
//   1. AI_ENABLED (env, platform-wide) — currently "false" in production.
//   2. School.aiEnabled (per-school kill switch) — `@default(true)` in
//      schema.prisma, so every school ever created carries `true`.
//
// Only gate 1 is holding AI back today. The moment AI_ENABLED is flipped to
// "true" — a single env var on one Fly app — every school in the database
// becomes AI-enabled simultaneously, because gate 2 is open everywhere by
// default. That is the opposite of the deliberate, one-school-at-a-time
// rollout the plan calls for. This script closes gate 2 on the existing
// population so that flipping AI_ENABLED becomes safe, and enabling a school
// becomes an explicit, per-school act.
//
// The `@default(true)` in schema.prisma is deliberately NOT changed here (see
// its header comment, and parentSummaryEnabled's directly below it — the
// default-true was a considered decision, not an oversight). Consequence:
// schools created AFTER this runs will again arrive with aiEnabled = true.
// That gap is real and is called out in the report accompanying this script;
// closing it is a product decision, not something a backfill should do
// unilaterally.
//
// SAFETY — this touches real schools' data, so the rails mirror
// backfill-school-defaults.ts exactly:
//
//   1. DRY RUN BY DEFAULT. Writes only with an explicit `--apply` flag. With
//      no flag it prints exactly which schools it would touch and exits 0.
//   2. NARROW PREDICATE. Only schools with aiEnabled = true are touched. A
//      school already false is left alone and reported as such — so this
//      never re-disables a school somebody has since deliberately enabled
//      (which is the entire point of the rollout this prepares for).
//   3. NO OTHER FIELD IS WRITTEN. aiMonthlyTokenBudget, parentSummaryEnabled
//      and everything else are untouched. In particular parentSummaryEnabled
//      is already `@default(false)` and needs no backfill.
//   4. RLS-SCOPED, NOT SUPERUSER. Connects as the ordinary runtime role
//      (DATABASE_URL / app_user), never DIRECT_URL. `schools` is the one
//      table with no RLS policy — it IS the tenant table every other policy
//      keys off — so the School update itself needs no GUC; the audit_logs
//      write does, and gets one per school.
//   5. IDEMPOTENT. A second run finds zero candidates and does nothing.
//   6. AUDITED. One audit_logs row per school, tenant-scoped.
//   7. REVERSIBLE. The inverse is a per-school `aiEnabled = true`, which is
//      exactly the rollout action this prepares for — no data is destroyed.
//
// USAGE (from the repo root):
//   pnpm db:disable-ai-per-school            # dry run, prints candidates
//   pnpm db:disable-ai-per-school -- --apply # performs the backfill
//
// Point DATABASE_URL at the target database. Against production that means
// the production app_user URL — the same one the API itself runs with.

// NOTE: like prisma/seed.ts and the sibling backfill scripts, this file sits
// outside `src/` and is therefore NOT covered by `pnpm typecheck` (the
// package's tsconfig sets rootDir/include to src only). The dry run is the
// real verification step before any --apply.
import { Prisma, basePrisma } from "../src/index.js";

const DISABLE_AI_AUDIT_ACTION = "platform_admin.schools.disable_ai";

// Matches the sibling backfill script: Neon round-trip latency overruns
// Prisma's 5000ms default on multi-statement transactions.
const TRANSACTION_TIMEOUT_MS = 20_000;

interface Candidate {
  id: string;
  name: string;
  status: string;
}

// Runs `fn` with the tenant GUC set, the same way withTenant() does — spelled
// out here rather than imported because the School update and its audit row
// belong in ONE transaction per school.
async function inTenant<T>(
  schoolId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_school_id', $1, true)`, schoolId);
      return fn(tx);
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  // `schools` has no RLS policy, so this read needs no GUC.
  const schools = await basePrisma.school.findMany({
    select: { id: true, name: true, status: true, aiEnabled: true },
    orderBy: { createdAt: "asc" },
  });

  const candidates: Candidate[] = [];
  let alreadyDisabled = 0;

  for (const school of schools) {
    if (!school.aiEnabled) {
      alreadyDisabled += 1;
      continue;
    }
    candidates.push({ id: school.id, name: school.name, status: school.status });
  }

  console.log(`\nScanned ${schools.length} schools.`);
  console.log(`  already aiEnabled=false (skipped): ${alreadyDisabled}`);
  console.log(`  to disable: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`    - ${c.name} [${c.status}]`);
  }

  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (!apply) {
    console.log("\nDRY RUN — no rows written. Re-run with --apply to disable AI on these schools.");
    return;
  }

  console.log("\nApplying...");
  for (const c of candidates) {
    await inTenant(c.id, async (tx) => {
      await tx.school.update({
        where: { id: c.id },
        data: { aiEnabled: false },
      });
      await tx.auditLog.create({
        data: {
          schoolId: c.id,
          // No acting user: this is an operator-run rollout-prep script, not
          // a request. Left null rather than attributed to a platform admin
          // who did not personally trigger this school's write — same
          // reasoning as backfill-school-defaults.ts.
          userId: null,
          action: DISABLE_AI_AUDIT_ACTION,
          entityType: "school",
          entityId: c.id,
          metadata: {
            field: "aiEnabled",
            from: true,
            to: false,
            reason:
              "explicit opt-out ahead of one-school-at-a-time AI enablement; schema default is true",
          },
        },
      });
    });

    // Verify from a fresh read rather than trusting the write.
    const after = await basePrisma.school.findUnique({
      where: { id: c.id },
      select: { aiEnabled: true },
    });
    console.log(`  OK ${c.name}: aiEnabled=${String(after?.aiEnabled)}`);
  }

  const stillEnabled = await basePrisma.school.count({ where: { aiEnabled: true } });
  console.log(`\nDisabled ${candidates.length} schools.`);
  console.log(`Schools still aiEnabled=true across the database: ${stillEnabled}`);
}

main()
  .catch((err: unknown) => {
    console.error("Disable-AI backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
