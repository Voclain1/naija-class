"use client";

import { Loader2, PlusCircle, Trash2, Pencil, X, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  AcademicYearDto,
  ClassArmDto,
  ClassLevelDto,
  FeeCategoryDto,
  FeeItemDto,
  TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { listArmsForLevel } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import {
  createFeeCategory,
  createFeeItem,
  deleteFeeCategory,
  deleteFeeItem,
  listFeeCategories,
  listFeeItems,
  updateFeeCategory,
  updateFeeItem,
} from "@/lib/finance/fee-catalog-api";
import { formatKobo } from "@/lib/finance/format";

// ---------------------------------------------------------------------------
// Fee Catalog settings page.
// Left: category list. Right: items for the selected category.
// Amount input is in naira; stored/sent as kobo (×100 on submit).
// ---------------------------------------------------------------------------

interface ItemFormState {
  name: string;
  amountNaira: string; // user-facing; converted to kobo on submit
  classLevelId: string;
  classArmId: string;
  termId: string;
  academicYearId: string;
}

const EMPTY_ITEM_FORM: ItemFormState = {
  name: "",
  amountNaira: "",
  classLevelId: "",
  classArmId: "",
  termId: "",
  academicYearId: "",
};

export default function FeesPage() {
  // ── scope reference data ─────────────────────────────────────────────────
  const [levels, setLevels] = useState<ClassLevelDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [terms, setTerms] = useState<TermDto[]>([]);

  // ── categories ───────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<FeeCategoryDto[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);

  // category create / edit form
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<FeeCategoryDto | null>(null);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  // ── items ─────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<FeeItemDto[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  // item create / edit form
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FeeItemDto | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [itemSaving, setItemSaving] = useState(false);

  // ── reference data load ──────────────────────────────────────────────────
  useEffect(() => {
    void Promise.all([
      listClassLevels().then(setLevels).catch(() => undefined),
      listAcademicYears().then(setYears).catch(() => undefined),
    ]);
  }, []);

  // When level changes in item form, reload arms.
  useEffect(() => {
    if (!itemForm.classLevelId) {
      setArms([]);
      return;
    }
    void listArmsForLevel(itemForm.classLevelId)
      .then(setArms)
      .catch(() => setArms([]));
  }, [itemForm.classLevelId]);

  // When academic year changes in item form, reload terms.
  useEffect(() => {
    if (!itemForm.academicYearId) {
      setTerms([]);
      return;
    }
    void listTerms(itemForm.academicYearId)
      .then(setTerms)
      .catch(() => setTerms([]));
  }, [itemForm.academicYearId]);

  // ── categories CRUD ──────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    setCatsLoading(true);
    try {
      setCategories(await listFeeCategories());
    } catch {
      toast.error("Could not load fee categories.");
    } finally {
      setCatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const openCatCreate = () => {
    setEditingCat(null);
    setCatName("");
    setCatDesc("");
    setCatFormOpen(true);
  };

  const openCatEdit = (cat: FeeCategoryDto) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatDesc(cat.description ?? "");
    setCatFormOpen(true);
  };

  const saveCat = async () => {
    if (!catName.trim()) return;
    setCatSaving(true);
    try {
      if (editingCat) {
        const updated = await updateFeeCategory(editingCat.id, {
          name: catName.trim(),
          description: catDesc.trim() || null,
        });
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        toast.success(`"${updated.name}" updated.`);
      } else {
        const created = await createFeeCategory({
          name: catName.trim(),
          description: catDesc.trim() || undefined,
        });
        setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedCatId(created.id);
        toast.success(`"${created.name}" created.`);
      }
      setCatFormOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save category.");
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCat = async (cat: FeeCategoryDto) => {
    if ((cat.itemCount ?? 0) > 0) {
      toast.error(`Cannot delete "${cat.name}" — it has ${cat.itemCount} item(s). Remove or deactivate them first.`);
      return;
    }
    if (!window.confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    try {
      await deleteFeeCategory(cat.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      if (selectedCatId === cat.id) setSelectedCatId(null);
      toast.success(`"${cat.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete category.");
    }
  };

  // ── items CRUD ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCatId) {
      setItems([]);
      return;
    }
    setItemsLoading(true);
    listFeeItems({ categoryId: selectedCatId, includeInactive: true })
      .then(setItems)
      .catch(() => toast.error("Could not load fee items."))
      .finally(() => setItemsLoading(false));
  }, [selectedCatId]);

  const openItemCreate = () => {
    setEditingItem(null);
    setItemForm(EMPTY_ITEM_FORM);
    setItemFormOpen(true);
  };

  const openItemEdit = (item: FeeItemDto) => {
    setEditingItem(item);
    setItemForm({
      name: item.name,
      amountNaira: (item.amount / 100).toFixed(2),
      classLevelId: item.classLevelId ?? "",
      classArmId: item.classArmId ?? "",
      termId: item.termId ?? "",
      academicYearId: item.academicYearId ?? "",
    });
    setItemFormOpen(true);
  };

  const saveItem = async () => {
    if (!itemForm.name.trim() || !itemForm.amountNaira || !selectedCatId) return;
    const amountKobo = Math.round(parseFloat(itemForm.amountNaira) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      toast.error("Enter a valid positive amount in naira.");
      return;
    }
    setItemSaving(true);
    try {
      if (editingItem) {
        const updated = await updateFeeItem(editingItem.id, {
          name: itemForm.name.trim(),
          amount: amountKobo,
          classLevelId: itemForm.classLevelId || null,
          classArmId: itemForm.classArmId || null,
          termId: itemForm.termId || null,
          academicYearId: itemForm.academicYearId || null,
        });
        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        toast.success(`"${updated.name}" updated.`);
      } else {
        const created = await createFeeItem({
          categoryId: selectedCatId,
          name: itemForm.name.trim(),
          amount: amountKobo,
          classLevelId: itemForm.classLevelId || undefined,
          classArmId: itemForm.classArmId || undefined,
          termId: itemForm.termId || undefined,
          academicYearId: itemForm.academicYearId || undefined,
        });
        setItems((prev) => [...prev, created]);
        // Bump the category item count in the sidebar.
        setCategories((prev) =>
          prev.map((c) =>
            c.id === selectedCatId ? { ...c, itemCount: (c.itemCount ?? 0) + 1 } : c,
          ),
        );
        toast.success(`"${created.name}" added.`);
      }
      setItemFormOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save fee item.");
    } finally {
      setItemSaving(false);
    }
  };

  const handleDeleteItem = async (item: FeeItemDto) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await deleteFeeItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setCategories((prev) =>
        prev.map((c) =>
          c.id === selectedCatId ? { ...c, itemCount: Math.max(0, (c.itemCount ?? 1) - 1) } : c,
        ),
      );
      toast.success(`"${item.name}" deleted.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete fee item.");
    }
  };

  const selectedCat = categories.find((c) => c.id === selectedCatId);

  return (
    <div className="flex w-full flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Fee catalog</h1>
        <p className="text-sm text-muted-foreground">
          Define fee categories (e.g. Tuition, PTA Levy) and the items within
          each — with optional scope to a class level, arm, term, or academic year.
        </p>
      </header>

      <div className="flex gap-6">
        {/* ── Category panel ─────────────────────────────────────────── */}
        <aside className="w-64 shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Categories</h2>
            <Button size="sm" variant="outline" onClick={openCatCreate}>
              <PlusCircle className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
          </div>

          {catsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No categories yet.</p>
          ) : (
            <ul className="space-y-1">
              {categories.map((cat) => (
                <li key={cat.id}>
                  <button
                    onClick={() => setSelectedCatId(cat.id)}
                    className={`group flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                      cat.id === selectedCatId
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate font-medium">{cat.name}</span>
                    <span className={`ml-2 shrink-0 text-xs ${cat.id === selectedCatId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {cat.itemCount ?? 0}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Category form (inline panel) ───────────────────────────── */}
        {catFormOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-xl">
              <h3 className="mb-4 text-base font-semibold">
                {editingCat ? "Edit category" : "New category"}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Name</label>
                  <input
                    autoFocus
                    className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void saveCat()}
                    placeholder="e.g. Tuition Fees"
                    maxLength={100}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Description <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <textarea
                    className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={catDesc}
                    onChange={(e) => setCatDesc(e.target.value)}
                    placeholder="Brief description"
                    rows={2}
                    maxLength={500}
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCatFormOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void saveCat()} disabled={catSaving || !catName.trim()}>
                  {catSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Items panel ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {!selectedCat ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Select a category to manage its fee items.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{selectedCat.name}</h2>
                    <button
                      onClick={() => openCatEdit(selectedCat)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Edit category"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void handleDeleteCat(selectedCat)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete category"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {selectedCat.description && (
                    <p className="text-sm text-muted-foreground">{selectedCat.description}</p>
                  )}
                </div>
                <Button size="sm" onClick={openItemCreate}>
                  <PlusCircle className="mr-1 h-3.5 w-3.5" />
                  Add item
                </Button>
              </div>

              {itemsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No fee items in this category yet.
                </div>
              ) : (
                <div className="rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Name</th>
                        <th className="px-4 py-2 text-right font-medium">Amount</th>
                        <th className="px-4 py-2 text-left font-medium">Scope</th>
                        <th className="px-4 py-2 text-center font-medium">Active</th>
                        <th className="px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map((item) => (
                        <tr key={item.id} className="hover:bg-muted/20">
                          <td className="px-4 py-2 font-medium">{item.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatKobo(item.amount)}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">
                            {scopeLabel(item, levels, arms, years, terms)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {item.active ? (
                              <Check className="mx-auto h-4 w-4 text-green-600" />
                            ) : (
                              <X className="mx-auto h-4 w-4 text-muted-foreground" />
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openItemEdit(item)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Edit item"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => void handleDeleteItem(item)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Delete item"
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
            </div>
          )}
        </div>
      </div>

      {/* ── Item form modal ──────────────────────────────────────────── */}
      {itemFormOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-xl">
            <h3 className="mb-4 text-base font-semibold">
              {editingItem ? "Edit fee item" : "New fee item"}
            </h3>
            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <input
                  autoFocus
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={itemForm.name}
                  onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. First Term Tuition"
                  maxLength={200}
                />
              </div>

              {/* Amount in naira */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Amount <span className="font-normal text-muted-foreground">(₦ naira)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={itemForm.amountNaira}
                  onChange={(e) => setItemForm((f) => ({ ...f, amountNaira: e.target.value }))}
                  placeholder="e.g. 15000"
                />
                {itemForm.amountNaira && !isNaN(parseFloat(itemForm.amountNaira)) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Stored as {(Math.round(parseFloat(itemForm.amountNaira) * 100)).toLocaleString()} kobo
                  </p>
                )}
              </div>

              {/* Scope section */}
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">
                Scope (all optional — leave blank for school-wide)
              </p>

              {/* Class level */}
              <div>
                <label className="mb-1 block text-sm font-medium">Class level</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={itemForm.classLevelId}
                  onChange={(e) =>
                    setItemForm((f) => ({
                      ...f,
                      classLevelId: e.target.value,
                      classArmId: "", // reset arm when level changes
                    }))
                  }
                >
                  <option value="">— Any level —</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Class arm — disabled until level selected */}
              <div>
                <label className="mb-1 block text-sm font-medium">Class arm</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  value={itemForm.classArmId}
                  onChange={(e) => setItemForm((f) => ({ ...f, classArmId: e.target.value }))}
                  disabled={!itemForm.classLevelId}
                >
                  <option value="">— Any arm —</option>
                  {arms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {!itemForm.classLevelId && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Select a class level first.</p>
                )}
              </div>

              {/* Academic year */}
              <div>
                <label className="mb-1 block text-sm font-medium">Academic year</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={itemForm.academicYearId}
                  onChange={(e) =>
                    setItemForm((f) => ({
                      ...f,
                      academicYearId: e.target.value,
                      termId: "", // reset term when year changes
                    }))
                  }
                >
                  <option value="">— Any year —</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Term — disabled until year selected */}
              <div>
                <label className="mb-1 block text-sm font-medium">Term</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  value={itemForm.termId}
                  onChange={(e) => setItemForm((f) => ({ ...f, termId: e.target.value }))}
                  disabled={!itemForm.academicYearId}
                >
                  <option value="">— Any term —</option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {!itemForm.academicYearId && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Select an academic year first.</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setItemFormOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void saveItem()}
                disabled={itemSaving || !itemForm.name.trim() || !itemForm.amountNaira}
              >
                {itemSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Derive a human-readable scope label from the item's FK ids, resolved
// against the reference lists already loaded on the page.
// ---------------------------------------------------------------------------
function scopeLabel(
  item: FeeItemDto,
  levels: ClassLevelDto[],
  _arms: ClassArmDto[],
  years: AcademicYearDto[],
  terms: TermDto[],
): string {
  const parts: string[] = [];
  if (item.classLevelId) {
    const level = levels.find((l) => l.id === item.classLevelId);
    parts.push(level?.name ?? "Unknown level");
  }
  if (item.classArmId) {
    const arm = _arms.find((a) => a.id === item.classArmId);
    parts.push(arm?.name ?? "Unknown arm");
  }
  if (item.academicYearId) {
    const year = years.find((y) => y.id === item.academicYearId);
    parts.push(year?.label ?? "Unknown year");
  }
  if (item.termId) {
    const term = terms.find((t) => t.id === item.termId);
    parts.push(term?.name ?? "Unknown term");
  }
  return parts.length ? parts.join(" · ") : "School-wide";
}
