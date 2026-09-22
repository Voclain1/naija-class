import type {
  CreateExpenseInput,
  ListReceiptsInput,
  PaymentReceiptUrlDto,
  ReceiptListResponse,
  ReissueReceiptResultDto,
  ManualPaymentResultDto,
  RecordManualPaymentInput,
  ExpenseCategoryDto,
  ExpenseDto,
  PaymentLinkStateDto,
  SendRemindersInput,
  SendRemindersResult,
} from "@school-kit/types";

import { apiFetch } from "./client";
import { uploadMultipart } from "./native-upload";
import { reminderBatches } from "../staff/money";

// CP9b — the money jobs that moved to the phone (D38).
//
// Every one of these goes to the same endpoint the website uses, through the
// same FinanceService/PaymentsService code, and is audited there. The phone
// computes no fee, discount or balance: it shows what the API returned.
//
// No automatic retries anywhere in this file. A retried reminder is a second
// text message the school pays for; a retried payment is guarded by its
// idempotency key (D37), but that guard is for the HUMAN retry, not a silent
// one.

/**
 * Fee reminders, in batches of the server's limit (50). Sequential, and
 * stops at the first failure so the caller can say exactly how many batches
 * went — a reminder already sent cannot be unsent.
 */
export async function staffSendReminders(
  termId: string,
  studentIds: readonly string[],
): Promise<{ sent: number; skipped: number; batchesSent: number; batchesTotal: number }> {
  const batches = reminderBatches(studentIds);
  let sent = 0;
  let skipped = 0;
  let batchesSent = 0;
  for (const batch of batches) {
    const body: SendRemindersInput = { termId, studentIds: [...batch] };
    const result = await apiFetch<SendRemindersResult>("/finance/debtors/remind", { method: "POST", body });
    sent += result.sent;
    skipped += result.skipped;
    batchesSent += 1;
  }
  return { sent, skipped, batchesSent, batchesTotal: batches.length };
}

/**
 * Record money received (POST /payments/manual). The body MUST carry the
 * form's idempotencyKey (D37), and a retry MUST resend the identical body —
 * same key, same paidAt — so a lost reply can be retried without recording the
 * cash twice. `replayed: true` means the first attempt had got through.
 */
export function staffRecordPayment(
  input: RecordManualPaymentInput & { idempotencyKey: string },
): Promise<ManualPaymentResultDto> {
  return apiFetch<ManualPaymentResultDto>("/payments/manual", { method: "POST", body: input });
}

export function staffPaymentLink(invoiceId: string): Promise<PaymentLinkStateDto> {
  return apiFetch<PaymentLinkStateDto>(`/invoices/${encodeURIComponent(invoiceId)}/payment-link`);
}

export function staffCreatePaymentLink(invoiceId: string): Promise<PaymentLinkStateDto> {
  return apiFetch<PaymentLinkStateDto>(`/invoices/${encodeURIComponent(invoiceId)}/payment-link`, {
    method: "POST",
  });
}

export function staffExpenseCategories(): Promise<ExpenseCategoryDto[]> {
  return apiFetch<ExpenseCategoryDto[]>("/expense-categories");
}

export function staffCreateExpense(input: CreateExpenseInput): Promise<ExpenseDto> {
  return apiFetch<ExpenseDto>("/expenses", { method: "POST", body: input });
}

/** Attach a receipt photo (JPEG/PNG) or PDF, through the native uploader (CP8's fix). */
export function staffUploadExpenseReceipt(
  expenseId: string,
  file: { uri: string; mimeType: string },
): Promise<ExpenseDto> {
  return uploadMultipart<ExpenseDto>(`/expenses/${encodeURIComponent(expenseId)}/receipt`, {
    fileUri: file.uri,
    fieldName: "file",
    mimeType: file.mimeType,
    parameters: {},
  });
}

// Branded receipts (docs/modules/branded-receipts.md D6). Owner, admin and
// bursar only — the server checks the role as well as the permission.

export function staffListReceipts(query: Partial<ListReceiptsInput> = {}): Promise<ReceiptListResponse> {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.page) params.set("page", String(query.page));
  const suffix = params.toString();
  return apiFetch<ReceiptListResponse>(`/payments/receipts${suffix ? `?${suffix}` : ""}`);
}

export function staffReceiptUrl(paymentId: string): Promise<PaymentReceiptUrlDto> {
  return apiFetch<PaymentReceiptUrlDto>(`/payments/${encodeURIComponent(paymentId)}/receipt`);
}

export function staffReissueReceipt(paymentId: string): Promise<ReissueReceiptResultDto> {
  return apiFetch<ReissueReceiptResultDto>(`/payments/${encodeURIComponent(paymentId)}/receipt/reissue`, {
    method: "POST",
  });
}

/**
 * The receipt document itself. The signed URL points at storage, not the API,
 * so no bearer token goes with it — the signature is the authorisation, and
 * it expires in minutes.
 */
export async function staffFetchReceiptHtml(paymentId: string): Promise<string> {
  const { url } = await staffReceiptUrl(paymentId);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`RECEIPT_FETCH_FAILED_${response.status}`);
  const html = await response.text();
  if (!html.includes("OFFICIAL RECEIPT") && !html.includes("Official Receipt")) {
    throw new Error("RECEIPT_NOT_A_RECEIPT");
  }
  return html;
}
