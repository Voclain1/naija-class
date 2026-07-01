import type {
  GenerateInvoicesInput,
  GenerateInvoicesResponseDto,
  InvoiceDto,
  InvoiceStatus,
  PaginatedInvoicesDto,
  PreviewLineDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function previewInvoices(params: {
  termId: string;
  classArmId: string;
}): Promise<PreviewLineDto[]> {
  const qs = new URLSearchParams({ termId: params.termId, classArmId: params.classArmId });
  return apiFetch<PreviewLineDto[]>(`/invoices/arm/preview?${qs}`, { method: "GET" });
}

export function generateInvoices(
  input: GenerateInvoicesInput,
): Promise<GenerateInvoicesResponseDto> {
  return apiFetch<GenerateInvoicesResponseDto>("/invoices/arm/generate", {
    method: "POST",
    body: input,
  });
}

export function listInvoices(options: {
  termId?: string;
  classArmId?: string;
  studentId?: string;
  status?: InvoiceStatus;
  page?: number;
  limit?: number;
} = {}): Promise<PaginatedInvoicesDto> {
  const params = new URLSearchParams();
  if (options.termId) params.set("termId", options.termId);
  if (options.classArmId) params.set("classArmId", options.classArmId);
  if (options.studentId) params.set("studentId", options.studentId);
  if (options.status) params.set("status", options.status);
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<PaginatedInvoicesDto>(`/invoices${qs}`, { method: "GET" });
}

export function getInvoice(id: string): Promise<InvoiceDto> {
  return apiFetch<InvoiceDto>(`/invoices/${id}`, { method: "GET" });
}

export function cancelInvoice(id: string): Promise<InvoiceDto> {
  return apiFetch<InvoiceDto>(`/invoices/${id}/cancel`, { method: "POST" });
}
