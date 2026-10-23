"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import {
  buildDebtorReminderMessage,
  buildNoRecipientWhatsAppUrl,
  FEE_RISK_LEVEL_LABELS,
  FEE_RISK_LEVELS,
  feeRiskSummary,
  type FeeRiskLevel,
  resolveSchoolBankDetails,
  type AcademicYearDto,
  type DebtorDto,
  type TermDto,
  reminderResultText,
  type SendRemindersResult,
} from "@school-kit/types";

import { FeeRiskBadge, FeeRiskReasons } from "@/components/finance/fee-risk";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { InlineAlert } from "@/components/shared/inline-alert";
import { PrintButton } from "@/components/shared/print-button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import type { CsvColumn } from "@/lib/csv-export";
import { financeErrorMessage, logFinanceError } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";
import { useAuth } from "@/lib/auth/use-auth";
import { listDebtors, sendReminders } from "@/lib/finance/finance-api";
import { getPaymentLink } from "@/lib/finance/invoices-api";
import { resolveShareablePaymentLink } from "@/lib/finance/shareable-payment-link";

const DEBTOR_EXPORT_COLUMNS: CsvColumn<DebtorDto>[] = [
  { header: "Student", accessor: (d) => d.studentName },
  { header: "Admission Number", accessor: (d) => d.admissionNumber },
  { header: "Class", accessor: (d) => d.classArm },
  { header: "Total Due", accessor: (d) => formatKobo(d.totalDue) },
  { header: "Paid", accessor: (d) => formatKobo(d.totalPaid) },
  { header: "Balance", accessor: (d) => formatKobo(d.balance) },
  { header: "Due Date", accessor: (d) => d.dueDate ?? "" },
  { header: "Status", accessor: (d) => STATUS_LABELS[d.status] },
  { header: "Payment Plan", accessor: (d) => (d.hasPaymentPlan ? "Yes" : "No") },
  { header: "Invoice", accessor: (d) => (d.supplementary ? "Supplementary" : "Term") },
  { header: "Risk", accessor: (d) => FEE_RISK_LEVEL_LABELS[d.risk.level] },
  { header: "Risk Reasons", accessor: (d) => feeRiskSummary(d.risk) },
];

type Status = "ISSUED" | "PARTIALLY_PAID" | "OVERDUE";

const STATUS_LABELS: Record<Status, string> = {
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  OVERDUE: "Overdue",
};

const STATUS_VARIANTS: Record<Status, BadgeProps["variant"]> = {
  ISSUED: "default",
  PARTIALLY_PAID: "warning",
  OVERDUE: "destructive",
};

const SELECT_CLASSES =
  "rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export default function DebtorsPage() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState("");
  // School name is quoted in the WhatsApp message so a parent knows who is
  // asking before they read the amount.
  const { school } = useAuth();
  // Same rule the finance dashboard and the settings preview apply.
  const shareBankDetails = resolveSchoolBankDetails(school);
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");

  const [debtors, setDebtors] = useState<DebtorDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState(false);
  const [reminderResult, setReminderResult] = useState<SendRemindersResult | null>(null);
  const [sharingInvoiceId, setSharingInvoiceId] = useState<string | null>(null);
  // Phase 9 / CP10.2 — show one risk level only ("" = every level).
  const [riskFilter, setRiskFilter] = useState<FeeRiskLevel | "">("");

  // Load academic years on mount
  useEffect(() => {
    listAcademicYears()
      .then((rows) => {
        setYears(rows);
        // Land on the current year/term instead of an empty "select a term"
        // screen. The finance DASHBOARD already did this; debtors did not, so
        // the two finance pages disagreed about whether you had to choose
        // before seeing anything.
        //
        // `isCurrent` is a MANUALLY set flag, never derived from dates, so a
        // school with nothing flagged still lands on the honest empty state —
        // this changes the default, not the guarantee. Deliberately does NOT
        // date-resolve a fallback term: isCurrent is the codebase-wide
        // definition of "current", and inventing a second one here would let
        // this page report a different term than the roster.
        const current = rows.find((y) => y.isCurrent);
        if (current) setYearId(current.id);
      })
      .catch((e) => {
        logFinanceError("listDebtorAcademicYears", e);
        setReferenceError(financeErrorMessage(e));
      });
  }, []);

  // Load terms when year changes
  useEffect(() => {
    setTermId("");
    setTerms([]);
    setDebtors([]);
    setSelected(new Set());
    setReferenceError(null);
    if (!yearId) return;
    listTerms(yearId)
      .then((rows) => {
        setTerms(rows);
        const current = rows.find((t) => t.isCurrent);
        if (current) setTermId(current.id);
      })
      .catch((e) => {
        logFinanceError("listDebtorTerms", e);
        setReferenceError(financeErrorMessage(e));
      });
  }, [yearId]);

  // Load debtors when term changes
  useEffect(() => {
    setDebtors([]);
    setSelected(new Set());
    setError(null);
    setReminderResult(null);
    if (!termId) return;
    setLoading(true);
    listDebtors(termId)
      .then(setDebtors)
      .catch((e) => {
        // Previously stringified the raw error — see lib/finance/error-copy.ts.
        logFinanceError("listDebtors", e);
        setError(financeErrorMessage(e));
      })
      .finally(() => setLoading(false));
  }, [termId]);

  function toggleSelect(studentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  const shown = riskFilter ? debtors.filter((d) => d.risk.level === riskFilter) : debtors;

  function toggleSelectAll() {
    if (selected.size === shown.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(shown.map((d) => d.studentId)));
    }
  }

  async function handleRemind() {
    if (!termId || selected.size === 0) return;
    setReminding(true);
    setReminderResult(null);
    try {
      const result = await sendReminders({ termId, studentIds: Array.from(selected) });
      setReminderResult(result);
      setSelected(new Set());
    } catch (e) {
      logFinanceError("sendReminders", e);
      setError(financeErrorMessage(e));
    } finally {
      setReminding(false);
    }
  }

  const totalBalance = shown.reduce((sum, d) => sum + d.balance, 0);
  // Named in the shared message, so a parent knows WHICH term is owed.
  const selectedTermName = terms.find((t) => t.id === termId)?.name ?? "this term";

  // Per-row WhatsApp share, with the invoice's Paystack link when it has a
  // usable one. Plan-first D5b: fetched HERE, on click, not per row — a debtor
  // list of 200 would otherwise be 200 requests for links most rows lack.
  //
  // THE WINDOW IS OPENED BEFORE THE FETCH, synchronously inside the click.
  // Browsers only allow window.open during a user gesture; after an `await`
  // that gesture has expired (Safari is strictest), so opening afterwards gets
  // silently popup-blocked and the button appears to do nothing. The blank
  // window is pointed at WhatsApp once the link resolves.
  //
  // It is opened WITHOUT "noopener" because a noopener window.open returns
  // null and could not be navigated afterwards; opener is severed by hand
  // before navigating, which gives the same protection.
  function shareOnWhatsApp(d: DebtorDto) {
    const win = window.open("", "_blank");
    setSharingInvoiceId(d.invoiceId);

    void resolveShareablePaymentLink(() => getPaymentLink(d.invoiceId), d.balance)
      .then((paymentLinkUrl) => {
        const href = buildNoRecipientWhatsAppUrl(
          buildDebtorReminderMessage({
            schoolName: school?.name ?? "Your school",
            studentName: d.studentName,
            balance: d.balance,
            termName: selectedTermName,
            dueDate: d.dueDate,
            // Each option appears only if the school supports it. The link
            // is included only when LIVE and for exactly this balance — see
            // shareablePaymentLinkUrl.
            paymentLinkUrl,
            portalUrl: school?.siteUrls?.parents ?? school?.portalUrl ?? null,
            bankDetails: shareBankDetails,
          }),
        );
        if (!win) {
          // Popup blocked even inside the gesture. Navigate this tab rather
          // than let the button do nothing.
          window.location.assign(href);
        } else if (!win.closed) {
          win.opener = null;
          win.location.href = href;
        }
        // win.closed: the staff member closed the blank tab while it was
        // preparing. That is a decision not to share; respect it.
      })
      .finally(() => setSharingInvoiceId(null));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Debtor list</h1>

      {/* Term selector */}
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="fin-debtors-year" className="mb-1 block text-sm font-medium text-foreground">Academic year</label>
          <select id="fin-debtors-year" className={SELECT_CLASSES} value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="">Select year…</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="fin-debtors-term" className="mb-1 block text-sm font-medium text-foreground">Term</label>
          <select id="fin-debtors-term"
            className={SELECT_CLASSES}
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
            disabled={!yearId}
          >
            <option value="">Select term…</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="fin-debtors-risk" className="mb-1 block text-sm font-medium text-foreground">Risk</label>
          <select id="fin-debtors-risk"
            className={SELECT_CLASSES}
            value={riskFilter}
            onChange={(e) => {
              setRiskFilter(e.target.value as FeeRiskLevel | "");
              setSelected(new Set());
            }}
          >
            <option value="">Every level</option>
            {FEE_RISK_LEVELS.map((l) => (
              <option key={l} value={l}>{FEE_RISK_LEVEL_LABELS[l]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Phase 9 / CP10.2 — what the level means, and what it is not. */}
      <p className="text-xs text-muted-foreground print:hidden">
        Risk is worked out from each child&apos;s own fees over the last three terms. It is for staff only, never
        shown to families, and never sends or blocks anything by itself.
      </p>

      {/* Error */}
      {error && (
        <InlineAlert title="Could not load debtors" action={{ label: "Retry", onClick: () => window.location.reload() }}>
          {error}
        </InlineAlert>
      )}

      {referenceError && !error && (
        <InlineAlert title="Could not load academic information" action={{ label: "Retry", onClick: () => window.location.reload() }}>
          {referenceError}
        </InlineAlert>
      )}

      {/* Reminder result */}
      {reminderResult && (
        // Each skip says why (reminderResultText): the old line blamed "no
        // guardian email" for every one, even when the guardian had an email
        // and only lacked the "primary" tick, or the school had email off.
        <div
          role="status"
          className={
            reminderResult.sent > 0
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              : "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
          }
        >
          {reminderResultText(reminderResult)}
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* No term selected */}
      {!termId && !loading && (
        <p className="text-sm text-muted-foreground">Select an academic year and term to view the debtor list.</p>
      )}

      {/* Empty state */}
      {termId && !loading && !error && debtors.length === 0 && (
        <p className="text-sm text-muted-foreground">No outstanding invoices for this term.</p>
      )}

      {/* Table */}
      {termId && !loading && !error && debtors.length > 0 && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">No outstanding invoices at this risk level.</p>
      )}

      {shown.length > 0 && (
        <>
          {/* Summary + actions bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{shown.length}</strong> outstanding invoice{shown.length !== 1 ? "s" : ""} —
              total balance <strong className="text-foreground">{formatKobo(totalBalance)}</strong>
            </p>
            <div className="flex flex-wrap gap-2 print:hidden">
              <ListExportMenu
                title="Debtors"
                csvFilename="debtors.csv"
                columns={DEBTOR_EXPORT_COLUMNS}
                getRows={() => shown}
                disabled={shown.length === 0}
              />
              <PrintButton />
              <Button onClick={handleRemind} disabled={reminding || selected.size === 0}>
                {reminding
                  ? "Sending…"
                  : selected.size === 0
                    ? "Send reminder (select rows)"
                    : `Send reminder to ${selected.size} family${selected.size !== 1 ? "ies" : "y"}`}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table stackOnMobile>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 print:hidden">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selected.size === shown.length}
                      onChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Total due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="print:hidden sr-only">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((d) => (
                  <TableRow
                    key={d.invoiceId}
                    className={selected.has(d.studentId) ? "cursor-pointer bg-primary/5" : "cursor-pointer"}
                    onClick={() => toggleSelect(d.studentId)}
                  >
                    <TableCell className="print:hidden" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selected.has(d.studentId)}
                        onChange={() => toggleSelect(d.studentId)}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-medium text-foreground">{d.studentName}</p>
                      <p className="text-xs text-muted-foreground">{d.admissionNumber}</p>
                      {/* Phase 9 / CP5.1: a family can owe on a term invoice
                          and a supplementary one, which shows as two rows. */}
                      {d.supplementary && <p className="text-xs text-foreground">Supplementary invoice</p>}
                    </TableCell>
                    <TableCell>{d.classArm}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKobo(d.totalDue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKobo(d.totalPaid)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">
                      {formatKobo(d.balance)}
                    </TableCell>
                    <TableCell>{d.dueDate ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[d.status]}>{STATUS_LABELS[d.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.hasPaymentPlan ? "✓ Plan" : "—"}
                    </TableCell>
                    <TableCell aria-label={`Risk for ${d.studentName}`}>
                      <FeeRiskBadge level={d.risk.level} />
                      <FeeRiskReasons risk={d.risk} />
                    </TableCell>
                    {/* Per-row WhatsApp share. Deliberately ONE family at a
                        time: wa.me opens with no recipient, so the sender picks
                        the conversation — it cannot be looped over the list.
                        Bulk reminders remain the "Send reminder" button above,
                        which goes out over email + SMS + push through
                        POST /finance/debtors/remind. stopPropagation because
                        the row itself toggles selection. */}
                    <TableCell className="print:hidden" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => shareOnWhatsApp(d)}
                        disabled={sharingInvoiceId === d.invoiceId}
                        // Distinctive per row, so it cannot collide by
                        // substring with another control's accessible name.
                        aria-label={`Share ${d.studentName}'s balance on WhatsApp`}
                        className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80 disabled:cursor-wait disabled:opacity-60"
                      >
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        {sharingInvoiceId === d.invoiceId ? "Preparing…" : "WhatsApp"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
