"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import type { InvoiceDto, InvoiceStatus, StudentDetailDto, TermDto } from "@school-kit/types";

import { listTerms } from "@/lib/academic-years/academic-years-api";
import { formatKobo } from "@/lib/finance/format";
import { cancelInvoice, getInvoice } from "@/lib/finance/invoices-api";
import { getStudent } from "@/lib/students/students-api";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const STATUS_COLOURS: Record<InvoiceStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-500",
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-400",
  REFUNDED: "bg-purple-100 text-purple-700",
};

const CANCELLABLE: Set<InvoiceStatus> = new Set(["ISSUED", "DRAFT", "OVERDUE"]);

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [student, setStudent] = useState<StudentDetailDto | null>(null);
  const [term, setTerm] = useState<TermDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getInvoice(id)
      .then((inv) => {
        setInvoice(inv);
        // Resolve student name and term name in parallel — failures are non-fatal
        // (display falls back to UUID if the sub-fetch fails).
        Promise.all([
          getStudent(inv.studentId).then(setStudent).catch(() => {}),
          listTerms(inv.academicYearId)
            .then((terms) => {
              const matched = terms.find((t) => t.id === inv.termId);
              if (matched) setTerm(matched);
            })
            .catch(() => {}),
        ]).catch(() => {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invoice."))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCancel() {
    if (!invoice) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const updated = await cancelInvoice(invoice.id);
      setInvoice(updated);
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-400">Loading…</div>;
  }

  if (error || !invoice) {
    return <div className="p-6 text-red-600">{error ?? "Invoice not found."}</div>;
  }

  const studentLabel = student
    ? `${student.firstName} ${student.lastName} (${student.admissionNumber})`
    : invoice.studentId;

  const termLabel = term ? term.name : invoice.termId;

  const grandTotal = invoice.items.reduce((s, item) => s + item.netAmount, 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Invoice</h1>
          <p className="text-sm font-mono text-gray-400 mt-0.5">{invoice.id}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLOURS[invoice.status]}`}>
          {STATUS_LABELS[invoice.status]}
        </span>
      </div>

      {/* Snapshot banner */}
      {invoice.issuedAt && (
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          Snapshot frozen as of {new Date(invoice.issuedAt).toLocaleString("en-NG")}.
          Fee catalog changes after this date do not affect this invoice.
        </div>
      )}

      {/* Meta */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-gray-500">Student</dt>
          <dd>{studentLabel}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Term</dt>
          <dd>{termLabel}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Due date</dt>
          <dd>{invoice.dueDate ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Issued by</dt>
          <dd className="font-mono">{invoice.issuedBy ?? "—"}</dd>
        </div>
      </dl>

      {/* Line items */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Category</th>
              <th className="text-left px-4 py-2 font-medium">Fee</th>
              <th className="text-right px-4 py-2 font-medium">Amount</th>
              <th className="text-right px-4 py-2 font-medium">Discount</th>
              <th className="text-right px-4 py-2 font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => {
              // Derive the capped display discount from the already-correct netAmount
              // rather than summing discountsApplied (which would show the uncapped raw sum).
              const displayDiscount = item.amount - item.netAmount;
              return (
                <tr key={item.feeItemId} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500">{item.categoryName}</td>
                  <td className="px-4 py-2">{item.feeName}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatKobo(item.amount)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">
                    {displayDiscount > 0 ? (
                      <span
                        title={item.discountsApplied
                          .map((d) => `${d.ruleName}: −${formatKobo(d.discountAmount)}`)
                          .join("\n")}
                      >
                        −{formatKobo(displayDiscount)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-medium">{formatKobo(item.netAmount)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold">
            <tr className="border-t">
              <td colSpan={2} className="px-4 py-2">Totals</td>
              <td className="px-4 py-2 text-right font-mono">{formatKobo(invoice.totalAmount)}</td>
              <td className="px-4 py-2 text-right font-mono text-red-600">
                {invoice.totalDiscount > 0 ? `−${formatKobo(invoice.totalDiscount)}` : "—"}
              </td>
              <td className="px-4 py-2 text-right font-mono">{formatKobo(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payment summary */}
      <dl className="flex gap-8 text-sm">
        <div>
          <dt className="text-gray-500">Total due</dt>
          <dd className="font-mono font-semibold text-lg">{formatKobo(invoice.totalDue)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Paid</dt>
          <dd className="font-mono font-semibold text-lg text-green-700">{formatKobo(invoice.totalPaid)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Balance</dt>
          <dd className="font-mono font-semibold text-lg">{formatKobo(invoice.totalDue - invoice.totalPaid)}</dd>
        </div>
      </dl>

      {/* Discount rule breakdown (if any discounts) */}
      {invoice.items.some((item) => item.discountsApplied.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            Discount breakdown
          </summary>
          <div className="mt-2 space-y-1 pl-4 border-l-2 border-gray-200">
            {invoice.items.flatMap((item) =>
              item.discountsApplied.map((d) => (
                <div key={`${item.feeItemId}-${d.ruleId}`} className="flex justify-between gap-4 text-gray-600">
                  <span>{d.ruleName} → {item.feeName}</span>
                  <span className="font-mono text-red-600">−{formatKobo(d.discountAmount)}</span>
                </div>
              )),
            )}
          </div>
        </details>
      )}

      {/* Cancel */}
      {CANCELLABLE.has(invoice.status) && (
        <div className="flex items-center gap-4">
          <button
            disabled={cancelling}
            onClick={handleCancel}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Cancel invoice"}
          </button>
          {cancelError && <p className="text-sm text-red-600">{cancelError}</p>}
        </div>
      )}

      <div className="pt-2">
        <Link href="/finance/invoices" className="text-sm text-blue-600 hover:underline">
          ← Back to invoices
        </Link>
      </div>
    </div>
  );
}
