import { withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";
import { z } from "zod";

export const paymentExceptionReviewSchema = z.object({
  reference: z.string().min(1).max(220),
  reason: z.string().regex(/^[A-Z_]{1,64}$/),
  status: z.enum(["ACKNOWLEDGED", "PROVIDER_ESCALATED", "EVIDENCE_RECORDED"]),
  evidenceRef: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
}).strict();
export type PaymentExceptionReview = z.infer<typeof paymentExceptionReviewSchema>;

export function listPaymentExceptions(schoolId: string, invoiceId: string) {
  return withTenant(schoolId, async (db) => {
    const rows = await db.paystackPaymentException.findMany({
      where: { schoolId, invoiceId }, take: 100, orderBy: [{ createdAt: "desc" }, { reference: "asc" }, { reason: "asc" }],
    });
    return {
      items: rows.map(({ schoolId: _schoolId, observedKobo, ...row }) => ({
        ...row, observedKobo: observedKobo === null ? null : String(observedKobo),
      })),
    };
  });
}

export function reviewPaymentException(schoolId: string, actorId: string, invoiceId: string, input: PaymentExceptionReview) {
  return withTenant(schoolId, async (db) => {
    const reviewedAt = new Date();
    const result = await db.paystackPaymentException.updateMany({
      where: { schoolId, invoiceId, reference: input.reference, reason: input.reason },
      data: { reviewStatus: input.status, reviewedAt },
    });
    if (result.count !== 1) throw new NotFoundError("Payment exception not found.");
    await db.auditLog.create({
      data: {
        schoolId, userId: actorId, action: "payment.reconciliation.review",
        entityType: "paystack_exception", entityId: input.reference,
        metadata: { invoiceId, reason: input.reason, status: input.status, evidenceRef: input.evidenceRef },
      },
    });
    return { status: input.status, reviewedAt };
  });
}
