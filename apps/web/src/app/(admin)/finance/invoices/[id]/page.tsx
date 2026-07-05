"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import type {
  CreatePaymentPlanInput,
  InvoiceDto,
  InvoiceStatus,
  ManualPaymentMethod,
  PaymentDto,
  PaymentPlanDto,
  StudentDetailDto,
  TermDto,
} from "@school-kit/types";

import { listTerms } from "@/lib/academic-years/academic-years-api";
import { formatKobo } from "@/lib/finance/format";
import { cancelInvoice, getInvoice } from "@/lib/finance/invoices-api";
import {
  createPaymentPlan,
  deletePaymentPlan,
  getPaymentPlan,
} from "@/lib/finance/payment-plans-api";
import { getPaymentReceiptUrl, initPaystackPayment, listPayments, recordManualPayment } from "@/lib/finance/payments-api";
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
const PAYABLE: Set<InvoiceStatus> = new Set(["ISSUED", "PARTIALLY_PAID", "OVERDUE"]);
const PLANNABLE: Set<InvoiceStatus> = new Set(["ISSUED", "PARTIALLY_PAID"]);

const METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  CASH: "Cash",
  POS: "POS",
  BANK_TRANSFER: "Bank transfer",
};

function nowLocalDatetimeValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Installment plan form state ──────────────────────────────────────────────

type InstallmentFormRow = { amount: string; dueDate: string };

function buildAutoSplit(count: number, totalDue: number): InstallmentFormRow[] {
  if (count <= 0 || totalDue <= 0) return [];
  const base = Math.floor(totalDue / count);
  const remainder = totalDue - base * count;
  return Array.from({ length: count }, (_, i) => {
    const kobo = i === 0 ? base + remainder : base;
    const date = new Date();
    date.setMonth(date.getMonth() + i + 1);
    return {
      amount: (kobo / 100).toFixed(2),
      dueDate: date.toISOString().slice(0, 10),
    };
  });
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [student, setStudent] = useState<StudentDetailDto | null>(null);
  const [term, setTerm] = useState<TermDto | null>(null);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [plan, setPlan] = useState<PaymentPlanDto | null | undefined>(undefined); // undefined = loading
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cancel
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Paystack init
  const [initiatingPaystack, setInitiatingPaystack] = useState(false);
  const [paystackError, setPaystackError] = useState<string | null>(null);

  // Record payment form
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "",
    method: "CASH" as ManualPaymentMethod,
    paidAt: nowLocalDatetimeValue(),
    reference: "",
  });

  // Installment plan form
  const [planCount, setPlanCount] = useState(3);
  const [planName, setPlanName] = useState("Payment plan");
  const [planMode, setPlanMode] = useState<"auto" | "manual">("auto");
  const [planRows, setPlanRows] = useState<InstallmentFormRow[]>([]);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planDeleting, setPlanDeleting] = useState(false);
  const [planDeleteError, setPlanDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getInvoice(id)
      .then((inv) => {
        setInvoice(inv);
        Promise.all([
          getStudent(inv.studentId).then(setStudent).catch(() => {}),
          listTerms(inv.academicYearId)
            .then((terms) => {
              const matched = terms.find((t) => t.id === inv.termId);
              if (matched) setTerm(matched);
            })
            .catch(() => {}),
          listPayments({ invoiceId: inv.id })
            .then((r) => setPayments(r.data))
            .catch(() => {}),
          getPaymentPlan(inv.id)
            .then(setPlan)
            .catch(() => setPlan(null)),
        ]).catch(() => {});
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load invoice."))
      .finally(() => setLoading(false));
  }, [id]);

  // When invoice loads and plan mode is auto, seed the plan rows.
  useEffect(() => {
    if (invoice && planMode === "auto") {
      setPlanRows(buildAutoSplit(planCount, invoice.totalDue));
    }
  }, [invoice, planCount, planMode]);

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

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    const amountKobo = Math.round(parseFloat(form.amount) * 100);
    if (!amountKobo || amountKobo <= 0) return;
    setRecording(true);
    setRecordError(null);
    try {
      await recordManualPayment({
        invoiceId: invoice.id,
        amount: amountKobo,
        method: form.method,
        paidAt: new Date(form.paidAt).toISOString(),
        reference: form.reference || undefined,
      });
      const [updatedInvoice, updatedPayments, updatedPlan] = await Promise.all([
        getInvoice(invoice.id),
        listPayments({ invoiceId: invoice.id }),
        getPaymentPlan(invoice.id).catch(() => null),
      ]);
      setInvoice(updatedInvoice);
      setPayments(updatedPayments.data);
      setPlan(updatedPlan);
      setForm({ amount: "", method: "CASH", paidAt: nowLocalDatetimeValue(), reference: "" });
    } catch (e) {
      setRecordError(e instanceof Error ? e.message : "Failed to record payment.");
    } finally {
      setRecording(false);
    }
  }

  async function handlePayViaPaystack() {
    if (!invoice) return;
    const balance = invoice.totalDue - invoice.totalPaid;
    if (balance <= 0) return;
    setInitiatingPaystack(true);
    setPaystackError(null);
    try {
      const { authorizationUrl } = await initPaystackPayment({
        invoiceId: invoice.id,
        amount: balance,
      });
      window.location.href = authorizationUrl;
    } catch (e) {
      setPaystackError(e instanceof Error ? e.message : "Failed to initiate payment.");
      setInitiatingPaystack(false);
    }
  }

  async function handleOpenReceipt(paymentId: string) {
    try {
      const { url } = await getPaymentReceiptUrl(paymentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Non-fatal — receipt may not be ready yet
    }
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setPlanSubmitting(true);
    setPlanError(null);
    try {
      const installments = planRows.map((row) => ({
        amount: Math.round(parseFloat(row.amount) * 100),
        dueDate: row.dueDate,
      }));
      const input: CreatePaymentPlanInput = {
        invoiceId: invoice.id,
        name: planName,
        installments,
      };
      const created = await createPaymentPlan(input);
      setPlan(created);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "Failed to create plan.");
    } finally {
      setPlanSubmitting(false);
    }
  }

  async function handleDeletePlan() {
    if (!plan) return;
    setPlanDeleting(true);
    setPlanDeleteError(null);
    try {
      await deletePaymentPlan(plan.id);
      setPlan(null);
    } catch (e) {
      setPlanDeleteError(e instanceof Error ? e.message : "Failed to delete plan.");
    } finally {
      setPlanDeleting(false);
    }
  }

  function handlePlanRowChange(index: number, field: "amount" | "dueDate", value: string) {
    setPlanRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
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

  // A plan can only be deleted before any payment is recorded.
  const hasSuccessPayment = payments.some((p) => p.status === "SUCCESS");

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
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

      {/* Payment history */}
      <div>
        <h2 className="text-base font-semibold mb-3">Payments</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">No payments recorded.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Method</th>
                  <th className="text-left px-4 py-2 font-medium">Reference</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-500">
                      {p.paidAt ? new Date(p.paidAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="px-4 py-2">{METHOD_LABELS[p.method as ManualPaymentMethod] ?? p.method}</td>
                    <td className="px-4 py-2 text-gray-500 font-mono text-xs">{p.reference ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono font-medium">{formatKobo(p.amount)}</td>
                    <td className="px-4 py-2 text-right">
                      {p.receiptUrl && (
                        <button
                          onClick={() => handleOpenReceipt(p.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Receipt
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Installment plan */}
      <div>
        <h2 className="text-base font-semibold mb-3">Installment plan</h2>

        {/* Plan exists — show table */}
        {plan ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{plan.name}</p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Due date</th>
                    <th className="text-right px-4 py-2 font-medium">Amount</th>
                    <th className="text-center px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.installments.map((inst) => (
                    <tr key={inst.id} className="border-t hover:bg-gray-50">
                      <td className={`px-4 py-2 ${inst.isOverdue ? "text-red-600 font-medium" : "text-gray-700"}`}>
                        {inst.dueDate}
                        {inst.isOverdue && (
                          <span className="ml-2 text-xs bg-red-100 text-red-600 rounded px-1.5 py-0.5">Overdue</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{formatKobo(inst.amount)}</td>
                      <td className="px-4 py-2 text-center">
                        {inst.paid ? (
                          <span className="text-green-600 font-medium">✓ Paid</span>
                        ) : (
                          <span className="text-gray-400">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasSuccessPayment && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDeletePlan}
                  disabled={planDeleting}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {planDeleting ? "Deleting…" : "Delete plan"}
                </button>
                {planDeleteError && <p className="text-sm text-red-600">{planDeleteError}</p>}
              </div>
            )}
          </div>
        ) : plan === null && PLANNABLE.has(invoice.status) ? (
          /* No plan yet, invoice is plannable — show setup form */
          <form onSubmit={handleCreatePlan} className="border rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Plan name</label>
                <input
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Number of installments</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  required
                  value={planCount}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (n > 0) {
                      setPlanCount(n);
                      if (planMode === "auto") {
                        setPlanRows(buildAutoSplit(n, invoice.totalDue));
                      } else {
                        setPlanRows((rows) => {
                          if (n > rows.length) {
                            return [
                              ...rows,
                              ...Array.from({ length: n - rows.length }, () => ({
                                amount: "",
                                dueDate: "",
                              })),
                            ];
                          }
                          return rows.slice(0, n);
                        });
                      }
                    }
                  }}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPlanMode("auto");
                  setPlanRows(buildAutoSplit(planCount, invoice.totalDue));
                }}
                className={`px-3 py-1.5 text-sm rounded border ${planMode === "auto" ? "bg-blue-50 border-blue-400 text-blue-700" : "border-gray-300 text-gray-600"}`}
              >
                Auto-split equally
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlanMode("manual");
                  if (planRows.length !== planCount) {
                    setPlanRows(Array.from({ length: planCount }, () => ({ amount: "", dueDate: "" })));
                  }
                }}
                className={`px-3 py-1.5 text-sm rounded border ${planMode === "manual" ? "bg-blue-50 border-blue-400 text-blue-700" : "border-gray-300 text-gray-600"}`}
              >
                Set amounts manually
              </button>
            </div>

            {/* Installment rows */}
            <div className="space-y-2">
              {planRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_1fr] gap-3 items-center">
                  <span className="text-sm text-gray-500 w-6">{i + 1}.</span>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Amount (₦)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      readOnly={planMode === "auto"}
                      value={row.amount}
                      onChange={(e) => handlePlanRowChange(i, "amount", e.target.value)}
                      className={`w-full border rounded px-2 py-1 text-sm ${planMode === "auto" ? "bg-gray-50 text-gray-500" : ""}`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Due date</label>
                    <input
                      type="date"
                      required
                      min={todayIso()}
                      value={row.dueDate}
                      onChange={(e) => handlePlanRowChange(i, "dueDate", e.target.value)}
                      className="w-full border rounded px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>

            {planError && <p className="text-sm text-red-600">{planError}</p>}
            <button
              type="submit"
              disabled={planSubmitting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {planSubmitting ? "Creating plan…" : "Set up payment plan"}
            </button>
          </form>
        ) : plan === null ? (
          <p className="text-sm text-gray-400">No installment plan. Plans can only be created on issued or partially-paid invoices.</p>
        ) : (
          /* plan === undefined = still loading */
          <p className="text-sm text-gray-400">Loading…</p>
        )}
      </div>

      {/* Record payment form */}
      {PAYABLE.has(invoice.status) && (
        <div className="border rounded-lg p-4 space-y-4">
          <h2 className="text-base font-semibold">Record payment</h2>
          <form onSubmit={handleRecordPayment} className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Amount (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder={`Max ${(invoice.totalDue - invoice.totalPaid) / 100}`}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Method</label>
                <select
                  value={form.method}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as ManualPaymentMethod }))}
                  className="w-full border rounded px-3 py-1.5 text-sm bg-white"
                >
                  <option value="CASH">Cash</option>
                  <option value="POS">POS</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Date paid</label>
                <input
                  type="datetime-local"
                  required
                  value={form.paidAt}
                  onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
                  className="w-full border rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Reference (optional)</label>
                <input
                  type="text"
                  maxLength={200}
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Bank ref, POS txn ID…"
                  className="w-full border rounded px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            {recordError && <p className="text-sm text-red-600">{recordError}</p>}
            <button
              type="submit"
              disabled={recording}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
            >
              {recording ? "Recording…" : "Record payment"}
            </button>
          </form>
        </div>
      )}

      {/* Pay via Paystack */}
      {PAYABLE.has(invoice.status) && (
        <div className="border rounded-lg p-4 space-y-3">
          <div>
            <h2 className="text-base font-semibold">Pay via Paystack</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Redirects to Paystack checkout for the outstanding balance of{" "}
              <span className="font-mono font-medium">
                {formatKobo(invoice.totalDue - invoice.totalPaid)}
              </span>.
              Payment is confirmed automatically via webhook.
            </p>
          </div>
          {paystackError && <p className="text-sm text-red-600">{paystackError}</p>}
          <button
            onClick={handlePayViaPaystack}
            disabled={initiatingPaystack}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {initiatingPaystack ? "Redirecting…" : "Pay outstanding balance"}
          </button>
        </div>
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
