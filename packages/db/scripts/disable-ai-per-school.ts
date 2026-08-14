// One-off backfill: set School.aiEnabled = false explicitly on every existing
// school, so AI is opted into one school at a time rather than switched on for
// all of them at once.
//
// WHY THIS EXISTS. There are two independent AI gates:
//
//   1. AI_ENABLED (env, platform-wide) — currently "false" in production.
//   2. School.aiEnabled (per-school kill switch).
//
// When this script was written, gate 2 was `@default(true)`, so every school
// ever created carried `true` and flipping AI_ENABLED would have enabled the
// entire estate at once. This script closes gate 2 on that pre-existing
// population, making the env flip safe and enablement an explicit per-school
// act.
//
// The default itself flipped to `@default(false)` shortly afterwards
// (migration 20260814120000). That turns this from something that would have
// needed re-running forever — sweeping up schools the default kept re-opening
// behind it — into a genuine one-time cleanup. Ran against production
// 2026-08-14: 26 schools, all disabled, verified.
//
// It stays in the tree rather than being deleted because it is also the bulk
// kill switch: see rail 8 for the one case where re-running it is dangerous,
// and the flag that covers the case where reversing everything is the point.
//
// SAFETY — this touches real schools' data, so the rails mirror
// backfill-school-defaults.ts exactly:
//
//   1. DRY RUN BY DEFAULT. Writes only with an explicit `--apply` flag. With
//      no flag it prints exactly which schools it would touch and exits 0.
//   2. NARROW PREDICATE. Only schools with aiEnabled = true are touched; a
//      school already false is left alone and reported as such.
//
//      CORRECTION (2026-08-14). This bullet previously concluded that the
//      predicate therefore "never re-disables a school somebody has since
//      deliberately enabled". That did not follow, and was dangerously
//      reassuring: a deliberately-enabled school has aiEnabled = TRUE, which
//      is precisely the predicate that selects it. The old wording conflated
//      "already false, so skipped" with "deliberately enabled", which is the
//      opposite value. A re-run after the pilot rollout had started would
//      have switched those pilot schools straight back off, and the comment
//      would have talked the operator out of checking.
//
//      Rail 8 below is the actual protection. Read it before re-running this
//      script against an estate where any school has been enabled on purpose.
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
//   8. NEVER SILENTLY REVERSES A DELIBERATE ENABLEMENT. A school that was
//      turned on via PATCH /platform-admin/schools/:schoolId/ai is SKIPPED,
//      loudly, and the skip names who enabled it and when. The signal is the
//      school's own audit trail — the most recent
//      `platform_admin.schools.set-ai-enabled` row having `to: true` — so it
//      is self-enforcing: nobody has to remember to pass a flag, and the
//      protection cannot drift out of date with the rollout.
//
//      This exists because rail 2's predicate cannot tell a never-touched
//      school from a pilot school: both have aiEnabled = true. Once the
//      rollout starts, a re-run without this rail would switch every pilot
//      school back off in silence.
//
//      Deliberate escape hatch: `--include-deliberately-enabled` disables
//      them too. It is NOT removed, because the original purpose of this
//      column is to be a kill switch — a genuine runaway-cost emergency must
//      be able to stop every school including pilots, and a safeguard that
//      makes the emergency path impossible is the wrong trade. It just can't
//      happen by accident: the flag has to be typed, and the run prints a
//      banner naming every pilot school it is about to reverse.
//
// USAGE (from the repo root):
//   pnpm db:disable-ai-per-school            # dry run, prints candidates
//   pnpm db:disable-ai-per-school -- --apply # performs the backfill
//
//   # emergency only — also disables schools deliberately enabled via
//   # platform-admin. See rail 8.
//   pnpm db:disable-ai-per-school -- --apply --include-deliberately-enabled
//
// Point DATABASE_URL at the target database. Against production that means
// the production app_user URL — the same one the API itself runs with.

// NOTE: like prisma/seed.ts and the sibling backfill scripts, this file sits
// outside `src/` and is therefore NOT covered by `pnpm typecheck` (the
// package's tsconfig sets rootDir/include to src only). The dry run is the
// real verification step before any --apply.
import { Prisma, basePrisma } from "../src/index.js";

const DISABLE_AI_AUDIT_ACTION = "platform_admin.schools.disable_ai";

// Written by PATCH /platform-admin/schools/:schoolId/ai. Cross-tenant rows
// (schoolId null, school identified by entityId), so they are readable
// GUC-less — which is what lets rail 8 resolve the whole estate in one query
// rather than a transaction per school.
const SET_AI_ENABLED_AUDIT_ACTION = "platform_admin.schools.set-ai-enabled";

// Matches the sibling backfill script: Neon round-trip latency overruns
// Prisma's 5000ms default on multi-statement transactions.
const TRANSACTION_TIMEOUT_MS = 20_000;

interface Candidate {
  id: string;
  name: string;
  status: string;
}

interface DeliberateEnable {
  userId: string | null;
  at: Date;
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

// Rail 8. Resolves which schools were deliberately turned ON via
// PATCH /platform-admin/schools/:schoolId/ai, from that endpoint's own audit
// trail. The MOST RECENT set-ai-enabled row per school decides: `to: true`
// means the last deliberate act was an enablement, so the school is part of
// the rollout and must not be swept. If it was later turned off through the
// same endpoint the latest row is `to: false` — and the school is then
// aiEnabled=false anyway, so it never reaches the predicate.
//
// These rows are cross-tenant (schoolId null, school in entityId), which is
// what lets the whole estate resolve in one GUC-less query.
async function resolveDeliberatelyEnabled(): Promise<Map<string, DeliberateEnable>> {
  const rows = await basePrisma.auditLog.findMany({
    where: { action: SET_AI_ENABLED_AUDIT_ACTION },
    select: { entityId: true, userId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const latest = new Map<string, DeliberateEnable>();
  for (const r of rows) {
    if (!r.entityId) continue;
    const meta = r.metadata;
    const to =
      meta !== null && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>).to
        : undefined;
    if (to === true) {
      latest.set(r.entityId, { userId: r.userId, at: r.createdAt });
    } else {
      latest.delete(r.entityId);
    }
  }
  return latest;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const includeDeliberate = process.argv.includes("--include-deliberately-enabled");

  // `schools` has no RLS policy, so this read needs no GUC.
  const schools = await basePrisma.school.findMany({
    select: { id: true, name: true, status: true, aiEnabled: true },
    orderBy: { createdAt: "asc" },
  });

  const deliberatelyEnabled = await resolveDeliberatelyEnabled();

  const candidates: Candidate[] = [];
  const deliberate: Candidate[] = [];
  let alreadyDisabled = 0;

  for (const school of schools) {
    if (!school.aiEnabled) {
      alreadyDisabled += 1;
      continue;
    }
    const row: Candidate = { id: school.id, name: school.name, status: school.status };
    if (deliberatelyEnabled.has(school.id)) {
      deliberate.push(row);
      if (!includeDeliberate) continue;
    }
    candidates.push(row);
  }

  console.log(`\nScanned ${schools.length} schools.`);
  console.log(`  already aiEnabled=false (skipped): ${alreadyDisabled}`);

  if (deliberate.length > 0) {
    console.log(
      includeDeliberate
        ? `\n  !!! ${deliberate.length} school(s) were DELIBERATELY ENABLED via platform-admin, and\n  !!! --include-deliberately-enabled was passed, so this run WILL reverse them:`
        : `\n  PROTECTED (rail 8) — deliberately enabled via platform-admin, NOT disabled: ${deliberate.length}`,
    );
    for (const d of deliberate) {
      const e = deliberatelyEnabled.get(d.id);
      console.log(
        `    - ${d.name} [${d.status}] enabled ${e?.at.toISOString() ?? "?"} by ${e?.userId ?? "?"}`,
      );
    }
    console.log("");
  }

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
