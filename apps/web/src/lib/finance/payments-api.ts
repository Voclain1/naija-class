import type {
  PaginatedPaymentsDto,
  PaymentDto,
  PaymentReceiptUrlDto,
  RecordManualPaymentInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function recordManualPayment(input: RecordManualPaymentInput): Promise<PaymentDto> {
  return apiFetch<PaymentDto>("/payments/manual", { method: "POST", body: input });
}

export function listPayments(options: {
  invoiceId?: string;
  studentId?: string;
  page?: number;
  limit?: number;
} = {}): Promise<PaginatedPaymentsDto> {
  const params = new URLSearchParams();
  if (options.invoiceId) params.set("invoiceId", options.invoiceId);
  if (options.studentId) params.set("studentId", options.studentId);
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<PaginatedPaymentsDto>(`/payments${qs}`, { method: "GET" });
}

export function getPayment(id: string): Promise<PaymentDto> {
  return apiFetch<PaymentDto>(`/payments/${id}`, { method: "GET" });
}

export function getPaymentReceiptUrl(id: string): Promise<PaymentReceiptUrlDto> {
  return apiFetch<PaymentReceiptUrlDto>(`/payments/${id}/receipt`, { method: "GET" });
}
