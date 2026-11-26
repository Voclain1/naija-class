import type { PrismaClient } from "@school-kit/db";

export function allocateSchedule<T extends { id: string; amount: number }>(
  installments: T[],
  totalPaid: number,
  targeted: { installmentId: string | null; amount: number; allocatedKobo: number | null }[],
) {
  const paidByTarget = new Map<string, number>();
  let untargeted = totalPaid;
  for (const payment of targeted) {
    if (!payment.installmentId) continue;
    const allocated = payment.allocatedKobo ?? payment.amount;
    paidByTarget.set(payment.installmentId, (paidByTarget.get(payment.installmentId) ?? 0) + allocated);
    untargeted -= allocated;
  }
  let remaining = Math.max(untargeted, 0);
  return installments.map((item) => {
    const direct = Math.min(item.amount, paidByTarget.get(item.id) ?? 0);
    const legacy = Math.min(item.amount - direct, remaining);
    remaining -= legacy;
    return { ...item, amountPaid: direct + legacy, outstanding: item.amount - direct - legacy };
  });
}

export const targetedPayments = {
  where: { status: "SUCCESS", installmentId: { not: null } },
  select: { installmentId: true, amount: true, allocatedKobo: true },
} as const;

export async function installmentOutstanding(
  db: PrismaClient,
  schoolId: string,
  invoiceId: string,
  installmentId: string,
  totalPaid: number,
): Promise<number | null> {
  const plan = await db.paymentPlan.findUnique({
    where: { schoolId_invoiceId: { schoolId, invoiceId } },
    select: { installments: { orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { id: true, amount: true } } },
  });
  if (!plan?.installments.some((item) => item.id === installmentId)) return null;
  const payments = await db.payment.findMany({
    ...targetedPayments,
    where: { ...targetedPayments.where, schoolId, invoiceId },
  });
  return allocateSchedule(plan.installments, totalPaid, payments).find((item) => item.id === installmentId)?.outstanding ?? null;
}
