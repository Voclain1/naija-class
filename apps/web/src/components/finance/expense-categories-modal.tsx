"use client";

import { Check, Loader2, Pencil, PlusCircle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ExpenseCategoryDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  createExpenseCategory,
  deleteExpenseCategory,
  updateExpenseCategory,
} from "@/lib/finance/expenses-api";

// Phase 3 / Slice 13 — lightweight category management modal. Expense
// categories are flat (name + active, no scope fields), so this earns an
// inline modal rather than a dedicated settings screen — unlike fee catalog's
// /settings/finance/fees, which needed a full page for the scope-picker
// complexity FeeItem has. Same inline-overlay pattern as ReopenModal/
// BvnCaptureModal (no shared Dialog primitive yet).
export function ExpenseCategoriesModal({
  open,
  onClose,
  categories,
  onCategoriesChange,
}: {
  open: boolean;
  onClose: () => void;
  categories: ExpenseCategoryDto[];
  onCategoriesChange: (categories: ExpenseCategoryDto[]) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (open) {
      setCreating(false);
      setNewName("");
      setEditingId(null);
    }
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    if (!newName.trim()) return;
    setSavingId("__new__");
    try {
      const created = await createExpenseCategory({ name: newName.trim() });
      onCategoriesChange([...categories, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setCreating(false);
      toast.success(`"${created.name}" created.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create category.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleRename(cat: ExpenseCategoryDto) {
    if (!editName.trim() || editName.trim() === cat.name) {
      setEditingId(null);
      return;
    }
    setSavingId(cat.id);
    try {
      const updated = await updateExpenseCategory(cat.id, { name: editName.trim() });
      onCategoriesChange(categories.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(`Renamed to "${updated.name}".`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not rename category.");
    } finally {
      setSavingId(null);
      setEditingId(null);
    }
  }

  async function toggleActive(cat: ExpenseCategoryDto) {
    setSavingId(cat.id);
    try {
      const updated = await updateExpenseCategory(cat.id, { active: !cat.active });
      onCategoriesChange(categories.map((c) => (c.id === updated.id ? updated : c)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update category.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(cat: ExpenseCategoryDto) {
    if ((cat.expenseCount ?? 0) > 0) {
      toast.error(
        `Cannot delete "${cat.name}" — it has ${cat.expenseCount} expense(s). Deactivate it or reassign the expenses first.`,
      );
      return;
    }
    if (!window.confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    setSavingId(cat.id);
    try {
      await deleteExpenseCategory(cat.id);
      onCategoriesChange(categories.filter((c) => c.id !== cat.id));
      toast.success(`"${cat.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete category.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">Expense categories</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-4 flex flex-col divide-y rounded-md border">
          {categories.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
              No categories yet.
            </li>
          )}
          {categories.map((cat) => (
            <li key={cat.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === cat.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleRename(cat)}
                  maxLength={100}
                />
              ) : (
                <span className={`min-w-0 flex-1 truncate text-sm ${!cat.active ? "text-muted-foreground line-through" : ""}`}>
                  {cat.name}
                </span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{cat.expenseCount ?? 0}</span>
              <button
                type="button"
                onClick={() => void toggleActive(cat)}
                disabled={savingId === cat.id}
                title={cat.active ? "Deactivate" : "Activate"}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {cat.active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(cat.id);
                  setEditName(cat.name);
                }}
                title="Rename"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(cat)}
                disabled={savingId === cat.id}
                title="Delete"
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                {savingId === cat.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>

        {creating ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
              placeholder="e.g. Utilities"
              maxLength={100}
            />
            <Button size="sm" onClick={() => void handleCreate()} disabled={savingId === "__new__" || !newName.trim()}>
              {savingId === "__new__" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreating(true)}>
            <PlusCircle className="h-4 w-4" />
            New category
          </Button>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
