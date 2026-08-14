"use client";

import { useEffect, useState } from "react";

import type {
  AcademicYearDto,
  DiscountRuleDto,
  FeeCategoryDto,
  FeeItemDto,
  StudentDto,
  TermDto,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { listFeeCategories, listFeeItems } from "@/lib/finance/fee-catalog-api";
import { formatKobo } from "@/lib/finance/format";
import {
  createDiscountRule,
  deactivateDiscountRule,
  listDiscountRules,
} from "@/lib/finance/discount-rules-api";
import { listStudents } from "@/lib/students/students-api";

type TargetType = "feeItem" | "feeCategory";
type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT" | "FULL_WAIVER";
type Duration = "TERM" | "SESSION" | "LIFETIME";

interface FormState {
  name: string;
  discountType: DiscountType;
  valuePercent: string; // UI input; converted to basis points on submit
  valueNaira: string;   // UI input; converted to kobo on submit
  targetType: TargetType;
  feeItemId: string;
  feeCategoryId: string;
  duration: Duration;
  yearId: string;       // for SESSION: submitted as academicYearId; for TERM: filters the term picker
  termId: string;       // submitted when duration = TERM
}

const EMPTY_FORM: FormState = {
  name: "",
  discountType: "FULL_WAIVER",
  valuePercent: "",
  valueNaira: "",
  targetType: "feeItem",
  feeItemId: "",
  feeCategoryId: "",
  duration: "LIFETIME",
  yearId: "",
  termId: "",
};

const SELECT_CLASSES =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export default function DiscountsPage() {
  // Reference data (loaded on mount)
  const [students, setStudents] = useState<StudentDto[]>([]);
  const [feeItems, setFeeItems] = useState<FeeItemDto[]>([]);
  const [feeCategories, setFeeCategories] = useState<FeeCategoryDto[]>([]);
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  // Terms loaded when a year is selected in the form (TERM duration only)
  const [terms, setTerms] = useState<TermDto[]>([]);

  // Per-student rules view
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [rules, setRules] = useState<DiscountRuleDto[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);

  // Assign discount modal
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load reference data on mount. Each call is independent so a failure in
  // one (e.g. empty school, permission gap) doesn't silently blank the others.
  useEffect(() => {
    listStudents({ limit: 200 }) // schema max is 200
      .then((r) => setStudents(r.data))
      .catch(() => {});
    // includeInactive: true — a discount can target a deactivated fee item or
    // category (the rule is still valid for existing invoices). Filtering to
    // active-only would hide legitimate targets.
    listFeeItems({ includeInactive: true })
      .then(setFeeItems)
      .catch((e) => { console.error("[DiscountsPage] listFeeItems:", e); });
    listFeeCategories({ includeInactive: true })
      .then(setFeeCategories)
      .catch((e) => { console.error("[DiscountsPage] listFeeCategories:", e); });
    listAcademicYears()
      .then(setYears)
      .catch((e) => { console.error("[DiscountsPage] listAcademicYears:", e); });
  }, []);

  // Load terms when yearId changes (TERM duration)
  useEffect(() => {
    if (!form.yearId) {
      setTerms([]);
      return;
    }
    listTerms(form.yearId)
      .then(setTerms)
      .catch(() => setTerms([]));
  }, [form.yearId]);

  // Load rules for the selected student
  useEffect(() => {
    if (!selectedStudentId) {
      setRules([]);
      return;
    }
    setLoadingRules(true);
    listDiscountRules({ studentId: selectedStudentId, includeInactive: true })
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoadingRules(false));
  }, [selectedStudentId]);

  function patch(update: Partial<FormState>) {
    setForm((f) => ({ ...f, ...update }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStudentId) return;
    setSubmitting(true);
    setFormError(null);

    try {
      // Compute the numeric value based on discount type.
      const value =
        form.discountType === "PERCENTAGE"
          ? Math.round(parseFloat(form.valuePercent) * 100)  // % → basis points
          : form.discountType === "FIXED_AMOUNT"
          ? Math.round(parseFloat(form.valueNaira) * 100)    // ₦ → kobo
          : undefined;                                         // FULL_WAIVER: no value

      const rule = await createDiscountRule({
        studentId: selectedStudentId,
        name: form.name.trim(),
        feeItemId:
          form.targetType === "feeItem" && form.feeItemId
            ? form.feeItemId
            : undefined,
        feeCategoryId:
          form.targetType === "feeCategory" && form.feeCategoryId
            ? form.feeCategoryId
            : undefined,
        duration: form.duration,
        termId:
          form.duration === "TERM" && form.termId ? form.termId : undefined,
        academicYearId:
          form.duration === "SESSION" && form.yearId ? form.yearId : undefined,
        discountType: form.discountType,
        value,
      });

      setRules((r) => [rule, ...r]);
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to assign discount.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await deactivateDiscountRule(id);
      setRules((r) => r.map((rule) => (rule.id === id ? { ...rule, active: false } : rule)));
    } catch {
      // A production page would show an inline toast; MVP omits that.
    }
  }

  function formatValue(rule: DiscountRuleDto): string {
    if (rule.discountType === "FULL_WAIVER") return "Full waiver";
    if (rule.discountType === "PERCENTAGE") {
      return `${((rule.value ?? 0) / 100).toFixed(2)}%`;
    }
    return formatKobo(rule.value ?? 0);
  }

  function scopeLabel(rule: DiscountRuleDto): string {
    if (rule.feeItemId) {
      const item = feeItems.find((i) => i.id === rule.feeItemId);
      return `Item: ${item?.name ?? rule.feeItemId}`;
    }
    const cat = feeCategories.find((c) => c.id === rule.feeCategoryId);
    return `Category: ${cat?.name ?? rule.feeCategoryId}`;
  }

  function durationLabel(rule: DiscountRuleDto): string {
    if (rule.duration === "LIFETIME") return "Lifetime";
    if (rule.duration === "SESSION") {
      const yr = years.find((y) => y.id === rule.academicYearId);
      return `Session — ${yr?.label ?? "unknown year"}`;
    }
    // TERM: resolve from the currently-loaded terms (may be empty if form was reset)
    const term = terms.find((t) => t.id === rule.termId);
    return `Term — ${term?.name ?? rule.termId ?? "unknown"}`;
  }

  const selectedStudent = students.find((s) => s.id === selectedStudentId);

  return (
    <div className="max-w-5xl space-y-6 p-6">
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Discount Rules</h1>
      <p className="text-sm text-muted-foreground">
        Manually assign fee discounts to individual students. Each rule targets
        one fee item or one fee category for a specified duration.
      </p>

      {/* Student picker */}
      <div className="flex items-end gap-3">
        <div className="w-80">
          <label className="mb-1 block text-sm font-medium text-foreground">Student</label>
          <select className={SELECT_CLASSES} value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)}>
            <option value="">— choose a student —</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.lastName}, {s.firstName} ({s.admissionNumber})
              </option>
            ))}
          </select>
        </div>
        {selectedStudentId && (
          <Button
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
              setShowForm(true);
            }}
          >
            Assign discount
          </Button>
        )}
      </div>

      {/* Rules table */}
      {selectedStudentId && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRules && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loadingRules && rules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No discount rules assigned to this student.
                  </TableCell>
                </TableRow>
              )}
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {rule.discountType === "PERCENTAGE"
                      ? "Percentage"
                      : rule.discountType === "FIXED_AMOUNT"
                      ? "Fixed amount"
                      : "Full waiver"}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{formatValue(rule)}</TableCell>
                  <TableCell className="text-muted-foreground">{scopeLabel(rule)}</TableCell>
                  <TableCell className="text-muted-foreground">{durationLabel(rule)}</TableCell>
                  <TableCell>
                    <Badge variant={rule.active ? "success" : "muted"}>
                      {rule.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {rule.active && (
                      <button
                        onClick={() => handleDeactivate(rule.id)}
                        className="text-xs text-destructive hover:text-destructive/80"
                      >
                        Deactivate
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Assign discount modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Assign discount —{" "}
              {selectedStudent
                ? `${selectedStudent.firstName} ${selectedStudent.lastName}`
                : "Student"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Label / description
              </label>
              <input
                required
                className={SELECT_CLASSES}
                placeholder="e.g. Staff child reduction, Scholarship"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>

            {/* Discount type */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Discount type
              </label>
              <div className="flex gap-4">
                {(
                  [
                    ["PERCENTAGE", "Percentage"],
                    ["FIXED_AMOUNT", "Fixed amount"],
                    ["FULL_WAIVER", "Full waiver"],
                  ] as const
                ).map(([val, label]) => (
                  <label key={val} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                    <input
                      type="radio"
                      name="discountType"
                      value={val}
                      checked={form.discountType === val}
                      onChange={() =>
                        patch({ discountType: val, valuePercent: "", valueNaira: "" })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Value — conditional on discount type */}
            {form.discountType === "PERCENTAGE" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Discount (%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    required
                    type="number"
                    min="0.01"
                    max="99.99"
                    step="0.01"
                    className={`w-28 ${SELECT_CLASSES}`}
                    placeholder="10"
                    value={form.valuePercent}
                    onChange={(e) => patch({ valuePercent: e.target.value })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {form.valuePercent
                      ? `= ${Math.round(parseFloat(form.valuePercent) * 100)} basis points`
                      : "(max 99.99%)"}
                  </span>
                </div>
              </div>
            )}

            {form.discountType === "FIXED_AMOUNT" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Amount (₦)
                </label>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={`w-44 ${SELECT_CLASSES}`}
                  placeholder="5000.00"
                  value={form.valueNaira}
                  onChange={(e) => patch({ valueNaira: e.target.value })}
                />
              </div>
            )}

            {/* Target: fee item or category */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">
                Applies to
              </label>
              <div className="mb-2 flex gap-4">
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="radio"
                    name="targetType"
                    value="feeItem"
                    checked={form.targetType === "feeItem"}
                    onChange={() =>
                      patch({ targetType: "feeItem", feeCategoryId: "" })
                    }
                  />
                  Specific fee item
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="radio"
                    name="targetType"
                    value="feeCategory"
                    checked={form.targetType === "feeCategory"}
                    onChange={() =>
                      patch({ targetType: "feeCategory", feeItemId: "" })
                    }
                  />
                  Entire fee category
                </label>
              </div>

              {form.targetType === "feeItem" && (
                <select
                  required
                  className={SELECT_CLASSES}
                  value={form.feeItemId}
                  onChange={(e) => patch({ feeItemId: e.target.value })}
                >
                  <option value="">— select fee item —</option>
                  {feeItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({formatKobo(i.amount)})
                    </option>
                  ))}
                </select>
              )}

              {form.targetType === "feeCategory" && (
                <select
                  required
                  className={SELECT_CLASSES}
                  value={form.feeCategoryId}
                  onChange={(e) => patch({ feeCategoryId: e.target.value })}
                >
                  <option value="">— select fee category —</option>
                  {feeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Duration */}
            <div>
              <label className="mb-2 block text-sm font-medium text-foreground">Duration</label>
              <div className="mb-2 flex gap-4">
                {(
                  [
                    ["TERM", "Single term"],
                    ["SESSION", "Full session"],
                    ["LIFETIME", "Lifetime"],
                  ] as const
                ).map(([val, label]) => (
                  <label key={val} className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground">
                    <input
                      type="radio"
                      name="duration"
                      value={val}
                      checked={form.duration === val}
                      onChange={() =>
                        patch({ duration: val, yearId: "", termId: "" })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              {(form.duration === "TERM" || form.duration === "SESSION") && (
                <div className="space-y-2">
                  <select
                    required
                    className={SELECT_CLASSES}
                    value={form.yearId}
                    onChange={(e) =>
                      patch({ yearId: e.target.value, termId: "" })
                    }
                  >
                    <option value="">— select academic year —</option>
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>
                        {y.label}
                      </option>
                    ))}
                  </select>

                  {form.duration === "TERM" && (
                    <select
                      required
                      disabled={!form.yearId}
                      className={SELECT_CLASSES}
                      value={form.termId}
                      onChange={(e) => patch({ termId: e.target.value })}
                    >
                      <option value="">
                        {form.yearId ? "— select term —" : "Select a year first"}
                      </option>
                      {terms.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Assign discount"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
