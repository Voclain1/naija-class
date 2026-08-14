// Read-only verification for the disable-ai-per-school run (2026-08-14).
// Confirms every school carries exactly one correct audit row for the disable,
// and that the flag itself actually landed.
//
// WHY A SCRIPT AND NOT A QUERY. The rows this checks are written TENANT-SCOPED
// (`schoolId` = the school's own id), unlike the platform-admin endpoint's
// cross-tenant rows (`schoolId` = null). `audit_logs` is under FORCE RLS, and
// a GUC-less read only returns null-schoolId rows — so a plain
// `SELECT * FROM audit_logs WHERE action = '...'` returns ZERO and looks
// exactly like "the audit never happened". Every read below therefore sets
// app.current_school_id per school, the same way the writing script did.
//
// Sibling of verify-backfill-state.ts / inspect-backfill-audit.ts. Not part of
// any shipped behaviour; kept out of `src/` deliberately.
//
// USAGE (from the repo root, DATABASE_URL pointing at the target database):
//   pnpm db:verify-disable-ai-audit

import { Prisma, basePrisma } from "../src/index.js";

const DISABLE_AI_AUDIT_ACTION = "platform_admin.schools.disable_ai";
const SET_AI_ENABLED_AUDIT_ACTION = "platform_admin.schools.set-ai-enabled";

interface AuditShape {
  schoolId: string | null;
  userId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

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

function metaOk(m: Prisma.JsonValue): boolean {
  if (m === null || typeof m !== "object" || Array.isArray(m)) return false;
  const o = m as Record<string, unknown>;
  return o.field === "aiEnabled" && o.from === true && o.to === false;
}

async function main(): Promise<void> {
  const schools = await basePrisma.school.findMany({
    select: { id: true, name: true, aiEnabled: true },
    orderBy: { createdAt: "asc" },
  });

  let exactlyOneRow = 0;
  let zeroRows = 0;
  let multipleRows = 0;
  let stillEnabled = 0;
  const anomalies: string[] = [];

  for (const s of schools) {
    if (s.aiEnabled) {
      stillEnabled += 1;
      anomalies.push(`${s.name}: aiEnabled is STILL TRUE`);
    }

    const rows = await inTenant(s.id, (tx) =>
      tx.auditLog.findMany({
        where: { action: DISABLE_AI_AUDIT_ACTION },
        select: {
          schoolId: true,
          userId: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ) as AuditShape[];

    if (rows.length === 0) {
      zeroRows += 1;
      anomalies.push(`${s.name}: NO disable_ai audit row`);
      continue;
    }
    if (rows.length > 1) {
      multipleRows += 1;
      anomalies.push(`${s.name}: ${rows.length} disable_ai audit rows (expected 1)`);
    } else {
      exactlyOneRow += 1;
    }

    for (const r of rows) {
      if (r.schoolId !== s.id) anomalies.push(`${s.name}: audit schoolId != school id`);
      if (r.entityId !== s.id) anomalies.push(`${s.name}: audit entityId != school id`);
      if (r.entityType !== "school") anomalies.push(`${s.name}: entityType=${String(r.entityType)}`);
      // userId null is the operator-run-script design: no request, no acting
      // user. An attributed row here would mean something ELSE wrote it.
      if (r.userId !== null) anomalies.push(`${s.name}: userId is not null (${String(r.userId)})`);
      if (!metaOk(r.metadata)) {
        anomalies.push(`${s.name}: metadata unexpected -> ${JSON.stringify(r.metadata)}`);
      }
    }
  }

  // Any school someone has since deliberately enabled via the platform-admin
  // endpoint. Those rows are cross-tenant (schoolId null), so this read needs
  // no GUC. Expected to be zero immediately after the disable run — and to
  // become non-zero as the pilot rollout starts.
  const deliberateEnables = await basePrisma.auditLog.findMany({
    where: { action: SET_AI_ENABLED_AUDIT_ACTION },
    select: { entityId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nSchools scanned: ${schools.length}`);
  console.log(`  aiEnabled still true:            ${stillEnabled}`);
  console.log(`  exactly one disable_ai row:      ${exactlyOneRow}`);
  console.log(`  zero disable_ai rows:            ${zeroRows}`);
  console.log(`  more than one disable_ai row:    ${multipleRows}`);
  console.log(`  platform-admin toggle rows seen: ${deliberateEnables.length}`);
  console.log(`\nAnomalies: ${anomalies.length}`);
  for (const a of anomalies) console.log(`  !! ${a}`);

  const sample = await inTenant(schools[0]!.id, (tx) =>
    tx.auditLog.findFirst({
      where: { action: DISABLE_AI_AUDIT_ACTION },
      select: { schoolId: true, userId: true, entityType: true, entityId: true, metadata: true },
    }),
  );
  console.log(`\nSample row (${schools[0]!.name}):`);
  console.log(JSON.stringify(sample, null, 2));

  if (anomalies.length > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error("verify failed:", err);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
