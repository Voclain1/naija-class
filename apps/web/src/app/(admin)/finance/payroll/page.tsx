"use client";

import { FileText, Loader2, PlusCircle, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PayrollItemDto, UserListItemDto } from "@school-kit/types";

import { PayrollFormModal } from "@/components/finance/payroll-form-modal";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";
import {
  approvePayrollItem,
  createPayrollItem,
  generatePayslip,
  listPayroll,
  transferPayrollItem,
} from "@/lib/finance/payroll-api";
import { listStaff } from "@/lib/staff/staff-api";

// /finance/payroll — Phase 3 / Payroll CP3 (run without money movement) +
// CP4b (Paystack staff salary transfers). No prior payroll UI existed
// (CP3/CP4a were API-only) — this page covers the full lifecycle: create
// (DRAFT) -> approve (APPROVED) -> generate payslip -> transfer (PROCESSING)
// -> PAID/FAILED (resolved by the transfer.success/failed/reversed webhook,
// not by this page — see the poll below).
//
// One screen, not two (same "flat ledger" precedent as /finance/expenses):
// staff bank accounts have their own settings screen (CP4a); this page only
// needs a staff member's NAME, resolved client-side from listStaff() against
// PayrollItemDto.userId (a plain FK, no server-side include).
function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  APPROVED: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  PROCESSING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  FAILED: "bg-destructive/10 text-destructive",
};

export default function PayrollPage() {
  const { permissions } = useAuth();
  const canTransfer = hasPermission(permissions, "payroll.transfer");

  const [period, setPeriod] = useState(currentPeriod());
  const [staff, setStaff] = useState<UserListItemDto[]>([]);
  const [items, setItems] = useState<PayrollItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [staffList, payrollItems] = await Promise.all([
        staff.length ? Promise.resolve(staff) : listStaff(),
        listPayroll({ period }),
      ]);
      setStaff(staffList);
      setItems(payrollItems);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load payroll.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // While any item is PROCESSING, poll the list every 4s so a PAID/FAILED
  // resolution from the transfer.success/failed/reversed webhook shows up
  // without a manual refresh.
  useEffect(() => {
    const anyProcessing = items.some((i) => i.status === "PROCESSING");
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (anyProcessing) {
      pollRef.current = setInterval(() => {
        void listPayroll({ period }).then(setItems).catch(() => undefined);
      }, 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [items, period]);

  const staffName = (userId: string) => {
    const s = staff.find((u) => u.id === userId);
    return s ? `${s.firstName} ${s.lastName}` : "Unknown staff";
  };

  async function handleCreate(values: {
    userId: string;
    period: string;
    grossSalaryNaira: string;
    deductions: { name: string; amountNaira: string }[];
  }) {
    const grossSalary = Math.round(parseFloat(values.grossSalaryNaira) * 100);
    const deductions = values.deductions.map((d) => ({
      name: d.name.trim(),
      amount: Math.round(parseFloat(d.amountNaira) * 100),
    }));
    const created = await createPayrollItem({
      userId: values.userId,
      period: values.period,
      grossSalary,
      deductions,
    });
    if (created.period === period) {
      setItems((prev) => [created, ...prev]);
    }
    toast.success("Payroll item created.");
    setShowForm(false);
  }

  async function handleApprove(item: PayrollItemDto) {
    setBusyId(item.id);
    try {
      const updated = await approvePayrollItem(item.id);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      toast.success("Payroll item approved.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not approve payroll item.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleGeneratePayslip(item: PayrollItemDto) {
    setBusyId(item.id);
    try {
      const { url } = await generatePayslip(item.id);
      const updated = await listPayroll({ period, userId: item.userId });
      setItems((prev) => prev.map((i) => (i.id === item.id ? (updated.find((u) => u.id === item.id) ?? i) : i)));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not generate payslip.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleTransfer(item: PayrollItemDto) {
    setBusyId(item.id);
    try {
      const result = await transferPayrollItem(item.id);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: result.status } : i)));
      toast.success("Transfer initiated — awaiting confirmation from Paystack.");
    } catch (e) {
      // Pre-flight failures (INSUFFICIENT_PAYSTACK_BALANCE, NO_BANK_ACCOUNT_ON_FILE,
      // PAYROLL_NOT_APPROVED_FOR_TRANSFER) come back as a ConflictError with a
      // clear operator-facing message — surface it directly, don't paraphrase.
      toast.error(e instanceof ApiError ? e.message : "Could not initiate transfer.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Run monthly payroll, approve, and transfer staff salaries.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <PlusCircle className="h-4 w-4" />
          Run payroll
        </Button>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="period-filter" className="text-sm font-medium">
          Period
        </label>
        <input
          id="period-filter"
          type="month"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No payroll items for this period yet.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Staff</th>
                <th className="px-4 py-2 text-right font-medium">Gross</th>
                <th className="px-4 py-2 text-right font-medium">Net</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2">{staffName(item.userId)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatKobo(item.grossSalary)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatKobo(item.netSalary)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status] ?? ""}`}>
                      {item.status === "PROCESSING" ? "Processing…" : item.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {item.status === "DRAFT" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === item.id}
                          onClick={() => void handleApprove(item)}
                        >
                          {busyId === item.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Approve
                        </Button>
                      )}
                      {(item.status === "APPROVED" || item.status === "PAID") && !item.payslipUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === item.id}
                          onClick={() => void handleGeneratePayslip(item)}
                        >
                          {busyId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                          Payslip
                        </Button>
                      )}
                      {item.status === "APPROVED" && canTransfer && (
                        <Button
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => void handleTransfer(item)}
                        >
                          {busyId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          Transfer salary
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PayrollFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        staff={staff}
        defaultPeriod={period}
        onSubmit={handleCreate}
      />
    </div>
  );
}
