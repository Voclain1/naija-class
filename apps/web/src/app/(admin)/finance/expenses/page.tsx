"use client";

import { FileText, Loader2, Pencil, PlusCircle, Settings2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ExpenseCategoryDto, ExpenseDto } from "@school-kit/types";

import { ExpenseCategoriesModal } from "@/components/finance/expense-categories-modal";
import { ExpenseFormModal } from "@/components/finance/expense-form-modal";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  createExpense,
  deleteExpense,
  getExpenseReceiptUrl,
  listExpenseCategories,
  listExpenses,
  updateExpense,
  uploadExpenseReceipt,
} from "@/lib/finance/expenses-api";
import { formatKobo } from "@/lib/finance/format";

// /finance/expenses — Phase 3 / Slice 13. Completes the P&L inputs.
//
// One screen, not two (D6 of the plan-first): expenses are a flat ledger
// (category is a tag, not a drill-down hierarchy the way FeeItem needs
// scope), so category management lives in a lightweight modal rather than
// its own /settings/finance/expenses route. Category names are resolved
// client-side against the already-fetched list (categoryId is a plain FK,
// no server-side include — see schema.prisma's Expense header comment).
function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function ExpensesPage() {
  const [categories, setCategories] = useState<ExpenseCategoryDto[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("");

  const [showCategories, setShowCategories] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, exps] = await Promise.all([
        listExpenseCategories({ includeInactive: true }),
        listExpenses(categoryFilter ? { categoryId: categoryFilter } : {}),
      ]);
      setCategories(cats);
      setExpenses(exps);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load expenses.");
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Unknown category";

  function openCreate() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(expense: ExpenseDto) {
    setEditing(expense);
    setShowForm(true);
  }

  async function handleFormSubmit(values: {
    categoryId: string;
    amountNaira: string;
    description: string;
    incurredAt: string;
  }) {
    const amountKobo = Math.round(parseFloat(values.amountNaira) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      throw new ApiError(400, { code: "INVALID_AMOUNT", message: "Enter a valid positive amount in naira." });
    }
    if (editing) {
      const updated = await updateExpense(editing.id, {
        categoryId: values.categoryId,
        amount: amountKobo,
        description: values.description.trim() || null,
        incurredAt: values.incurredAt,
      });
      setExpenses((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      toast.success("Expense updated.");
    } else {
      const created = await createExpense({
        categoryId: values.categoryId,
        amount: amountKobo,
        description: values.description.trim() || undefined,
        incurredAt: values.incurredAt,
      });
      setExpenses((prev) => [created, ...prev]);
      toast.success("Expense recorded.");
    }
    setShowForm(false);
  }

  async function handleDelete(expense: ExpenseDto) {
    if (!window.confirm("Delete this expense? This cannot be undone.")) return;
    try {
      await deleteExpense(expense.id);
      setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
      toast.success("Expense deleted.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete expense.");
    }
  }

  function triggerUpload(expenseId: string) {
    uploadTargetId.current = expenseId;
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const expenseId = uploadTargetId.current;
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file || !expenseId) return;

    setUploadingId(expenseId);
    try {
      const updated = await uploadExpenseReceipt(expenseId, file);
      setExpenses((prev) => prev.map((exp) => (exp.id === updated.id ? updated : exp)));
      toast.success("Receipt uploaded.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not upload receipt.");
    } finally {
      setUploadingId(null);
    }
  }

  async function handleViewReceipt(expense: ExpenseDto) {
    setViewingId(expense.id);
    try {
      const { url } = await getExpenseReceiptUrl(expense.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not open receipt.");
    } finally {
      setViewingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Record school outgoings — utilities, repairs, supplies, and anything
            else that feeds the P&amp;L.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCategories(true)}>
            <Settings2 className="h-4 w-4" />
            Manage categories
          </Button>
          <Button size="sm" onClick={openCreate}>
            <PlusCircle className="h-4 w-4" />
            New expense
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <label htmlFor="category-filter" className="text-sm font-medium">
          Category
        </label>
        <select
          id="category-filter"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
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
      ) : expenses.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No expenses recorded yet.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-left font-medium">Description</th>
                <th className="px-4 py-2 text-center font-medium">Receipt</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {expenses.map((expense) => (
                <tr key={expense.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(expense.incurredAt)}</td>
                  <td className="px-4 py-2">{categoryName(expense.categoryId)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatKobo(expense.amount)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{expense.description || "—"}</td>
                  <td className="px-4 py-2 text-center">
                    {expense.receiptUrl ? (
                      <button
                        type="button"
                        onClick={() => void handleViewReceipt(expense)}
                        disabled={viewingId === expense.id}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        title="View receipt"
                      >
                        {viewingId === expense.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => triggerUpload(expense.id)}
                        disabled={uploadingId === expense.id}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        title="Upload receipt"
                      >
                        {uploadingId === expense.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(expense)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Edit expense"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => void handleDelete(expense)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Delete expense"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Hidden file input shared by every row's "Upload receipt" button —
          triggerUpload() sets uploadTargetId then clicks this. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />

      <ExpenseCategoriesModal
        open={showCategories}
        onClose={() => setShowCategories(false)}
        categories={categories}
        onCategoriesChange={setCategories}
      />

      <ExpenseFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        categories={categories}
        editing={editing}
        onSubmit={handleFormSubmit}
      />
    </div>
  );
}
