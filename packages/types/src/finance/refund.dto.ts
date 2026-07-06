import { z } from "zod";

export const refundStatusValues = ["REQUESTED", "PROCESSED", "FAILED"] as const;
export type RefundStatus = (typeof refundStatusValues)[number];

export interface RefundDto {
  id: string;
  schoolId: string;
  paymentId: string;
  amount: number; // kobo
  reason: string;
  status: RefundStatus;
  paystackRefundRef: string | null;
  processedBy: string;
  createdAt: Date;
}

export const createRefundSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
