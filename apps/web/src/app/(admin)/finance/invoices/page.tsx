"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  invoiceStatusLabel,
  type AcademicYearDto,
  type ClassArmDto,
  type InvoiceDto,
  type InvoiceStatus,
  type PreviewLineDto,
  type TermDto,
} from "@school-kit/types";

import { CancelInvoiceDialog } from "@/components/finance/cancel-invoice-dialog";
import { GenerateInvoicesDialog } from "@/components/finance/generate-invoices-dialog";
import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { PrerequisiteNotice } from "@/components/setup/prerequisite-notice";
import { PrintButton } from "@/components/shared/print-button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { exportRowsAsCsv, type CsvColumn } from "@/lib/csv-export";
import { currentSuffix, unambiguousCurrent } from "@/lib/finance/current-context";
import { financeErrorMessage, logFinanceError } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";
import { canCancelInvoice } from "@/lib/finance/invoice-cancel";
import {
  invoiceReference,
  studentDisplayName,
  studentSecondaryLabel,
} from "@/lib/finance/invoice-identity";
import { resolveInvoiceListView } from "@/lib/finance/invoice-list-state";
import { listInvoices, previewInvoices } from "@/lib/finance/invoices-api";

// Export reuses GET /invoices with the same filters currently applied to the
// list tab, looping the page number (limit 200/page) until every page is
// fetched — same permission-guarded endpoint, no new backend route. Capped
// at 100 pages (20,000 invoices) as a runaway-loop guard.
//
// Column order is bursar-first: the human identity a school employee opens
// the file to find leads, and the machine ids stay at the END rather than
// being removed — they are still what a developer or a support request needs
// to pin an exact row, they just no longer occupy the first thing you read.
const INVOICE_EXPORT_COLUMNS: CsvColumn<InvoiceDto>[] = [
  { header: "Student", accessor: (i) => studentDisplayName(i) },
  { header: "Admission number", accessor: (i) => i.admissionNumber ?? "" },
  { header: "Invoice reference", accessor: (i) => invoiceReference(i.id) },
  { header: "Status", accessor: (i) => invoiceStatusLabel[i.status] },
  { header: "Total due", accessor: (i) => formatKobo(i.totalDue) },
  { header: "Paid", accessor: (i) => formatKobo(i.totalPaid) },
  { header: "Balance", accessor: (i) => formatKobo(i.totalDue - i.totalPaid) },
  { header: "Due date", accessor: (i) => i.dueDate ?? "" },
  { header: "Invoice ID", accessor: (i) => i.id },
  { header: "Student ID", accessor: (i) => i.studentId },
];

// Same status set as /finance/debtors and the invoice detail page — kept as
// three separate maps (not a shared constant) because each screen's status
// subset differs slightly and the type each keys off does too.
const STATUS_VARIANTS: Record<InvoiceStatus, BadgeProps["variant"]> = {
  DRAFT: "muted",
  ISSUED: "default",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "destructive",
  CANCELLED: "muted",
  REFUNDED: "outline",
};

const SELECT_CLASSES =
  "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

type Tab = "generate" | "list";

export default function InvoicesPage() {
  // Reference data
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  // Reference-data failure is tracked SEPARATELY from the invoice fetch: an
  // empty "Class" dropdown because /class-arms 500'd looks identical to a
  // school that has not set up any classes, and the two need different advice.
  const [referenceError, setReferenceError] = useState<string | null>(null);

  // Picker state (shared between generate and list tabs)
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");
  const [armId, setArmId] = useState("");

  // Generate tab
  const [dueDate, setDueDate] = useState("");
  const [preview, setPreview] = useState<PreviewLineDto[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ created: number; skipped: number } | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // List tab
  const [tab, setTab] = useState<Tab>("generate");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Bumped by the retry button to re-run the list effect with identical filters.
  const [listReloadKey, setListReloadKey] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  // Load reference data on mount
  const loadReferenceData = useCallback(() => {
    setReferenceError(null);
    Promise.all([listAcademicYears(), listClassArms()])
      .then(([loadedYears, loadedArms]) => {
        setYears(loadedYears);
        setArms(loadedArms);
        // Academic YEAR only. The year never reaches the generation request
        // (which takes termId + classArmId) — it only narrows which terms are
        // listed — so landing on the current one saves a click and cannot
        // cause anything to be billed. The TERM is deliberately NOT
        // defaulted: see lib/finance/current-context.ts for why, and for the
        // existing repo decision it follows.
        const current = unambiguousCurrent(loadedYears);
        if (current) setYearId((existing) => existing || current.id);
      })
      .catch((e) => {
        logFinanceError("reference data", e);
        setReferenceError(financeErrorMessage(e));
      });
  }, []);

  useEffect(loadReferenceData, [loadReferenceData]);

  // Load terms when academic year changes
  useEffect(() => {
    setTermId("");
    setTerms([]);
    if (!yearId) return;
    listTerms(yearId)
      .then(setTerms)
      .catch((e) => {
        logFinanceError("listTerms", e);
        setTerms([]);
        setReferenceError(financeErrorMessage(e));
      });
  }, [yearId]);

  // Reset downstream state when term/arm changes
  useEffect(() => {
    setPreview(null);
    setGenerateResult(null);
    setGenerateError(null);
  }, [termId, armId]);

  // Load invoices list when tab, term, arm, status, or page changes
  useEffect(() => {
    if (tab !== "list") return;
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    listInvoices({
      termId: termId || undefined,
      classArmId: armId || undefined,
      status: statusFilter || undefined,
      page,
      limit: 50,
    })
      .then((r) => {
        if (cancelled) return;
        setInvoices(r.data);
        setTotal(r.total);
      })
      .catch((e) => {
        if (cancelled) return;
        logFinanceError("listInvoices", e);
        // Rows are cleared so no STALE data is presented as current, but the
        // error is recorded so the table renders a failure — never the bare
        // emptiness claim this used to fall through to (F-05).
        setInvoices([]);
        setTotal(0);
        setListError(financeErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, termId, armId, statusFilter, page, listReloadKey]);

  const pickerReady = !!termId && !!armId;

  const listView = resolveInvoiceListView({
    loading: listLoading,
    error: listError,
    rowCount: invoices.length,
    statusFilter,
    statusLabel: statusFilter ? invoiceStatusLabel[statusFilter] : "",
  });

  async function handleExport() {
    setExportError(null);
    try {
      const rows: InvoiceDto[] = [];
      let exportPage = 1;
      let seenTotal = Infinity;
      while (rows.length < seenTotal && exportPage <= 100) {
        const res = await listInvoices({
          termId: termId || undefined,
          classArmId: armId || undefined,
          status: statusFilter || undefined,
          page: exportPage,
          limit: 200,
        });
        rows.push(...res.data);
        seenTotal = res.total;
        exportPage += 1;
      }
      exportRowsAsCsv("invoices.csv", rows, INVOICE_EXPORT_COLUMNS);
    } catch (e) {
      // A half-fetched export must not be written to a file the bursar would
      // then reconcile against — fail loudly and download nothing.
      logFinanceError("invoice export", e);
      setExportError(financeErrorMessage(e));
    }
  }

  async function handlePreview() {
    if (!pickerReady) return;
    setPreviewLoading(true);
    setPreview(null);
    setGenerateResult(null);
    setGenerateError(null);
    try {
      const rows = await previewInvoices({ termId, classArmId: armId });
      setPreview(rows);
    } catch (e) {
      logFinanceError("previewInvoices", e);
      setGenerateError(financeErrorMessage(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  // F-34: the page no longer holds a path to the mutation at all. Generation
  // is reachable only through <GenerateInvoicesDialog>, which owns the review
  // gate; this just records what the confirmed run reported.
  function handleGenerated(result: { created: number; skipped: number }) {
    setGenerateResult(result);
    setGenerateError(null);
    setPreview(null);
    // The list tab is now stale — a confirmed run has changed what it shows.
    setListReloadKey((k) => k + 1);
  }

  const previewTotalDue = preview?.reduce((s, r) => s + r.totalDue, 0) ?? 0;

  const selectedTerm = terms.find((t) => t.id === termId);
  const selectedArm = arms.find((a) => a.id === armId);

  return (
    <div className="max-w-6xl space-y-6 p-6">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Invoices</h1>

      {/* The two ways a fee run here silently produces nothing. With no fees
          priced, GET /invoices/arm/preview returns an empty list; with no
          students enrolled, there is nobody to bill. Both cases currently
          look identical to a successful run of zero invoices, which is the
          worst possible feedback for a bursar who has just pressed Generate.
          Neither notice disables the form — a school mid-setup can still
          preview, and both vanish as soon as the step is done. */}
      <PrerequisiteNotice
        stepKey="fee-catalog"
        because="No fees are priced yet, so generating invoices here would bill nobody."
      />
      <PrerequisiteNotice
        stepKey="enrollments"
        because="No students are in a class this term, so there is nobody to invoice."
      />

      {referenceError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive print:hidden"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-2">
            <p>Could not load the school&rsquo;s years, terms and classes. {referenceError}</p>
            <Button variant="outline" size="sm" onClick={loadReferenceData}>
              <RotateCcw className="mr-1 h-4 w-4" aria-hidden />
              Try again
            </Button>
          </div>
        </div>
      )}

      {/* Term + arm picker */}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label htmlFor="invoice-year" className="mb-1 block text-sm font-medium text-foreground">
            Academic year
          </label>
          <select
            id="invoice-year"
            className={SELECT_CLASSES}
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
          >
            <option value="">Choose an academic year</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
                {currentSuffix(y.isCurrent)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="invoice-term" className="mb-1 block text-sm font-medium text-foreground">
            Term
          </label>
          <select
            id="invoice-term"
            className={SELECT_CLASSES}
            disabled={!yearId}
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
          >
            <option value="">{yearId ? "Choose a term" : "Choose an academic year first"}</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {currentSuffix(t.isCurrent)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="invoice-arm" className="mb-1 block text-sm font-medium text-foreground">
            Class
          </label>
          <select
            id="invoice-arm"
            className={SELECT_CLASSES}
            value={armId}
            onChange={(e) => setArmId(e.target.value)}
          >
            <option value="">Choose a class</option>
            {arms.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="print:hidden">
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="list">Invoice list</TabsTrigger>
        </TabsList>

        {/* ── Generate tab ── */}
        <TabsContent value="generate" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="invoice-due-date" className="mb-1 block text-sm font-medium text-foreground">
                Due date (optional)
              </label>
              <input
                id="invoice-due-date"
                type="date"
                className={SELECT_CLASSES}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <Button variant="outline" disabled={!pickerReady || previewLoading} onClick={handlePreview}>
              {previewLoading ? "Loading…" : "Preview"}
            </Button>

            {/* F-34: the trigger receives `open`, never the mutation. The
                review dialog restates arm, term, count and naira total before
                anything is billed — which also defuses the shared-picker
                hazard, since the arm/term about to be billed is named at the
                moment of confirming rather than assumed from a control the
                bursar may have changed on the List tab. */}
            <GenerateInvoicesDialog onGenerated={handleGenerated}>
              {(open, busy) => (
                <Button
                  disabled={!pickerReady || busy || !selectedTerm || !selectedArm}
                  onClick={() =>
                    selectedTerm &&
                    selectedArm &&
                    open({
                      termId,
                      classArmId: armId,
                      armName: selectedArm.name,
                      termName: selectedTerm.name,
                      dueDate: dueDate || undefined,
                    })
                  }
                >
                  {busy ? "Creating…" : "Generate invoices"}
                </Button>
              )}
            </GenerateInvoicesDialog>
          </div>

          {pickerReady && selectedTerm && selectedArm && (
            <p className="text-sm text-muted-foreground">
              Invoices will be created for every enrolled student in{" "}
              <strong className="text-foreground">{selectedArm.name}</strong> for{" "}
              <strong className="text-foreground">{selectedTerm.name}</strong>. Students who
              already have an invoice for this term are skipped.
            </p>
          )}

          {generateError && (
            <p role="alert" className="text-sm text-destructive">{generateError}</p>
          )}

          {generateResult && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              Done — {generateResult.created} invoice{generateResult.created === 1 ? "" : "s"}{" "}
              created, {generateResult.skipped} skipped (already issued).
            </div>
          )}

          {preview && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Advisory preview — {preview.length} student{preview.length === 1 ? "" : "s"}. Clicking
                &ldquo;Generate invoices&rdquo; recomputes from current fee catalog.
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead className="text-right">Fee items</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row) => (
                      <TableRow key={row.studentId}>
                        <TableCell className="max-w-[18rem]">
                          <span className="block break-words font-medium text-foreground">
                            {studentDisplayName(row)}
                          </span>
                          {studentSecondaryLabel(row) && (
                            <span className="block text-xs text-muted-foreground">
                              {studentSecondaryLabel(row)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{row.feeItemCount}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatKobo(row.totalAmount)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-destructive">
                          {row.totalDiscount > 0 ? `−${formatKobo(row.totalDiscount)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums font-medium">
                          {formatKobo(row.totalDue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot className="border-t bg-muted/40 font-medium">
                    <tr>
                      <td colSpan={4} className="p-4 text-right">Total due</td>
                      <td className="p-4 text-right font-mono tabular-nums">{formatKobo(previewTotalDue)}</td>
                    </tr>
                  </tfoot>
                </Table>
              </div>
            </div>
          )}

          {!preview && !previewLoading && !generateResult && pickerReady && (
            <p className="text-sm text-muted-foreground">
              Click &ldquo;Preview&rdquo; to see projected totals before generating.
            </p>
          )}

          {!pickerReady && (
            <p className="text-sm text-muted-foreground">
              Choose an academic year, a term and a class above to continue.
            </p>
          )}
        </TabsContent>

        {/* ── List tab ── */}
        <TabsContent value="list" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
            <div>
              <label htmlFor="invoice-status" className="mb-1 block text-sm font-medium text-foreground">
                Status
              </label>
              <select
                id="invoice-status"
                className={SELECT_CLASSES}
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as InvoiceStatus | ""); setPage(1); }}
              >
                <option value="">All statuses</option>
                {(Object.keys(invoiceStatusLabel) as InvoiceStatus[]).map((s) => (
                  <option key={s} value={s}>{invoiceStatusLabel[s]}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <ExportCsvButton onExport={handleExport} disabled={invoices.length === 0} />
              <PrintButton disabled={invoices.length === 0} />
            </div>
          </div>

          {exportError && (
            <p role="alert" className="text-sm text-destructive print:hidden">
              Export failed — nothing was downloaded. {exportError}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="w-40 print:hidden" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listView.kind === "loading" && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      Loading invoices…
                    </TableCell>
                  </TableRow>
                )}

                {listView.kind === "error" && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8">
                      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
                        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
                        <div>
                          <p className="font-medium text-foreground">Could not load invoices</p>
                          <p className="text-sm text-muted-foreground">{listView.message}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            This is not the same as having no invoices — nothing about this
                            term&rsquo;s billing has been confirmed.
                          </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setListReloadKey((k) => k + 1)}>
                          <RotateCcw className="mr-1 h-4 w-4" aria-hidden />
                          Try again
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {listView.kind === "empty" && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center">
                      <p className="font-medium text-foreground">No invoices yet</p>
                      <p className="text-sm text-muted-foreground">
                        Nothing has been billed for this selection. Use the{" "}
                        <strong>Generate</strong> tab to create invoices for a class.
                      </p>
                    </TableCell>
                  </TableRow>
                )}

                {listView.kind === "filtered-empty" && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center">
                      <p className="font-medium text-foreground">
                        No &ldquo;{listView.statusLabel}&rdquo; invoices here
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Invoices may still exist under a different status.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => { setStatusFilter(""); setPage(1); }}
                      >
                        Show all statuses
                      </Button>
                    </TableCell>
                  </TableRow>
                )}

                {listView.kind === "rows" &&
                  invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      {/* Human identity leads the row — this column used to be a
                          truncated UUID (F-04). max-w + break-words so a long
                          Nigerian name wraps inside its cell instead of pushing
                          the amount columns off screen. */}
                      <TableCell className="max-w-[16rem]">
                        <Link
                          href={`/finance/invoices/${inv.id}`}
                          className="block break-words font-medium text-foreground underline-offset-2 hover:underline"
                        >
                          {studentDisplayName(inv)}
                        </Link>
                        {studentSecondaryLabel(inv) && (
                          <span className="block text-xs text-muted-foreground">
                            {studentSecondaryLabel(inv)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {invoiceReference(inv.id)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[inv.status]}>{invoiceStatusLabel[inv.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatKobo(inv.totalDue)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                        {formatKobo(inv.totalPaid)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{inv.dueDate ?? "—"}</TableCell>
                      <TableCell className="text-right print:hidden">
                        <div className="flex justify-end gap-3">
                          {/* Client navigation (F-32): a raw <a href> here forced a
                              full document reload, discarding the loaded filters. */}
                          <Link
                            href={`/finance/invoices/${inv.id}`}
                            className="text-xs text-primary underline hover:text-primary/80"
                          >
                            View
                          </Link>
                          {canCancelInvoice(inv.status) && (
                            <CancelInvoiceDialog
                              onCancelled={(updated) =>
                                setInvoices((prev) =>
                                  prev.map((row) => (row.id === updated.id ? updated : row)),
                                )
                              }
                            >
                              {(open, busy) => (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => open(inv)}
                                  className="text-xs text-destructive underline hover:text-destructive/80 disabled:opacity-50"
                                >
                                  Cancel invoice…
                                </button>
                              )}
                            </CancelInvoiceDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {listView.kind === "rows" && total > 50 && (
            <div className="flex items-center gap-3 text-sm print:hidden">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Prev
              </Button>
              <span className="text-muted-foreground">
                Page {page} of {Math.ceil(total / 50)} ({total} total)
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= Math.ceil(total / 50)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
