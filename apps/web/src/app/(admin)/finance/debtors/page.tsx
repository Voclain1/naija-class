"use client";

import { useEffect, useState } from "react";

import type { AcademicYearDto, DebtorDto, TermDto } from "@school-kit/types";

import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { PrintButton } from "@/components/shared/print-button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { exportRowsAsCsv, type CsvColumn } from "@/lib/csv-export";
import { formatKobo } from "@/lib/finance/format";
import { listDebtors, sendReminders } from "@/lib/finance/finance-api";

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
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");

  const [debtors, setDebtors] = useState<DebtorDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ sent: number; skipped: number } | null>(null);

  // Load academic years on mount
  useEffect(() => {
    listAcademicYears()
      .then(setYears)
      .catch((e) => { console.error("[DebtorsPage] listAcademicYears:", e); });
  }, []);

  // Load terms when year changes
  useEffect(() => {
    setTermId("");
    setTerms([]);
    setDebtors([]);
    setSelected(new Set());
    if (!yearId) return;
    listTerms(yearId)
      .then(setTerms)
      .catch(() => setTerms([]));
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
      .catch((e) => { setError(String(e)); })
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

  function toggleSelectAll() {
    if (selected.size === debtors.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(debtors.map((d) => d.studentId)));
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
      setError(String(e));
    } finally {
      setReminding(false);
    }
  }

  const totalBalance = debtors.reduce((sum, d) => sum + d.balance, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Debtor list</h1>

      {/* Term selector */}
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Academic year</label>
          <select className={SELECT_CLASSES} value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="">Select year…</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Term</label>
          <select
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
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Reminder result */}
      {reminderResult && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          Reminders sent: <strong>{reminderResult.sent}</strong>
          {reminderResult.skipped > 0 && ` (${reminderResult.skipped} skipped — no guardian email)`}
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* No term selected */}
      {!termId && !loading && (
        <p className="text-sm text-muted-foreground">Select an academic year and term to view the debtor list.</p>
      )}

      {/* Empty state */}
      {termId && !loading && debtors.length === 0 && (
        <p className="text-sm text-muted-foreground">No outstanding invoices for this term.</p>
      )}

      {/* Table */}
      {debtors.length > 0 && (
        <>
          {/* Summary + actions bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{debtors.length}</strong> outstanding invoice{debtors.length !== 1 ? "s" : ""} —
              total balance <strong className="text-foreground">{formatKobo(totalBalance)}</strong>
            </p>
            <div className="flex gap-2 print:hidden">
              <ExportCsvButton
                onExport={() => exportRowsAsCsv("debtors.csv", debtors, DEBTOR_EXPORT_COLUMNS)}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 print:hidden">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selected.size === debtors.length}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {debtors.map((d) => (
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
