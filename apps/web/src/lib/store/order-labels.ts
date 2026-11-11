import type { StoreOrderSummaryDto } from "@school-kit/types";

// The state of a store order's own invoice, in words, from the invoice's status
// as the API returned it (docs/modules/store-orders.md).
export function invoiceLabel(o: StoreOrderSummaryDto): { text: string; tone: "success" | "warning" | "muted" } | null {
  if (!o.invoice) return null;
  if (o.invoice.status === "PAID") return { text: "Paid", tone: "success" };
  if (o.invoice.status === "CANCELLED") return { text: "Invoice cancelled", tone: "muted" };
  if (o.invoice.status === "PARTIALLY_PAID") return { text: "Part paid", tone: "warning" };
  return { text: "Unpaid", tone: "warning" };
}
