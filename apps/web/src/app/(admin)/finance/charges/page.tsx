"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  formatKobo,
  type AcademicYearDto,
  type ArmChargesStudentDto,
  type ClassArmDto,
  type StudentChargeDto,
  type TermDto,
  type WaitingChargesPreviewDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import {
  billWaitingCharges,
  listArmCharges,
  previewWaitingCharges,
  raiseCharge,
  voidCharge,
} from "@/lib/finance/charges-api";
import { currentSuffix, unambiguousCurrent } from "@/lib/finance/current-context";
import { financeErrorMessage } from "@/lib/finance/error-copy";
import { nairaInputToKobo } from "@/lib/finance/naira-input";

// Phase 9 / CP5.1 — student charges (docs/modules/phase-9.md §13). Amounts a
// child owes beyond the fee catalog: transport, a library fine, or a one-off
// the bursar adds here ("Excursion to Badagry"). A charge waits until an
// invoice carries it — the term invoice when it is generated, or, for a child
// whose term invoice has already gone out, a supplementary invoice issued with
// "Bill waiting charges". Every amount shown is the API's; this page computes
// none.
//
// Like invoice generation, the term is never chosen for the bursar
// (lib/finance/current-context.ts): the year defaults, the term is picked.

const SELECT_CLASSES =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:w-auto";

function statusBadge(charge: StudentChargeDto): { label: string; variant: BadgeProps["variant"] } {
  switch (charge.status) {
    case "OPEN":
      return { label: "Waiting to be billed", variant: "warning" };
    case "BILLED":
      return charge.onSupplementaryInvoice
        ? { label: "On a supplementary invoice", variant: "success" }
        : { label: "On the term invoice", variant: "success" };
    case "VOID":
      return { label: "Voided", variant: "muted" };
  }
}

export default function ChargesPage() {
  const { permissions } = useAuth();
  const canRaise = hasPermission(permissions, "charge.raise");
  const canVoid = hasPermission(permissions, "charge.void");
  const canBill = hasPermission(permissions, "invoice.issue");

  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [armId, setArmId] = useState("");
  const [referenceError, setReferenceError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listAcademicYears(), listClassArms()])
      .then(([y, a]) => {
        setYears(y);
        setArms(a);
        const current = unambiguousCurrent(y);
        if (current) setYearId(current.id);
      })
      .catch((e: unknown) => setReferenceError(financeErrorMessage(e)));
  }, []);

  useEffect(() => {
    setTermId("");
    setTerms([]);
    if (!yearId) return;
    listTerms(yearId)
      .then(setTerms)
      .catch((e: unknown) => setReferenceError(financeErrorMessage(e)));
  }, [yearId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Charges</h1>
        <p className="text-sm text-muted-foreground">
          Amounts a student owes on top of the fee catalog, such as transport or an excursion. A charge waits
          until an invoice carries it: the student&apos;s term invoice when it is generated or, if that has
          already gone out, a supplementary invoice.
        </p>
      </div>

      {referenceError && <InlineAlert>{referenceError}</InlineAlert>}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="charges-year">Academic year</Label>
          <select id="charges-year" className={SELECT_CLASSES} value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="">Choose a year</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
                {currentSuffix(y.isCurrent)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="charges-term">Term</Label>
          <select
            id="charges-term"
            className={SELECT_CLASSES}
            value={termId}
            disabled={!yearId}
            onChange={(e) => setTermId(e.target.value)}
          >
            <option value="">Choose a term</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {currentSuffix(t.isCurrent)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="charges-class">Class</Label>
          <select id="charges-class" className={SELECT_CLASSES} value={armId} onChange={(e) => setArmId(e.target.value)}>
            <option value="">Choose a class</option>
            {arms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {termId && canBill && <WaitingCharges termId={termId} />}

      {termId && armId ? (
        <ClassCharges termId={termId} armId={armId} canRaise={canRaise} canVoid={canVoid} />
      ) : (
        <p className="text-sm text-muted-foreground">Choose a term and a class to see its students&apos; charges.</p>
      )}
    </div>
  );
}

// ─── Bill waiting charges ─────────────────────────────────────────────────

function WaitingCharges({ termId }: { termId: string }) {
  const [preview, setPreview] = useState<WaitingChargesPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [billing, setBilling] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPreview(await previewWaitingCharges(termId));
    } catch (e) {
      setError(financeErrorMessage(e));
    }
  }, [termId]);

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);

  // Children's charges change on the class list below; it tells this panel.
  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener("student-charges-changed", onChange);
    return () => window.removeEventListener("student-charges-changed", onChange);
  }, [load]);

  async function bill() {
    setBilling(true);
    setError(null);
    try {
      const r = await billWaitingCharges({ termId, ...(dueDate ? { dueDate } : {}) });
      setResult(
        r.created === 0
          ? "Nothing to bill."
          : `${r.created} supplementary ${r.created === 1 ? "invoice" : "invoices"} issued for ${formatKobo(r.total)}.`,
      );
      window.dispatchEvent(new Event("student-charges-changed"));
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setBilling(false);
    }
  }

  return (
    <section aria-labelledby="waiting-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="waiting-heading" className="font-medium">
        Waiting charges
      </h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      {result && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{result}</p>}
      {!preview ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {preview.toBill.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No student who already has this term&apos;s invoice has a charge waiting.
            </p>
          ) : (
            <>
              <p className="text-sm">
                {preview.toBill.length} {preview.toBill.length === 1 ? "student has" : "students have"} charges
                waiting, {formatKobo(preview.totalToBill)} in all. They already have this term&apos;s invoice, so
                each gets a supplementary invoice for their waiting charges.
              </p>
              <ul className="divide-y rounded-md border text-sm">
                {preview.toBill.map((row) => (
                  <li key={row.studentId} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 break-words">
                      {row.studentName ?? "Unknown student"}
                      {row.admissionNumber && <span className="text-muted-foreground"> · {row.admissionNumber}</span>}
                    </span>
                    <span className="tabular-nums">
                      {row.chargeCount} {row.chargeCount === 1 ? "charge" : "charges"} · {formatKobo(row.total)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1">
                  <Label htmlFor="waiting-due">Due date (optional)</Label>
                  <Input id="waiting-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="sm:w-48" />
                </div>
                <Button onClick={() => void bill()} disabled={billing}>
                  {billing ? "Billing…" : "Bill waiting charges"}
                </Button>
              </div>
            </>
          )}
          {preview.waitingForTermInvoice > 0 && (
            <p className="text-sm text-muted-foreground">
              {preview.waitingForTermInvoice} {preview.waitingForTermInvoice === 1 ? "student has" : "students have"}{" "}
              charges that will go on their term invoice when it is generated.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ─── A class's students and their charges ─────────────────────────────────

function ClassCharges({ termId, armId, canRaise, canVoid }: { termId: string; armId: string; canRaise: boolean; canVoid: boolean }) {
  const [rows, setRows] = useState<ArmChargesStudentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listArmCharges({ termId, classArmId: armId }));
    } catch (e) {
      setError(financeErrorMessage(e));
    }
  }, [termId, armId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    const onChange = () => void load();
    window.addEventListener("student-charges-changed", onChange);
    return () => window.removeEventListener("student-charges-changed", onChange);
  }, [load]);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No students are enrolled in this class for the term.</p>;

  return (
    <section aria-label="Students and their charges" className="divide-y rounded-md border bg-card">
      {rows.map((row) => (
        <StudentCharges key={row.studentId} row={row} termId={termId} canRaise={canRaise} canVoid={canVoid} />
      ))}
    </section>
  );
}

function changed() {
  window.dispatchEvent(new Event("student-charges-changed"));
}

function StudentCharges({ row, termId, canRaise, canVoid }: { row: ArmChargesStudentDto; termId: string; canRaise: boolean; canVoid: boolean }) {
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = row.studentName ?? "Unknown student";

  async function add() {
    const kobo = nairaInputToKobo(amount);
    if (!description.trim()) return setError("Say what the charge is for.");
    if (kobo === null) return setError("Enter an amount in naira, such as 5,000 or 5,000.50.");
    setSaving(true);
    setError(null);
    try {
      await raiseCharge({ studentId: row.studentId, termId, description: description.trim(), amount: kobo });
      setAdding(false);
      setDescription("");
      setAmount("");
      changed();
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{name}</p>
          {row.admissionNumber && <p className="text-xs text-muted-foreground">{row.admissionNumber}</p>}
        </div>
        {canRaise && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} aria-label={`Add a charge for ${name}`}>
            Add a charge
          </Button>
        )}
      </div>

      {row.charges.length === 0 ? (
        <p className="text-sm text-muted-foreground">No charges this term.</p>
      ) : (
        <ul className="space-y-2">
          {row.charges.map((charge) => (
            <ChargeLine key={charge.id} charge={charge} canVoid={canVoid} />
          ))}
        </ul>
      )}

      {adding && (
        <form
          className="space-y-3 rounded-md bg-muted/40 p-3"
          aria-label={`New charge for ${name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          {error && <InlineAlert>{error}</InlineAlert>}
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`desc-${row.studentId}`}>What it is for</Label>
              <Input id={`desc-${row.studentId}`} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Excursion to Badagry" />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`amount-${row.studentId}`}>Amount (₦)</Label>
              <Input id={`amount-${row.studentId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5,000" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Adding…" : "Add charge"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ChargeLine({ charge, canVoid }: { charge: StudentChargeDto; canVoid: boolean }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = statusBadge(charge);

  async function confirmVoid() {
    if (!reason.trim()) return setError("Give a reason; it is kept with the record.");
    setSaving(true);
    setError(null);
    try {
      await voidCharge(charge.id, reason.trim());
      setVoiding(false);
      changed();
    } catch (e) {
      setError(financeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={charge.status === "VOID" ? "min-w-0 break-words text-muted-foreground line-through" : "min-w-0 break-words"}>
          {charge.description}
        </span>
        <span className="tabular-nums font-medium">{formatKobo(charge.amount)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {charge.invoiceId && (
          <Link href={`/finance/invoices/${charge.invoiceId}`} className="text-primary underline-offset-2 hover:underline">
            View invoice
          </Link>
        )}
        {charge.status === "VOID" && charge.voidReason && (
          <span className="text-muted-foreground">Reason: {charge.voidReason}</span>
        )}
        {canVoid && charge.status === "OPEN" && !voiding && (
          <Button size="sm" variant="ghost" onClick={() => setVoiding(true)} aria-label={`Void ${charge.description}`}>
            Void
          </Button>
        )}
      </div>
      {voiding && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          {error && <InlineAlert>{error}</InlineAlert>}
          <Label htmlFor={`void-${charge.id}`}>Why is it being voided?</Label>
          <Input id={`void-${charge.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={saving} onClick={() => void confirmVoid()}>
              {saving ? "Voiding…" : "Void charge"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setVoiding(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
