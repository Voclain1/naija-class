"use client";

import { useEffect, useState } from "react";

import type {
  AcademicYearDto,
  ClassArmDto,
  InvoiceDto,
  InvoiceStatus,
  PreviewLineDto,
  TermDto,
} from "@school-kit/types";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { formatKobo } from "@/lib/finance/format";
import {
  cancelInvoice,
  generateInvoices,
  listInvoices,
  previewInvoices,
} from "@/lib/finance/invoices-api";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

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

  // Picker state (shared between generate and list tabs)
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");
  const [armId, setArmId] = useState("");

  // Generate tab
  const [dueDate, setDueDate] = useState("");
  const [preview, setPreview] = useState<PreviewLineDto[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ created: number; skipped: number } | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // List tab
  const [tab, setTab] = useState<Tab>("generate");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  // Load reference data on mount
  useEffect(() => {
    listAcademicYears()
      .then(setYears)
      .catch((e) => { console.error("[InvoicesPage] listAcademicYears:", e); });
    listClassArms()
      .then(setArms)
      .catch((e) => { console.error("[InvoicesPage] listClassArms:", e); });
  }, []);

  // Load terms when academic year changes
  useEffect(() => {
    setTermId("");
    setTerms([]);
    if (!yearId) return;
    listTerms(yearId)
      .then(setTerms)
      .catch(() => setTerms([]));
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
    setListLoading(true);
    listInvoices({
      termId: termId || undefined,
      classArmId: armId || undefined,
      status: statusFilter || undefined,
      page,
      limit: 50,
    })
      .then((r) => { setInvoices(r.data); setTotal(r.total); })
      .catch((e) => { console.error("[InvoicesPage] listInvoices:", e); setInvoices([]); })
      .finally(() => setListLoading(false));
  }, [tab, termId, armId, statusFilter, page]);

  const pickerReady = !!termId && !!armId;

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
      setGenerateError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleGenerate() {
    if (!pickerReady) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const result = await generateInvoices({
        termId,
        classArmId: armId,
        dueDate: dueDate || undefined,
      });
      setGenerateResult({ created: result.created, skipped: result.skipped });
      setPreview(null);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCancel(id: string) {
    setCancelling(id);
    try {
      const updated = await cancelInvoice(id);
      setInvoices((prev) => prev.map((inv) => (inv.id === id ? updated : inv)));
    } catch (e) {
      console.error("[InvoicesPage] cancelInvoice:", e);
    } finally {
      setCancelling(null);
    }
  }

  const previewTotalDue = preview?.reduce((s, r) => s + r.totalDue, 0) ?? 0;

  return (
    <div className="max-w-6xl space-y-6 p-6">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Invoices</h1>

      {/* Term + arm picker */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Academic year</label>
          <select className={SELECT_CLASSES} value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="">— year —</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Term</label>
          <select
            className={SELECT_CLASSES}
            disabled={!yearId}
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
          >
            <option value="">{yearId ? "— term —" : "Select year first"}</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Class arm</label>
          <select className={SELECT_CLASSES} value={armId} onChange={(e) => setArmId(e.target.value)}>
            <option value="">— arm —</option>
            {arms.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="list">Invoice list</TabsTrigger>
        </TabsList>

        {/* ── Generate tab ── */}
        <TabsContent value="generate" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Due date (optional)</label>
              <input
                type="date"
                className={SELECT_CLASSES}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <Button variant="outline" disabled={!pickerReady || previewLoading} onClick={handlePreview}>
              {previewLoading ? "Loading…" : "Preview"}
            </Button>

            <Button disabled={!pickerReady || generating} onClick={handleGenerate}>
              {generating ? "Generating…" : "Generate invoices"}
            </Button>
          </div>

          {generateError && <p className="text-sm text-destructive">{generateError}</p>}

          {generateResult && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              Done — {generateResult.created} invoice(s) created, {generateResult.skipped} skipped (already issued).
            </div>
          )}

          {preview && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Advisory preview — {preview.length} student(s). Clicking
                &ldquo;Generate invoices&rdquo; recomputes from current fee catalog.
              </p>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student ID</TableHead>
                      <TableHead className="text-right">Fee items</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row) => (
                      <TableRow key={row.studentId}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.studentId}</TableCell>
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
            <p className="text-sm text-muted-foreground">Select a term and class arm to continue.</p>
          )}
        </TabsContent>

        {/* ── List tab ── */}
        <TabsContent value="list" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
              <select
                className={SELECT_CLASSES}
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as InvoiceStatus | ""); setPage(1); }}
              >
                <option value="">All statuses</option>
                {(Object.keys(STATUS_LABELS) as InvoiceStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice ID</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {!listLoading && invoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      No invoices found.
                    </TableCell>
                  </TableRow>
                )}
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <a href={`/finance/invoices/${inv.id}`} className="text-primary underline hover:text-primary/80">
                        {inv.id.slice(0, 8)}…
                      </a>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{inv.studentId.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[inv.status]}>{STATUS_LABELS[inv.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatKobo(inv.totalDue)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatKobo(inv.totalPaid)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{inv.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-3">
                        <a
                          href={`/finance/invoices/${inv.id}`}
                          className="text-xs text-primary underline hover:text-primary/80"
                        >
                          View
                        </a>
                        {(inv.status === "ISSUED" || inv.status === "DRAFT" || inv.status === "OVERDUE") && (
                          <button
                            disabled={cancelling === inv.id}
                            onClick={() => handleCancel(inv.id)}
                            className="text-xs text-destructive hover:text-destructive/80 disabled:opacity-50"
                          >
                            {cancelling === inv.id ? "…" : "Cancel"}
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex items-center gap-3 text-sm">
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
