import type { InvoiceDto } from "@school-kit/types";

// Record payment (2026-10-30): the pure parts of /finance/payments/record.
// The page searches GET /invoices?search=…&unpaid=true and turns the bills it
// gets back into one row per student, oldest bill first, so the bursar picks a
// child rather than an invoice. Pure, with a sibling spec: apps/web has no
// DOM test setup by deliberate choice.

export interface PayerGroup {
  studentId: string;
  name: string;
  admissionNumber: string | null;
  /** Unpaid bills, oldest first: the one most likely being paid comes first. */
  bills: InvoiceDto[];
  /** Kobo, as the API returned it summed. Display only. */
  owed: number;
}

export function balanceOf(invoice: Pick<InvoiceDto, "totalDue" | "totalPaid">): number {
  return Math.max(0, invoice.totalDue - invoice.totalPaid);
}

function oldestFirst(a: InvoiceDto, b: InvoiceDto): number {
  const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return t !== 0 ? t : a.sequence - b.sequence;
}

export function groupBillsByStudent(invoices: InvoiceDto[]): PayerGroup[] {
  const groups = new Map<string, PayerGroup>();
  for (const inv of invoices) {
    if (balanceOf(inv) <= 0) continue;
    let g = groups.get(inv.studentId);
    if (!g) {
      g = {
        studentId: inv.studentId,
        name: inv.studentName?.trim() || "Unknown student",
        admissionNumber: inv.admissionNumber,
        bills: [],
        owed: 0,
      };
      groups.set(inv.studentId, g);
    }
    g.bills.push(inv);
    g.owed += balanceOf(inv);
  }
  const list = [...groups.values()];
  for (const g of list) g.bills.sort(oldestFirst);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** "Term bill" or "Extra bill 2", the words a bursar uses. */
export function billLabel(invoice: Pick<InvoiceDto, "sequence">): string {
  return invoice.sequence === 0 ? "Term bill" : `Extra bill ${invoice.sequence}`;
}

/**
 * Naira typed by a person to kobo, or an error to show. Refuses more than the
 * bill's balance here so the form says so at once; the API refuses it too.
 */
export function parseAmount(
  naira: string,
  balanceKobo: number,
): { kobo: number } | { error: string } {
  const cleaned = naira.replace(/[,\s₦]/g, "");
  if (!cleaned) return { error: "Enter the amount paid." };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { error: "Enter an amount like 25000 or 25000.50." };
  const kobo = Math.round(parseFloat(cleaned) * 100);
  if (kobo <= 0) return { error: "The amount must be more than ₦0." };
  if (kobo > balanceKobo) return { error: "That is more than this bill's balance." };
  return { kobo };
}

/** The balance as naira for the amount box, "25000" or "25000.50". */
export function nairaInput(kobo: number): string {
  return kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2);
}
