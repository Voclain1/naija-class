"use client";

import { CheckCircle2, Loader2, Receipt, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { InvoiceDto, ManualPaymentMethod } from "@school-kit/types";

import { EmptyState, PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { financeErrorMessage } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";
import { listInvoices } from "@/lib/finance/invoices-api";
import { getPaymentReceiptUrl, recordManualPayment } from "@/lib/finance/payments-api";
import {
  balanceOf,
  billLabel,
  groupBillsByStudent,
  nairaInput,
  parseAmount,
  type PayerGroup,
} from "@/lib/finance/record-payment";

// /finance/payments/record — Record payment (owner's ask, 2026-10-30).
//
// Before this, "Record Fee" and "Record payment" both landed on the bills
// list and the bursar had to find the right bill first. Here they search for
// the child, see what is owed, and record against a bill in one place.
//
// - Search reads GET /invoices?search=…&unpaid=true: invoice.read only, so a
//   bursar (who has no student.read) can use it.
// - Recording is the same POST /payments/manual the bill page uses, with the
//   same per-form idempotency key, so FinanceService, the audit log and the
//   receipt all work exactly as before. The API refuses an overpayment too.
// - One payment goes against one bill. Splitting a payment across bills is not
//   built; record it on each bill in turn.

const INPUT =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const METHODS: { value: ManualPaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "POS", label: "POS" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
];

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

interface Recorded {
  paymentId: string;
  receiptNumber: string | null;
  amount: number;
  name: string;
  balanceLeft: number;
}

export default function RecordPaymentPage() {
  const { permissions } = useAuth();
  const canRecord = hasPermission(permissions, "payment.record");

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [groups, setGroups] = useState<PayerGroup[] | null>(null);
  const [selected, setSelected] = useState<PayerGroup | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Search as they type, after a short pause; the newest answer wins.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups(null);
      setSearchError(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      listInvoices({ search: q, unpaid: true, limit: 200 })
        .then((res) => {
          if (!live) return;
          setGroups(groupBillsByStudent(res.data));
          setSearchError(null);
        })
        .catch((e) => live && setSearchError(financeErrorMessage(e)))
        .finally(() => live && setSearching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  function startAgain() {
    setRecorded(null);
    setSelected(null);
    setGroups(null);
    setQuery("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  if (!canRecord) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState
          title="You can't record payments"
          body="Ask the school's owner or an administrator to give you the bursar role."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Record payment" subtitle="Find the student, then record what they paid." />

      {recorded ? (
        <Done recorded={recorded} onAnother={startAgain} />
      ) : selected ? (
        <PayForm
          group={selected}
          onBack={() => setSelected(null)}
          onRecorded={setRecorded}
        />
      ) : (
        <section className="flex flex-col gap-3" aria-label="Find the student">
          <label htmlFor="payer-search" className="text-sm font-medium">
            Student
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="payer-search"
              ref={searchRef}
              type="search"
              autoFocus
              autoComplete="off"
              placeholder="Name or admission number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${INPUT} pl-9`}
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {searchError && <InlineAlert>{searchError}</InlineAlert>}

          {groups && groups.length === 0 && !searching && (
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <p className="font-medium text-foreground">No unpaid bills for &ldquo;{query.trim()}&rdquo;.</p>
              <p className="mt-1 text-muted-foreground">
                Check the spelling, or the student may have no bill yet.{" "}
                <Link href="/finance/invoices" className="text-primary underline underline-offset-2">
                  Go to Bills
                </Link>{" "}
                to raise one.
              </p>
            </div>
          )}

          {groups && groups.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Students with unpaid bills">
              {groups.map((g) => (
                <li key={g.studentId}>
                  <button
                    type="button"
                    onClick={() => setSelected(g)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground">{g.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[g.admissionNumber, `${g.bills.length} unpaid ${g.bills.length === 1 ? "bill" : "bills"}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs text-muted-foreground">Owes</span>
                      <span className="font-semibold tabular-nums text-foreground">{formatKobo(g.owed)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function PayForm({
  group,
  onBack,
  onRecorded,
}: {
  group: PayerGroup;
  onBack: () => void;
  onRecorded: (r: Recorded) => void;
}) {
  const [billId, setBillId] = useState(group.bills[0]!.id);
  const bill: InvoiceDto = useMemo(
    () => group.bills.find((b) => b.id === billId) ?? group.bills[0]!,
    [group.bills, billId],
  );
  const balance = balanceOf(bill);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<ManualPaymentMethod>("CASH");
  const [paidAt, setPaidAt] = useState(nowLocal);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One key per payment form, reused on every retry of the same payment (D37):
  // a double click or a retried request records it once.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function chooseBill(id: string) {
    setBillId(id);
    setAmount("");
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseAmount(amount, balance);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payment = await recordManualPayment({
        invoiceId: bill.id,
        amount: parsed.kobo,
        method,
        paidAt: new Date(paidAt).toISOString(),
        reference: reference.trim() || undefined,
        idempotencyKey,
      });
      onRecorded({
        paymentId: payment.id,
        receiptNumber: payment.receiptNumber,
        amount: payment.amount,
        name: group.name,
        balanceLeft: Math.max(0, balance - payment.amount),
      });
    } catch (err) {
      setError(financeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-label={`Record a payment for ${group.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/40 p-4">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{group.name}</p>
          {group.admissionNumber && <p className="text-xs text-muted-foreground">{group.admissionNumber}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total owed</p>
          <p className="font-semibold tabular-nums text-foreground">{formatKobo(group.owed)}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full text-left text-sm text-primary underline underline-offset-2 sm:w-auto"
        >
          Choose another student
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Bill</legend>
          {group.bills.map((b) => (
            <label
              key={b.id}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
                b.id === bill.id ? "border-primary bg-primary/5" : "bg-card"
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="bill"
                  value={b.id}
                  checked={b.id === bill.id}
                  onChange={() => chooseBill(b.id)}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{billLabel(b)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatKobo(b.totalPaid)} paid of {formatKobo(b.totalDue)}
                  </span>
                </span>
              </span>
              <span className="text-right">
                <span className="block text-xs text-muted-foreground">Balance</span>
                <span className="font-semibold tabular-nums">{formatKobo(balanceOf(b))}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-amount" className="text-sm font-medium">
              Amount (₦)
            </label>
            <div className="flex gap-2">
              <input
                id="pay-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={nairaInput(balance)}
                className={INPUT}
              />
              <Button type="button" variant="outline" onClick={() => setAmount(nairaInput(balance))}>
                Paid in full
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-method" className="text-sm font-medium">
              Method
            </label>
            <select
              id="pay-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}
              className={INPUT}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-date" className="text-sm font-medium">
              Date paid
            </label>
            <input
              id="pay-date"
              type="datetime-local"
              required
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-reference" className="text-sm font-medium">
              Reference <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="pay-reference"
              maxLength={200}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Teller, POS or transfer ref"
              className={INPUT}
            />
          </div>
        </div>

        {error && <InlineAlert>{error}</InlineAlert>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
            {saving ? "Recording…" : "Record payment"}
          </Button>
          <Link
            href={`/finance/invoices/${bill.id}`}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Open this bill
          </Link>
        </div>
      </form>
    </section>
  );
}

function Done({ recorded, onAnother }: { recorded: Recorded; onAnother: () => void }) {
  const [receiptError, setReceiptError] = useState<string | null>(null);

  async function openReceipt() {
    setReceiptError(null);
    // Open the tab inside the click; a window.open after an await is blocked
    // as a pop-up by most browsers.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await getPaymentReceiptUrl(recorded.paymentId);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setReceiptError(financeErrorMessage(e));
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-emerald-50 p-5 dark:bg-emerald-950/30" role="status">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold text-foreground">
            {formatKobo(recorded.amount)} recorded for {recorded.name}.
          </p>
          <p className="text-sm text-muted-foreground">
            {recorded.balanceLeft > 0
              ? `${formatKobo(recorded.balanceLeft)} left on this bill.`
              : "This bill is now paid in full."}
            {recorded.receiptNumber ? ` Receipt ${recorded.receiptNumber}.` : ""}
          </p>
        </div>
      </div>
      {receiptError && <InlineAlert>{receiptError}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void openReceipt()}>
          <Receipt className="h-4 w-4" />
          Open receipt
        </Button>
        <Button type="button" onClick={onAnother}>
          Record another
        </Button>
      </div>
    </section>
  );
}
