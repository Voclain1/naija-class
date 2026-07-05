import type {
  CreatePaymentPlanInput,
  PaymentPlanDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getPaymentPlan(invoiceId: string): Promise<PaymentPlanDto | null> {
  return apiFetch<PaymentPlanDto | null>(`/payment-plans/invoice/${encodeURIComponent(invoiceId)}`, {
    method: "GET",
  });
}

export function createPaymentPlan(input: CreatePaymentPlanInput): Promise<PaymentPlanDto> {
  return apiFetch<PaymentPlanDto>("/payment-plans", { method: "POST", body: input });
}

export function deletePaymentPlan(planId: string): Promise<void> {
  return apiFetch<void>(`/payment-plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
}
