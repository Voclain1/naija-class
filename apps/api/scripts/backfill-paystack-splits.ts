import { ConfigService } from "@nestjs/config";

import { withTenant } from "@school-kit/db";

import { PaystackService } from "../src/common/paystack/paystack.service.js";
import { parsePaystackSplitBackfillArgs } from "../src/common/paystack/paystack-split-backfill.args.js";

async function main(): Promise<void> {
const { apply, schoolId, actorUserId, actorSchoolId } = parsePaystackSplitBackfillArgs(
  process.argv.slice(2),
);
if (apply) {
  const actor = await withTenant(actorSchoolId!, (db) =>
    db.user.findFirst({
      where: { id: actorUserId!, schoolId: actorSchoolId!, isActive: true },
      select: { isPlatformAdmin: true },
    }),
  );
  if (!actor?.isPlatformAdmin) {
    throw new Error("The supplied actor must identify an active platform-admin operator.");
  }
}

const paystack = new PaystackService(new ConfigService(process.env));
const results: Array<Record<string, unknown>> = [];

for (const reviewedSchoolId of [schoolId]) {
  const school = await withTenant(reviewedSchoolId, (db) => db.school.findUnique({
    where: { id: reviewedSchoolId },
    select: {
      id: true,
      paystackPaymentsEnabled: true,
      paystackSubaccountCode: true,
      paystackSplitCode: true,
    },
  }));
  if (!school) throw new Error(`School not found: ${reviewedSchoolId}`);
  if (!school.paystackPaymentsEnabled || !school.paystackSubaccountCode) {
    results.push({ schoolId: reviewedSchoolId, result: "ineligible" });
    continue;
  }
  if (school.paystackSplitCode) {
    const split = await paystack.getSplit(school.paystackSplitCode);
    paystack.assertSchoolPercentageSplit(split, school.paystackSubaccountCode);
    results.push({ schoolId: reviewedSchoolId, result: "already-verified", splitCode: split.split_code });
    continue;
  }
  if (!apply) {
    results.push({ schoolId: reviewedSchoolId, result: "would-create" });
    continue;
  }

  const subaccount = await paystack.getSubaccount(school.paystackSubaccountCode);
  if (!subaccount.active) {
    throw new Error(`Paystack subaccount is inactive for school ${reviewedSchoolId}.`);
  }
  const split = await paystack.ensureSchoolPercentageSplit({
    schoolId: reviewedSchoolId,
    subaccountCode: school.paystackSubaccountCode,
  });
  const wrote = await withTenant(reviewedSchoolId, async (db) => {
    const update = await db.school.updateMany({
      where: { id: reviewedSchoolId, paystackSplitCode: null },
      data: { paystackSplitCode: split.split_code },
    });
    if (update.count === 1) {
      await db.auditLog.create({
        data: {
          schoolId: reviewedSchoolId,
          userId: actorUserId!,
          action: "paystack-split.backfilled",
          entityType: "school",
          entityId: reviewedSchoolId,
          metadata: { splitCode: split.split_code, subaccountCode: school.paystackSubaccountCode },
        },
      });
    }
    return update.count;
  });
  results.push({ schoolId: reviewedSchoolId, result: wrote === 1 ? "created" : "concurrent-skip", splitCode: split.split_code });
}

console.info(JSON.stringify({ mode: apply ? "apply" : "dry-run", results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
