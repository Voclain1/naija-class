import { withTenant } from "@school-kit/db";

import { parseInvoiceArmBackfillArgs } from "../src/modules/invoices/invoice-arm-backfill.args.js";
import {
  applyInvoiceArmBackfill,
  planInvoiceArmBackfill,
} from "../src/modules/invoices/invoice-arm-backfill.js";

async function main(): Promise<void> {
  const { apply, schoolId, actorUserId, actorSchoolId } = parseInvoiceArmBackfillArgs(
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
      throw new Error("The supplied actor must be an active platform-admin operator.");
    }
  }

  const result = await withTenant(schoolId, async (db) => {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new Error(`School not found: ${schoolId}`);
    const plan = await planInvoiceArmBackfill(db, schoolId);
    if (!apply) return { mode: "dry-run", plan };
    const updatedCount = await applyInvoiceArmBackfill(db, schoolId, actorUserId!, plan);
    return { mode: "apply", plan, updatedCount };
  });

  console.info(JSON.stringify({ schoolId, ...result }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
