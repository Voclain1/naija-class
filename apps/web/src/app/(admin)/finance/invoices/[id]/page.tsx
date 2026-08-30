"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Archive, Copy, ExternalLink, Link2, MessageCircle, RefreshCw } from "lucide-react";

import {
  invoiceStatusLabel,
  paymentStatusLabel,
  type CreatePaymentPlanInput,
  type InvoiceDto,
  type InvoiceStatus,
  type ManualPaymentMethod,
  type PaymentDto,
  type PaymentPlanDto,
  type PaymentLinkStateDto,
  type PaymentStatus,
  type StudentDetailDto,
  type TermDto,
} from "@school-kit/types";
import { buildNoRecipientWhatsAppUrl, buildPaymentLinkMessage } from "@school-kit/types";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTerms } from "@/lib/academic-years/academic-years-api";
import { formatKobo } from "@/lib/finance/format";
import { CancelInvoiceDialog } from "@/components/finance/cancel-invoice-dialog";
import { archivePaymentLink, createPaymentLink, getInvoice, getPaymentLink } from "@/lib/finance/invoices-api";
import {
  createPaymentPlan,
  deletePaymentPlan,
  getPaymentPlan,
} from "@/lib/finance/payment-plans-api";
import { createRefund, getPaymentReceiptUrl, initPaystackPayment, listPayments, recordManualPayment } from "@/lib/finance/payments-api";
import { getStudent } from "@/lib/students/students-api";

// Same mapping as /finance/invoices and /finance/debtors.
const STATUS_VARIANTS: Record<InvoiceStatus, BadgeProps["variant"]> = {
  DRAFT: "muted",
  ISSUED: "default",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "destructive",
  CANCELLED: "muted",
  REFUNDED: "outline",
};

const PAYMENT_STATUS_VARIANTS: Record<PaymentStatus, BadgeProps["variant"]> = {
  PENDING: "warning",
  SUCCESS: "success",
  FAILED: "destructive",
  REVERSED: "destructive",
};

const CANCELLABLE: Set<InvoiceStatus> = new Set(["ISSUED", "DRAFT", "OVERDUE"]);
const PAYABLE: Set<InvoiceStatus> = new Set(["ISSUED", "PARTIALLY_PAID", "OVERDUE"]);
const PLANNABLE: Set<InvoiceStatus> = new Set(["ISSUED", "PARTIALLY_PAID"]);

const METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  CASH: "Cash",
  POS: "POS",
  BANK_TRANSFER: "Bank transfer",
};

const INPUT_CLASSES =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const [paymentLink, setPaymentLink] = useState<PaymentLinkStateDto | undefined>(undefined);
  const [paymentLinkBusy, setPaymentLinkBusy] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cancel — the confirmation, in-flight guard and failure copy all live in
  // <CancelInvoiceDialog>, shared with the invoice list so the destructive
  // action behaves identically wherever it is offered.

  // Refund
  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

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
          getPaymentLink(inv.id)
            .then(setPaymentLink)
            .catch((e) => setPaymentLinkError(e instanceof Error ? e.message : "Failed to load payment link.")),
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

  async function handleCancelled(updated: InvoiceDto) {
    setInvoice(updated);
    await refreshPaymentLink();
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
      await refreshPaymentLink();
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

  function openRefundDialog(paymentId: string, amount: number) {
    setRefundPaymentId(paymentId);
    setRefundAmount(amount);
    setRefundReason("");
    setRefundError(null);
  }

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundPaymentId) return;
    setRefunding(true);
    setRefundError(null);
    try {
      await createRefund({ paymentId: refundPaymentId, amount: refundAmount, reason: refundReason });
      const [updatedInvoice, updatedPayments, updatedPlan] = await Promise.all([
        getInvoice(invoice!.id),
        listPayments({ invoiceId: invoice!.id }),
        getPaymentPlan(invoice!.id).catch(() => null),
      ]);
      setInvoice(updatedInvoice);
      setPayments(updatedPayments.data);
      setPlan(updatedPlan);
      await refreshPaymentLink();
      setRefundPaymentId(null);
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : "Refund failed.");
    } finally {
      setRefunding(false);
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

  async function refreshPaymentLink() {
    if (!invoice) return;
    setPaymentLinkBusy(true);
    setPaymentLinkError(null);
    try {
      setPaymentLink(await getPaymentLink(invoice.id));
    } catch (e) {
      setPaymentLinkError(e instanceof Error ? e.message : "Failed to refresh payment link.");
    } finally {
      setPaymentLinkBusy(false);
    }
  }

  async function handleCreatePaymentLink() {
    if (!invoice) return;
    setPaymentLinkBusy(true);
    setPaymentLinkError(null);
    try {
      setPaymentLink(await createPaymentLink(invoice.id));
    } catch (e) {
      setPaymentLinkError(e instanceof Error ? e.message : "Failed to create payment link.");
    } finally {
      setPaymentLinkBusy(false);
    }
  }

  async function handleArchivePaymentLink() {
    if (!invoice || !window.confirm("Archive this payment link? It will stop accepting payments and cannot be restored.")) return;
    setPaymentLinkBusy(true);
    setPaymentLinkError(null);
    try {
      setPaymentLink(await archivePaymentLink(invoice.id));
    } catch (e) {
      setPaymentLinkError(e instanceof Error ? e.message : "Failed to archive payment link.");
    } finally {
      setPaymentLinkBusy(false);
    }
  }

  async function handleCopyPaymentLink(url: string) {
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  }

  function handlePlanRowChange(index: number, field: "amount" | "dueDate", value: string) {
    setPlanRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  if (error || !invoice) {
    return <div className="p-6 text-destructive">{error ?? "Invoice not found."}</div>;
  }

  const studentLabel = student
    ? `${student.firstName} ${student.lastName} (${student.admissionNumber})`
    : invoice.studentId;

  const termLabel = term ? term.name : invoice.termId;

  const grandTotal = invoice.items.reduce((s, item) => s + item.netAmount, 0);

  // A plan can only be deleted before any payment is recorded.
  const hasSuccessPayment = payments.some((p) => p.status === "SUCCESS");

  return (
    <div className="max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Invoice</h1>
          <p className="mt-0.5 font-mono text-sm text-muted-foreground">{invoice.id}</p>
        </div>
        <Badge variant={STATUS_VARIANTS[invoice.status]} className="px-3 py-1 text-sm">
          {invoiceStatusLabel[invoice.status]}
        </Badge>
      </div>

      {/* Snapshot banner */}
      {invoice.issuedAt && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Snapshot frozen as of {new Date(invoice.issuedAt).toLocaleString("en-NG")}.
          Fee catalog changes after this date do not affect this invoice.
        </div>
      )}

      {/* Meta */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Student</dt>
          <dd>{studentLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Term</dt>
          <dd>{termLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Due date</dt>
          <dd>{invoice.dueDate ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Issued by</dt>
          <dd>
            {invoice.issuedByName ??
              (invoice.issuedBy ? "Former or unavailable staff member" : "—")}
          </dd>
        </div>
      </dl>

      {/* Line items */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map((item) => {
              const displayDiscount = item.amount - item.netAmount;
              return (
                <TableRow key={item.feeItemId}>
                  <TableCell className="text-muted-foreground">{item.categoryName}</TableCell>
                  <TableCell>{item.feeName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatKobo(item.amount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-destructive">
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
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums font-medium">
                    {formatKobo(item.netAmount)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <tfoot className="border-t bg-muted/40 font-semibold">
            <tr>
              <td colSpan={2} className="p-4">Totals</td>
              <td className="p-4 text-right font-mono tabular-nums">{formatKobo(invoice.totalAmount)}</td>
              <td className="p-4 text-right font-mono tabular-nums text-destructive">
                {invoice.totalDiscount > 0 ? `−${formatKobo(invoice.totalDiscount)}` : "—"}
              </td>
              <td className="p-4 text-right font-mono tabular-nums">{formatKobo(grandTotal)}</td>
            </tr>
          </tfoot>
        </Table>
      </div>

      {/* Payment summary */}
      <dl className="flex gap-8 text-sm">
        <div>
          <dt className="text-muted-foreground">Total due</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{formatKobo(invoice.totalDue)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatKobo(invoice.totalPaid)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Balance</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">
            {formatKobo(invoice.totalDue - invoice.totalPaid)}
          </dd>
        </div>
      </dl>

      {/* Discount rule breakdown (if any discounts) */}
      {invoice.items.some((item) => item.discountsApplied.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Discount breakdown
          </summary>
          <div className="mt-2 space-y-1 border-l-2 pl-4">
            {invoice.items.flatMap((item) =>
              item.discountsApplied.map((d) => (
                <div key={`${item.feeItemId}-${d.ruleId}`} className="flex justify-between gap-4 text-muted-foreground">
                  <span>{d.ruleName} → {item.feeName}</span>
                  <span className="font-mono tabular-nums text-destructive">−{formatKobo(d.discountAmount)}</span>
                </div>
              )),
            )}
          </div>
        </details>
      )}

      {/* Durable shareable payment link — never reads or pre-fills guardian contact data. */}
      {PAYABLE.has(invoice.status) && (
        <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Link2 className="h-4 w-4" /> Share payment link
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create one durable link for the current balance. It is automatically disabled when the invoice changes.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={refreshPaymentLink} disabled={paymentLinkBusy}>
              <RefreshCw className={`mr-2 h-4 w-4 ${paymentLinkBusy ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {paymentLink === undefined ? (
            <p className="text-sm text-muted-foreground">Loading payment-link status…</p>
          ) : paymentLink.state === "CONNECT_PAYSTACK" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Connect Paystack first to create a shareable payment link.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/finance/payments">Open Paystack settings</Link>
              </Button>
            </div>
          ) : paymentLink.state === "LIVE" ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  aria-label="Shareable payment link"
                  readOnly
                  value={paymentLink.url}
                  className={`${INPUT_CLASSES} font-mono text-xs`}
                />
                <Button variant="outline" onClick={() => handleCopyPaymentLink(paymentLink.url)}>
                  <Copy className="mr-2 h-4 w-4" /> {linkCopied ? "Copied" : "Copy"}
                </Button>
                <Button asChild>
                  <a
                    href={buildNoRecipientWhatsAppUrl(buildPaymentLinkMessage({
                      schoolName: paymentLink.schoolName,
                      studentLabel: paymentLink.studentLabel,
                      amount: paymentLink.amount,
                      url: paymentLink.url,
                    }))}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" /> Share on WhatsApp
                  </a>
                </Button>
                <Button variant="outline" onClick={handleArchivePaymentLink} disabled={paymentLinkBusy}>
                  <Archive className="mr-2 h-4 w-4" /> {paymentLinkBusy ? "Archiving…" : "Archive link"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                WhatsApp opens without a recipient. Choose the correct conversation before sending.
              </p>
            </div>
          ) : paymentLink.state === "CREATING" ? (
            <p className="text-sm text-muted-foreground">Payment link creation is in progress. Refresh shortly.</p>
          ) : paymentLink.state === "RETRYABLE_FAILURE" ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                The previous link could not be completed. No payment URL was exposed.
              </p>
              <Button size="sm" onClick={handleCreatePaymentLink} disabled={paymentLinkBusy}>
                Retry creating link
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={handleCreatePaymentLink} disabled={paymentLinkBusy}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {paymentLinkBusy ? "Creating…" : `Create link for ${formatKobo(invoice.totalDue - invoice.totalPaid)}`}
            </Button>
          )}
          {paymentLinkError && <p className="text-sm text-destructive">{paymentLinkError}</p>}
        </section>
      )}

      {/* Payment history */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-foreground">Payments</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className={p.status === "REVERSED" ? "opacity-50" : undefined}>
                    <TableCell className="text-muted-foreground">
                      {p.paidAt ? new Date(p.paidAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </TableCell>
                    <TableCell>{METHOD_LABELS[p.method as ManualPaymentMethod] ?? p.method}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.reference ?? "—"}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums font-medium ${p.status === "REVERSED" ? "text-muted-foreground line-through" : ""}`}
                    >
                      {formatKobo(p.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={PAYMENT_STATUS_VARIANTS[p.status]}>
                        {paymentStatusLabel[p.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-3">
                        {p.receiptUrl && (
                          <button
                            onClick={() => handleOpenReceipt(p.id)}
                            className="text-xs text-primary hover:underline"
                          >
                            Receipt
                          </button>
                        )}
                        {p.status === "SUCCESS" && (
                          <button
                            onClick={() => openRefundDialog(p.id, p.amount)}
                            className="text-xs text-destructive hover:underline"
                          >
                            Reverse
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Installment plan */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-foreground">Installment plan</h2>

        {/* Plan exists — show table */}
        {plan ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{plan.name}</p>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Due date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.installments.map((inst) => (
                    <TableRow key={inst.id}>
                      <TableCell className={inst.isOverdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                        {inst.dueDate}
                        {inst.isOverdue && (
                          <Badge variant="destructive" className="ml-2">Overdue</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatKobo(inst.amount)}</TableCell>
                      <TableCell className="text-center">
                        {inst.paid ? (
                          <Badge variant="success">✓ Paid</Badge>
                        ) : (
                          <Badge variant="muted">Pending</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!hasSuccessPayment && (
              <div className="flex items-center gap-3">
                <Button variant="destructive" size="sm" disabled={planDeleting} onClick={handleDeletePlan}>
                  {planDeleting ? "Deleting…" : "Delete plan"}
                </Button>
                {planDeleteError && <p className="text-sm text-destructive">{planDeleteError}</p>}
              </div>
            )}
          </div>
        ) : plan === null && PLANNABLE.has(invoice.status) ? (
          /* No plan yet, invoice is plannable — show setup form */
          <form onSubmit={handleCreatePlan} className="space-y-4 rounded-lg border p-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Plan name</label>
                <input
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Number of installments</label>
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
                  className={INPUT_CLASSES}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                size="sm"
                variant={planMode === "auto" ? "default" : "outline"}
                onClick={() => {
                  setPlanMode("auto");
                  setPlanRows(buildAutoSplit(planCount, invoice.totalDue));
                }}
              >
                Auto-split equally
              </Button>
              <Button
                type="button"
                size="sm"
                variant={planMode === "manual" ? "default" : "outline"}
                onClick={() => {
                  setPlanMode("manual");
                  if (planRows.length !== planCount) {
                    setPlanRows(Array.from({ length: planCount }, () => ({ amount: "", dueDate: "" })));
                  }
                }}
              >
                Set amounts manually
              </Button>
            </div>

            {/* Installment rows */}
            <div className="space-y-2">
              {planRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_1fr] items-center gap-3">
                  <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
                  <div>
                    <label className="mb-0.5 block text-xs text-muted-foreground">Amount (₦)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      readOnly={planMode === "auto"}
                      value={row.amount}
                      onChange={(e) => handlePlanRowChange(i, "amount", e.target.value)}
                      className={`${INPUT_CLASSES} ${planMode === "auto" ? "bg-muted text-muted-foreground" : ""}`}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs text-muted-foreground">Due date</label>
                    <input
                      type="date"
                      required
                      min={todayIso()}
                      value={row.dueDate}
                      onChange={(e) => handlePlanRowChange(i, "dueDate", e.target.value)}
                      className={INPUT_CLASSES}
                    />
                  </div>
                </div>
              ))}
            </div>

            {planError && <p className="text-sm text-destructive">{planError}</p>}
            <Button type="submit" disabled={planSubmitting}>
              {planSubmitting ? "Creating plan…" : "Set up payment plan"}
            </Button>
          </form>
        ) : plan === null ? (
          <p className="text-sm text-muted-foreground">
            No installment plan. Plans can only be created on issued or partially-paid invoices.
          </p>
        ) : (
          /* plan === undefined = still loading */
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>

      {/* Record payment form */}
      {PAYABLE.has(invoice.status) && (
        <div className="space-y-4 rounded-lg border p-4">
          <h2 className="text-base font-semibold text-foreground">Record payment</h2>
          <form onSubmit={handleRecordPayment} className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Amount (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder={`Max ${(invoice.totalDue - invoice.totalPaid) / 100}`}
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Method</label>
                <select
                  value={form.method}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as ManualPaymentMethod }))}
                  className={INPUT_CLASSES}
                >
                  <option value="CASH">Cash</option>
                  <option value="POS">POS</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Date paid</label>
                <input
                  type="datetime-local"
                  required
                  value={form.paidAt}
                  onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
                  className={INPUT_CLASSES}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Reference (optional)</label>
                <input
                  type="text"
                  maxLength={200}
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="Bank ref, POS txn ID…"
                  className={INPUT_CLASSES}
                />
              </div>
            </div>
            {recordError && <p className="text-sm text-destructive">{recordError}</p>}
            <Button type="submit" disabled={recording}>
              {recording ? "Recording…" : "Record payment"}
            </Button>
          </form>
        </div>
      )}

      {/* Pay via Paystack */}
      {PAYABLE.has(invoice.status) && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Pay via Paystack</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Redirects to Paystack checkout for the outstanding balance of{" "}
              <span className="font-mono font-medium tabular-nums">
                {formatKobo(invoice.totalDue - invoice.totalPaid)}
              </span>.
              Payment is confirmed automatically via webhook.
            </p>
          </div>
          {paystackError && <p className="text-sm text-destructive">{paystackError}</p>}
          <Button onClick={handlePayViaPaystack} disabled={initiatingPaystack}>
            {initiatingPaystack ? "Redirecting…" : "Pay outstanding balance"}
          </Button>
        </div>
      )}

      {/* Cancel */}
      {CANCELLABLE.has(invoice.status) && (
        <CancelInvoiceDialog onCancelled={handleCancelled}>
          {(open, busy) => (
            <div className="flex items-center gap-4">
              <Button variant="destructive" disabled={busy} onClick={() => open(invoice)}>
                {busy ? "Cancelling…" : "Cancel invoice…"}
              </Button>
              <p className="text-sm text-muted-foreground">
                You will be asked to confirm before anything changes.
              </p>
            </div>
          )}
        </CancelInvoiceDialog>
      )}

      <div className="pt-2">
        <Link href="/finance/invoices" className="text-sm text-primary hover:underline">
          ← Back to invoices
        </Link>
      </div>

      {/* Refund confirmation dialog */}
      <Dialog open={refundPaymentId !== null} onOpenChange={(next) => { if (!next) setRefundPaymentId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse payment</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will reverse the{" "}
            <span className="font-mono font-medium tabular-nums text-foreground">{formatKobo(refundAmount)}</span>{" "}
            payment and update the invoice balance.{" "}
            {invoice.status === "PAID" && (
              <span className="font-medium text-destructive">The invoice will become REFUNDED.</span>
            )}
          </p>
          <form onSubmit={handleRefund} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                required
                maxLength={500}
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. Payment recorded in error, parent requested refund…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-destructive"
              />
            </div>
            {refundError && <p className="text-sm text-destructive">{refundError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={refunding} onClick={() => setRefundPaymentId(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={refunding || !refundReason.trim()}>
                {refunding ? "Reversing…" : "Confirm reversal"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
