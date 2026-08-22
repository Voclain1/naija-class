import { PrismaClient } from "../generated/client/index.js";

async function main(): Promise<void> {
if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is required for the read-only census.");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const rows = await prisma.school.findMany({
  where: { paystackPaymentsEnabled: true, paystackSubaccountCode: { not: null } },
  select: { id: true, paystackSplitCode: true },
  orderBy: { id: "asc" },
});
console.log(JSON.stringify({
  note: "Database eligibility only; apply mode independently fetch-verifies each Paystack subaccount.",
  eligibleCount: rows.length,
  missingCount: rows.filter((row) => !row.paystackSplitCode).length,
  schools: rows.map((row) => ({ schoolId: row.id, hasSplit: Boolean(row.paystackSplitCode) })),
}, null, 2));
await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
