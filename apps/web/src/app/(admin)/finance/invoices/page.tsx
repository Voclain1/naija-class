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

const STATUS_COLOURS: Record<InvoiceStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-500",
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  OVERDUE: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-100 text-gray-400",
  REFUNDED: "bg-purple-100 text-purple-700",
};

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
    <div className="p-6 space-y-6 max-w-6xl">
      <h1 className="text-2xl font-semibold">Invoices</h1>

      {/* Term + arm picker */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm font-medium mb-1">Academic year</label>
          <select
            className="border rounded px-3 py-2 text-sm w-48"
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
          >
            <option value="">— year —</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Term</label>
          <select
            className="border rounded px-3 py-2 text-sm w-44 disabled:bg-gray-100 disabled:text-gray-400"
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
          <label className="block text-sm font-medium mb-1">Class arm</label>
          <select
            className="border rounded px-3 py-2 text-sm w-44"
            value={armId}
            onChange={(e) => setArmId(e.target.value)}
          >
            <option value="">— arm —</option>
            {arms.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["generate", "list"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "generate" ? "Generate" : "Invoice list"}
          </button>
        ))}
      </div>

      {/* ── Generate tab ── */}
      {tab === "generate" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Due date (optional)</label>
              <input
                type="date"
                className="border rounded px-3 py-2 text-sm"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <button
              disabled={!pickerReady || previewLoading}
              onClick={handlePreview}
              className="px-4 py-2 border rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {previewLoading ? "Loading…" : "Preview"}
            </button>

            <button
              disabled={!pickerReady || generating}
              onClick={handleGenerate}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate invoices"}
            </button>
          </div>

          {generateError && (
            <p className="text-sm text-red-600">{generateError}</p>
          )}

          {generateResult && (
            <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Done — {generateResult.created} invoice(s) created, {generateResult.skipped} skipped (already issued).
            </div>
          )}

          {preview && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">
                Advisory preview — {preview.length} student(s). Clicking
                &ldquo;Generate invoices&rdquo; recomputes from current fee catalog.
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Student ID</th>
                      <th className="text-right px-4 py-2 font-medium">Fee items</th>
                      <th className="text-right px-4 py-2 font-medium">Gross</th>
                      <th className="text-right px-4 py-2 font-medium">Discount</th>
                      <th className="text-right px-4 py-2 font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.studentId} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{row.studentId}</td>
                        <td className="px-4 py-2 text-right">{row.feeItemCount}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatKobo(row.totalAmount)}</td>
                        <td className="px-4 py-2 text-right font-mono text-red-600">
                          {row.totalDiscount > 0 ? `−${formatKobo(row.totalDiscount)}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium">{formatKobo(row.totalDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-right">Total due</td>
                      <td className="px-4 py-2 text-right font-mono">{formatKobo(previewTotalDue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {!preview && !previewLoading && !generateResult && pickerReady && (
            <p className="text-sm text-gray-400">
              Click &ldquo;Preview&rdquo; to see projected totals before generating.
            </p>
          )}

          {!pickerReady && (
            <p className="text-sm text-gray-400">Select a term and class arm to continue.</p>
          )}
        </div>
      )}

      {/* ── List tab ── */}
      {tab === "list" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                className="border rounded px-3 py-2 text-sm w-44"
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

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Invoice ID</th>
                  <th className="text-left px-4 py-2 font-medium">Student</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Total due</th>
                  <th className="text-right px-4 py-2 font-medium">Paid</th>
                  <th className="text-left px-4 py-2 font-medium">Due date</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td>
                  </tr>
                )}
                {!listLoading && invoices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                      No invoices found.
                    </td>
                  </tr>
                )}
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">
                      <a href={`/finance/invoices/${inv.id}`} className="underline text-blue-600 hover:text-blue-800">
                        {inv.id.slice(0, 8)}…
                      </a>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{inv.studentId.slice(0, 8)}…</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOURS[inv.status]}`}>
                        {STATUS_LABELS[inv.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{formatKobo(inv.totalDue)}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-700">{formatKobo(inv.totalPaid)}</td>
                    <td className="px-4 py-2 text-gray-500">{inv.dueDate ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex gap-2 justify-end">
                        <a
                          href={`/finance/invoices/${inv.id}`}
                          className="text-blue-600 hover:text-blue-800 text-xs underline"
                        >
                          View
                        </a>
                        {(inv.status === "ISSUED" || inv.status === "DRAFT" || inv.status === "OVERDUE") && (
                          <button
                            disabled={cancelling === inv.id}
                            onClick={() => handleCancel(inv.id)}
                            className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50"
                          >
                            {cancelling === inv.id ? "…" : "Cancel"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex items-center gap-3 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-gray-500">
                Page {page} of {Math.ceil(total / 50)} ({total} total)
              </span>
              <button
                disabled={page >= Math.ceil(total / 50)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
