"use client";

import { ChevronDown, Loader2, PlusCircle, Trash2, Pencil, X, Check } from "lucide-react";
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
import { InlineAlert } from "@/components/shared/inline-alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { listArmsForLevel } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import {
  feeScopeWarning,
  feeScopeWarningText,
} from "@/lib/finance/fee-scope-warning";
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
import { financeErrorMessage, logFinanceError } from "@/lib/finance/error-copy";
import { nairaInputToKobo } from "@/lib/finance/naira-input";

// ---------------------------------------------------------------------------
// Fee Catalog page (/finance/fees; moved from /settings/finance/fees
// 2026-08-14 — see components/finance/sub-nav.tsx. Unchanged otherwise).
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
  const [years, setYears] = useState<AcademicYearDto[]>([]);

  // FORM state: the dependent dropdowns, deliberately narrow — arms for the
  // level currently chosen in the item form, terms for the year chosen there.
  // Emptied whenever the form has no level/year.
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [terms, setTerms] = useState<TermDto[]>([]);

  // TABLE state: every arm and every term in the school, loaded once.
  //
  // These exist because scopeLabel used to read the FORM lists above, so a
  // saved item's arm and term could only be named while the form happened to
  // have the matching level/year selected — otherwise the row rendered
  // "Unknown arm · Unknown term" for perfectly valid data. Levels and years
  // never had the problem because they load globally, which is exactly why
  // half of each scope label resolved and half did not.
  //
  // That was not cosmetic: on 2026-08-26 it hid a fee item pinned to the
  // Second Term of the WRONG academic year, which made invoice generation
  // return zero and looked like broken arm scoping.
  const [allArms, setAllArms] = useState<ClassArmDto[]>([]);
  const [allTerms, setAllTerms] = useState<TermDto[]>([]);

  // ── categories ───────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<FeeCategoryDto[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
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
  const [itemsError, setItemsError] = useState<string | null>(null);

  // item create / edit form
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FeeItemDto | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [itemSaving, setItemSaving] = useState(false);
  const [preparingFee, setPreparingFee] = useState(false);
  const [showPeriod, setShowPeriod] = useState(false);
  const [feeAudience, setFeeAudience] = useState<"school" | "level" | "class">("school");

  // ── reference data load ──────────────────────────────────────────────────
  useEffect(() => {
    void Promise.all([
      listClassLevels().then(setLevels).catch((e) => {
        logFinanceError("listFeeClassLevels", e);
        setReferenceError(financeErrorMessage(e));
      }),
      listAcademicYears().then(setYears).catch((e) => {
        logFinanceError("listFeeAcademicYears", e);
        setReferenceError(financeErrorMessage(e));
      }),
      listClassArms().then(setAllArms).catch((e) => {
        logFinanceError("listFeeClassArms", e);
        setReferenceError(financeErrorMessage(e));
      }),
    ]);
  }, []);

  // Every term across every year, for the table's scope labels. Terms are only
  // listable per-year, so this fans out over the years once they are known —
  // a handful of requests, made once, not per render.
  useEffect(() => {
    if (years.length === 0) return;
    let cancelled = false;
    void Promise.all(
      years.map((y) => listTerms(y.id).catch((e) => {
        logFinanceError("listFeeTerms", e);
        setReferenceError(financeErrorMessage(e));
        return [] as TermDto[];
      })),
    ).then((lists) => {
      if (!cancelled) setAllTerms(lists.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [years]);

  // When level changes in item form, reload arms.
  useEffect(() => {
    if (!itemForm.classLevelId) {
      setArms([]);
      return;
    }
    void listArmsForLevel(itemForm.classLevelId)
      .then(setArms)
      .catch((e) => {
        logFinanceError("listFeeArmsForLevel", e);
        setReferenceError(financeErrorMessage(e));
      });
  }, [itemForm.classLevelId]);

  // When academic year changes in item form, reload terms.
  useEffect(() => {
    if (!itemForm.academicYearId) {
      setTerms([]);
      return;
    }
    void listTerms(itemForm.academicYearId)
      .then(setTerms)
      .catch((e) => {
        logFinanceError("listFeeTermsForYear", e);
        setReferenceError(financeErrorMessage(e));
      });
  }, [itemForm.academicYearId]);

  // Warn when the item being edited is scoped outside the current year. Uses
  // the PAGE-level term list so it works even before the form's dependent
  // term list has loaded.
  const scopeWarning = feeScopeWarning({
    academicYearId: itemForm.academicYearId || null,
    termId: itemForm.termId || null,
    years,
    terms: allTerms,
  });

  // ── categories CRUD ──────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    setCatsLoading(true);
    setCategoriesError(null);
    try {
      const loaded = await listFeeCategories();
      setCategories(loaded);
      setSelectedCatId((current) => current ?? loaded[0]?.id ?? null);
    } catch (e) {
      logFinanceError("listFeeCategories", e);
      setCategoriesError(financeErrorMessage(e));
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
      toast.error(e instanceof ApiError ? e.message : "Could not save the fee group.");
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
      toast.error(e instanceof ApiError ? e.message : "Could not delete the fee group.");
    }
  };

  // ── items CRUD ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCatId) {
      setItems([]);
      return;
    }
    setItemsLoading(true);
    setItemsError(null);
    listFeeItems({ categoryId: selectedCatId, includeInactive: true })
      .then(setItems)
      .catch((e) => {
        logFinanceError("listFeeItems", e);
        setItemsError(financeErrorMessage(e));
      })
      .finally(() => setItemsLoading(false));
  }, [selectedCatId]);

  const openItemCreate = () => {
    setEditingItem(null);
    const currentYear = years.find((year) => year.isCurrent);
    const currentTerm = allTerms.find(
      (term) => term.isCurrent && (!currentYear || term.academicYearId === currentYear.id),
    );
    setItemForm({
      ...EMPTY_ITEM_FORM,
      academicYearId: currentYear?.id ?? "",
      termId: currentTerm?.id ?? "",
    });
    setShowPeriod(false);
    setFeeAudience("school");
    setItemFormOpen(true);
  };

  const openSimpleFeeCreate = async () => {
    if (selectedCatId || categories[0]) {
      if (!selectedCatId && categories[0]) setSelectedCatId(categories[0].id);
      openItemCreate();
      return;
    }
    setPreparingFee(true);
    try {
      const created = await createFeeCategory({
        name: "School fees",
        description: "Everyday school fees. You can add optional fee groups later.",
      });
      setCategories([created]);
      setSelectedCatId(created.id);
      openItemCreate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not prepare the fee form. Try again.");
    } finally {
      setPreparingFee(false);
    }
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
    setShowPeriod(Boolean(item.termId || item.academicYearId));
    setFeeAudience(item.classArmId ? "class" : item.classLevelId ? "level" : "school");
    setItemFormOpen(true);
  };

  const saveItem = async () => {
    if (!itemForm.name.trim() || !itemForm.amountNaira || !selectedCatId) return;
    const amountKobo = nairaInputToKobo(itemForm.amountNaira);
    if (amountKobo === null || amountKobo <= 0) {
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
      toast.error(e instanceof ApiError ? e.message : "Could not save the fee.");
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
      toast.error(e instanceof ApiError ? e.message : "Could not delete the fee.");
    }
  };

  const selectedCat = categories.find((c) => c.id === selectedCatId);

  return (
    <div className="schoolkit-workspace flex w-full flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Fees</h1>
          <p className="text-sm text-muted-foreground">
            Add what students pay, choose who pays it, and SchoolKit will use it when creating invoices.
          </p>
        </div>
        <Button onClick={() => void openSimpleFeeCreate()} disabled={preparingFee || catsLoading}>
          {preparingFee ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
          Add fee
        </Button>
      </header>

      {referenceError && (
        <InlineAlert title="Could not load fee setup information" action={{ label: "Retry", onClick: () => window.location.reload() }}>
          {referenceError}
        </InlineAlert>
      )}

      {categoriesError && (
        <InlineAlert title="Could not load fee groups" action={{ label: "Retry", onClick: () => void loadCategories() }}>
          {categoriesError}
        </InlineAlert>
      )}

      {itemsError && (
        <InlineAlert title="Could not load fees" action={{ label: "Retry", onClick: () => window.location.reload() }}>
          {itemsError}
        </InlineAlert>
      )}

      {/* Categories beside the items from `md`; stacked above them on a phone,
          where a 256px column beside the items left them no room. */}
      <div className="flex flex-col gap-6 md:flex-row">
        {/* ── Category panel ─────────────────────────────────────────── */}
        <aside className="w-full md:w-64 md:shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Fee groups <span className="font-normal text-muted-foreground">(optional)</span></h2>
            <Button size="sm" variant="outline" onClick={openCatCreate}>
              <PlusCircle className="mr-1 h-3.5 w-3.5" aria-hidden />
              {/* Visible label stays "New" (it sits under a "Categories"
                  heading, which sighted users read as context). The sr-only
                  suffix gives the button a self-contained accessible name —
                  a screen-reader user tabbing to it out of that visual
                  context otherwise hears only "New". Keeping "New" as the
                  prefix satisfies WCAG 2.5.3 Label in Name. */}
              New<span className="sr-only"> fee group</span>
            </Button>
          </div>

          {catsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !categoriesError && categories.length === 0 ? (
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

        {/* ── Category form ─────────────────────────────────────────────── */}
        <Dialog open={catFormOpen} onOpenChange={setCatFormOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{editingCat ? "Edit fee group" : "New fee group"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label htmlFor="fee-name" className="mb-1 block text-sm font-medium text-foreground">Name</label>
                <input id="fee-name"
                  autoFocus
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveCat()}
                  placeholder="e.g. Tuition Fees"
                  maxLength={100}
                />
              </div>
              <div>
                <label htmlFor="fee-description-optional" className="mb-1 block text-sm font-medium text-foreground">
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea id="fee-description-optional"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  placeholder="Brief description"
                  rows={2}
                  maxLength={500}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCatFormOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveCat()} disabled={catSaving || !catName.trim()}>
                {catSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Items panel ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {!selectedCat ? (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Add a fee to get started. SchoolKit will create a general fee group automatically.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="min-w-0 break-words text-base font-semibold">{selectedCat.name}</h2>
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
                  Add fee
                </Button>
              </div>

              {itemsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : !itemsError && items.length === 0 ? (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                  No fees in this group yet.
                </div>
              ) : items.length > 0 ? (
                <div className="rounded-lg border">
                  <Table stackOnMobile>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Who pays</TableHead>
                        <TableHead className="text-center">Active</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatKobo(item.amount)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {scopeLabel(item, levels, allArms, years, allTerms)}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.active ? (
                              <Check className="mx-auto h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                            ) : (
                              <X className="mx-auto h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* ── Item form modal ──────────────────────────────────────────── */}
      <Dialog open={itemFormOpen} onOpenChange={setItemFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit fee" : "Add fee"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Name */}
            <div>
              <label htmlFor="fee-name-2" className="mb-1 block text-sm font-medium text-foreground">Name</label>
              <input id="fee-name-2"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. First Term Tuition"
                maxLength={200}
              />
            </div>

            {/* Amount in naira */}
            <div>
              <label htmlFor="fee-amount-naira-naira" className="mb-1 block text-sm font-medium text-foreground">
                Amount <span className="font-normal text-muted-foreground">(₦ naira)</span>
              </label>
              <input id="fee-amount-naira-naira"
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={itemForm.amountNaira}
                onChange={(e) => setItemForm((f) => ({ ...f, amountNaira: e.target.value }))}
                placeholder="e.g. 15000"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who should pay this fee?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: "Whole school", value: "school" },
                  { label: "A class level", value: "level" },
                  { label: "One class", value: "class" },
                ].map((option) => {
                  return <label key={option.value} className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm ${feeAudience === option.value ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="fee-audience" checked={feeAudience === option.value} onChange={() => {
                      const next = option.value as "school" | "level" | "class";
                      setFeeAudience(next);
                      setItemForm((form) => ({ ...form, classLevelId: next === "school" ? "" : form.classLevelId, classArmId: next === "class" ? form.classArmId : "" }));
                    }} />
                    {option.label}
                  </label>;
                })}
              </div>
            </fieldset>

            {/* Class level */}
            {feeAudience !== "school" && <div>
              <label htmlFor="fee-class-level" className="mb-1 block text-sm font-medium text-foreground">Class level</label>
              <select id="fee-class-level"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={itemForm.classLevelId}
                onChange={(e) =>
                  setItemForm((f) => ({
                    ...f,
                    classLevelId: e.target.value,
                    classArmId: "", // reset arm when level changes
                  }))
                }
              >
                <option value="">Select a class level…</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>}

            {/* Class arm — disabled until level selected */}
            {feeAudience === "class" && itemForm.classLevelId && <div>
              <label htmlFor="fee-class-arm" className="mb-1 block text-sm font-medium text-foreground">Class arm</label>
              <select id="fee-class-arm"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                value={itemForm.classArmId}
                onChange={(e) => setItemForm((f) => ({ ...f, classArmId: e.target.value }))}
                disabled={!itemForm.classLevelId}
              >
                <option value="">Select a class…</option>
                {arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {!itemForm.classLevelId && (
                <p className="mt-0.5 text-xs text-muted-foreground">Select a class level first.</p>
              )}
            </div>}

            <button type="button" className="flex items-center gap-1 text-sm font-medium text-primary" onClick={() => setShowPeriod((open) => !open)} aria-expanded={showPeriod}>
              Change school year or term <ChevronDown className={`h-4 w-4 ${showPeriod ? "rotate-180" : ""}`} />
            </button>

            {showPeriod && <><div>
              <label htmlFor="fee-academic-year" className="mb-1 block text-sm font-medium text-foreground">Academic year</label>
              <select id="fee-academic-year"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
              <label htmlFor="fee-term" className="mb-1 block text-sm font-medium text-foreground">Term</label>
              <select id="fee-term"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
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
            </div></>}
          </div>

          {/*
            Scope warning. A fee item scoped outside the current academic year
            is valid — a school may set next year's fees in advance — but it
            will NOT appear in invoices generated for the current term, and on
            2026-08-26 that silence cost a pilot school an afternoon: an item
            pinned to "Second Term" of the wrong YEAR produced zero invoices
            and looked like broken arm scoping. Says what will happen, not
            merely that something is unusual.
          */}
          {scopeWarning && (
            <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
              {feeScopeWarningText(scopeWarning)}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setItemFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveItem()}
              disabled={itemSaving || !itemForm.name.trim() || !itemForm.amountNaira || (feeAudience !== "school" && !itemForm.classLevelId) || (feeAudience === "class" && !itemForm.classArmId)}
            >
              {itemSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {editingItem ? "Save changes" : "Add fee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  allArms: ClassArmDto[],
  years: AcademicYearDto[],
  allTerms: TermDto[],
): string {
  // NOTE: these must be the PAGE-level lists (every arm, every term), never
  // the item form's dependent dropdowns. See the state block above.
  const parts: string[] = [];
  if (item.classLevelId) {
    const level = levels.find((l) => l.id === item.classLevelId);
    parts.push(level?.name ?? "Unknown level");
  }
  if (item.classArmId) {
    const arm = allArms.find((a) => a.id === item.classArmId);
    parts.push(arm?.name ?? "Unknown arm");
  }
  if (item.academicYearId) {
    const year = years.find((y) => y.id === item.academicYearId);
    parts.push(year?.label ?? "Unknown year");
  }
  if (item.termId) {
    const term = allTerms.find((t) => t.id === item.termId);
    parts.push(term?.name ?? "Unknown term");
  }
  return parts.length ? parts.join(" · ") : "School-wide";
}
