import type { PrismaClient } from "@school-kit/db";

/** Older payments predate a distinct allocation and contribute their gross amount. */
export async function invoiceAllocatedTotal(db: PrismaClient, schoolId: string, invoiceId: string, through?: Date): Promise<number> {
  const [result] = await db.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(COALESCE(allocated_kobo, amount)), 0) AS total
    FROM payments WHERE school_id = ${schoolId} AND invoice_id = ${invoiceId} AND status = 'SUCCESS'
      AND (${through ?? null}::timestamp IS NULL OR created_at <= ${through ?? null})`;
  return Number(result?.total ?? 0n);
}
