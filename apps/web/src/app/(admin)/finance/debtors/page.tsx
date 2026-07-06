"use client";

import { useEffect, useState } from "react";

import type { AcademicYearDto, DebtorDto, TermDto } from "@school-kit/types";

import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { formatKobo } from "@/lib/finance/format";
import { listDebtors, sendReminders } from "@/lib/finance/finance-api";

type Status = "ISSUED" | "PARTIALLY_PAID" | "OVERDUE";

const STATUS_LABELS: Record<Status, string> = {
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  OVERDUE: "Overdue",
};

const STATUS_COLOURS: Record<Status, string> = {
  ISSUED: "bg-blue-100 text-blue-700",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-700",
  OVERDUE: "bg-red-100 text-red-700",
};

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
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Debtor list</h1>

      {/* Term selector */}
      <div className="flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
          <select
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
          >
            <option value="">Select year…</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
          <select
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Reminder result */}
      {reminderResult && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Reminders sent: <strong>{reminderResult.sent}</strong>
          {reminderResult.skipped > 0 && ` (${reminderResult.skipped} skipped — no guardian email)`}
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {/* No term selected */}
      {!termId && !loading && (
        <p className="text-sm text-gray-500">Select an academic year and term to view the debtor list.</p>
      )}

      {/* Empty state */}
      {termId && !loading && debtors.length === 0 && (
        <p className="text-sm text-gray-500">No outstanding invoices for this term.</p>
      )}

      {/* Table */}
      {debtors.length > 0 && (
        <>
          {/* Summary + actions bar */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-gray-600">
              <strong>{debtors.length}</strong> outstanding invoice{debtors.length !== 1 ? "s" : ""} —
              total balance <strong>{formatKobo(totalBalance)}</strong>
            </p>
            <button
              onClick={handleRemind}
              disabled={reminding || selected.size === 0}
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reminding
                ? "Sending…"
                : selected.size === 0
                  ? "Send reminder (select rows)"
                  : `Send reminder to ${selected.size} family${selected.size !== 1 ? "ies" : "y"}`}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selected.size === debtors.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Student</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Class</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Total due</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Paid</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Balance</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Due date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Plan</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {debtors.map((d) => (
                  <tr
                    key={d.invoiceId}
                    className={`hover:bg-gray-50 ${selected.has(d.studentId) ? "bg-blue-50" : ""}`}
                    onClick={() => toggleSelect(d.studentId)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selected.has(d.studentId)}
                        onChange={() => toggleSelect(d.studentId)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{d.studentName}</p>
                      <p className="text-xs text-gray-500">{d.admissionNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{d.classArm}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatKobo(d.totalDue)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{formatKobo(d.totalPaid)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatKobo(d.balance)}</td>
                    <td className="px-4 py-3 text-gray-700">{d.dueDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOURS[d.status]}`}>
                        {STATUS_LABELS[d.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {d.hasPaymentPlan ? "✓ Plan" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
