import { ConfigService } from "@nestjs/config";

import { withTenant } from "@school-kit/db";

import { PaystackService } from "../src/common/paystack/paystack.service.js";

async function main(): Promise<void> {
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const actorIndex = args.indexOf("--actor-user-id");
const actorUserId = actorIndex >= 0 ? args[actorIndex + 1] : undefined;
const actorSchoolIndex = args.indexOf("--actor-school-id");
const actorSchoolId = actorSchoolIndex >= 0 ? args[actorSchoolIndex + 1] : undefined;
const schoolIds = args
  .map((arg, index) => (arg === "--school-id" ? args[index + 1] : undefined))
  .filter((value): value is string => Boolean(value));

if (schoolIds.length === 0) {
  throw new Error("Pass at least one operator-reviewed --school-id <uuid>.");
}
if (apply && (!actorUserId || !actorSchoolId)) {
  throw new Error("--apply requires --actor-user-id and --actor-school-id for audit.");
}
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

for (const schoolId of schoolIds) {
  const school = await withTenant(schoolId, (db) => db.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      paystackPaymentsEnabled: true,
      paystackSubaccountCode: true,
      paystackSplitCode: true,
    },
  }));
  if (!school) throw new Error(`School not found: ${schoolId}`);
  if (!school.paystackPaymentsEnabled || !school.paystackSubaccountCode) {
    results.push({ schoolId, result: "ineligible" });
    continue;
  }
  if (school.paystackSplitCode) {
    const split = await paystack.getSplit(school.paystackSplitCode);
    paystack.assertSchoolPercentageSplit(split, school.paystackSubaccountCode);
    results.push({ schoolId, result: "already-verified", splitCode: split.split_code });
    continue;
  }
  if (!apply) {
    results.push({ schoolId, result: "would-create" });
    continue;
  }

  const subaccount = await paystack.getSubaccount(school.paystackSubaccountCode);
  if (!subaccount.active) {
    throw new Error(`Paystack subaccount is inactive for school ${schoolId}.`);
  }
  const split = await paystack.ensureSchoolPercentageSplit({
    schoolId,
    subaccountCode: school.paystackSubaccountCode,
  });
  const wrote = await withTenant(schoolId, async (db) => {
    const update = await db.school.updateMany({
      where: { id: schoolId, paystackSplitCode: null },
      data: { paystackSplitCode: split.split_code },
    });
    if (update.count === 1) {
      await db.auditLog.create({
        data: {
          schoolId,
          userId: actorUserId!,
          action: "paystack-split.backfilled",
          entityType: "school",
          entityId: schoolId,
          metadata: { splitCode: split.split_code, subaccountCode: school.paystackSubaccountCode },
        },
      });
    }
    return update.count;
  });
  results.push({ schoolId, result: wrote === 1 ? "created" : "concurrent-skip", splitCode: split.split_code });
}

console.info(JSON.stringify({ mode: apply ? "apply" : "dry-run", results }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
