"use client";

import { useEffect, useRef, useState } from "react";

import {
  addDaysIso,
  formatKobo,
  lagosTodayIso,
  type LibraryBorrowerDto,
  type LibraryBorrowerKind,
  type LibraryContextDto,
  type LibraryCopyLookupDto,
} from "@school-kit/types";

import { COPY_STATUS_LABEL, dueText, LibraryHeader, message } from "@/components/library/library-shared";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findBorrowers, getLibraryContext, issueLoan, lookupCopy, markLost, renewLoan, returnLoan } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — the lending desk (docs/modules/phase-9.md §14 CP6-D2).
// Type or scan a copy's accession number. A copy on the shelf is lent to a
// student or a member of staff; a copy out on loan is returned or renewed.
// Limits, due dates and renewals are the API's to decide.
//
// CP6.2 (CP6-D3/D4): a late student's fine, worked out by the API, is shown
// before the book is taken back, and can be waived with a reason. A lost book
// charges a student the book's replacement price. Both reach the family as a
// line on their fees.

export default function LendingDeskPage() {
  const [context, setContext] = useState<LibraryContextDto | null>(null);
  const [number, setNumber] = useState("");
  const [found, setFound] = useState<LibraryCopyLookupDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const numberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getLibraryContext().then(setContext).catch((e) => setError(message(e)));
    numberRef.current?.focus();
  }, []);

  async function look(value = number) {
    if (!value.trim()) return setError("Type or scan the accession number.");
    setError(null);
    setNotice(null);
    setFound(null);
    try {
      setFound(await lookupCopy(value.trim()));
    } catch (e) {
      setError(message(e));
    }
  }

  function done(text: string) {
    setNotice(text);
    setFound(null);
    setNumber("");
    numberRef.current?.focus();
  }

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      done(await fn());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <LibraryHeader title="Lending desk" intro="Type or scan a copy's accession number to lend it, take it back or renew it." />

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void look();
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="desk-number">Accession number</Label>
          <Input id="desk-number" ref={numberRef} value={number} autoComplete="off" onChange={(e) => setNumber(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">
          Find copy
        </Button>
      </form>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{notice}</p>}

      {found && (
        <section aria-label="Copy" className="space-y-4 rounded-md border bg-card p-4">
          <div className="space-y-0.5">
            <h2 className="break-words font-medium">{found.book.title}</h2>
            <p className="text-sm text-muted-foreground">
              No. {found.copy.accessionNumber}
              {found.book.authors ? ` · ${found.book.authors}` : ""} · {COPY_STATUS_LABEL[found.copy.status]}
            </p>
          </div>

          {found.loan ? (
            <LoanActions
              found={found}
              busy={busy}
              onReturn={(waiveReason) =>
                act(async () => {
                  const { loan, charged } = await returnLoan(found.copy.accessionNumber, waiveReason);
                  return `"${loan.title}" is back from ${loan.borrower.name}.${chargedText(charged, loan.fineWaivedReason, "fine")}`;
                })
              }
              onRenew={() =>
                act(async () => {
                  const loan = await renewLoan(found.loan!.id);
                  return `Renewed. "${loan.title}" is now ${dueText(loan).toLowerCase()}.`;
                })
              }
              onLost={(waiveReason) =>
                act(async () => {
                  const { loan, charged } = await markLost(found.loan!.id, waiveReason);
                  return `"${loan.title}" is marked lost.${chargedText(charged, loan.fineWaivedReason, "replacement price")}`;
                })
              }
            />
          ) : found.book.referenceOnly ? (
            <p className="rounded-md bg-muted/40 p-3 text-sm">This book is for reference only and stays in the library.</p>
          ) : found.copy.status !== "AVAILABLE" ? (
            <p className="rounded-md bg-muted/40 p-3 text-sm">This copy is not on the shelf, so it cannot be lent.</p>
          ) : context ? (
            <LendForm
              loanDays={context.settings.loanDays}
              busy={busy}
              onLend={(borrower, dueOn) =>
                act(async () => {
                  const loan = await issueLoan({
                    accessionNumber: found.copy.accessionNumber,
                    ...(borrower.kind === "STUDENT" ? { studentId: borrower.id } : { userId: borrower.id }),
                    dueOn,
                  });
                  return `"${loan.title}" lent to ${loan.borrower.name}. ${dueText(loan)}.`;
                })
              }
            />
          ) : null}
        </section>
      )}
    </div>
  );
}

function LendForm({
  loanDays,
  busy,
  onLend,
}: {
  loanDays: number;
  busy: boolean;
  onLend: (borrower: LibraryBorrowerDto, dueOn: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<LibraryBorrowerKind>("STUDENT");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibraryBorrowerDto[] | null>(null);
  const [chosen, setChosen] = useState<LibraryBorrowerDto | null>(null);
  const [dueOn, setDueOn] = useState(addDaysIso(lagosTodayIso(), loanDays));
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return setError(kind === "STUDENT" ? "Type a name or admission number." : "Type a name.");
    setError(null);
    try {
      setResults(await findBorrowers(kind, q.trim()));
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Lend to</legend>
        <div className="flex gap-4 text-sm">
          {(["STUDENT", "STAFF"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="radio"
                name="borrower-kind"
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setResults(null);
                  setChosen(null);
                }}
              />
              {k === "STUDENT" ? "A student" : "A member of staff"}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <InlineAlert>{error}</InlineAlert>}

      {chosen ? (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">{chosen.name}</span> ({chosen.detail}) has {chosen.booksOut} of {chosen.limit} books out.{" "}
            <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setChosen(null)}>
              Choose someone else
            </button>
          </p>
          <div className="space-y-1">
            <Label htmlFor="desk-due">Due back</Label>
            <Input id="desk-due" type="date" className="w-auto" value={dueOn} min={lagosTodayIso()} onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <Button disabled={busy} onClick={() => void onLend(chosen, dueOn)}>
            Lend book
          </Button>
        </div>
      ) : (
        <>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="desk-borrower">{kind === "STUDENT" ? "Find a student" : "Find a member of staff"}</Label>
              <Input id="desk-borrower" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "STUDENT" ? "Name or admission number" : "Name"} />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Find
            </Button>
          </form>
          {results &&
            (results.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody found.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {results.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{r.name}</p>
                      <p className="text-muted-foreground">
                        {r.detail} · {r.booksOut} of {r.limit} books out
                      </p>
                    </div>
                    <Button size="sm" variant="outline" disabled={r.booksOut >= r.limit} onClick={() => setChosen(r)} aria-label={`Choose ${r.name}`}>
                      {r.booksOut >= r.limit ? "At the limit" : "Choose"}
                    </Button>
                  </li>
                ))}
              </ul>
            ))}
        </>
      )}
    </div>
  );
}

/** What a return or a loss did about money, in words. */
function chargedText(charged: number, waivedReason: string | null, what: string): string {
  if (charged > 0) return ` ${formatKobo(charged)} added to the family's fees as a library charge.`;
  if (waivedReason) return ` The ${what} was waived.`;
  return "";
}

function LoanActions({
  found,
  busy,
  onReturn,
  onRenew,
  onLost,
}: {
  found: LibraryCopyLookupDto;
  busy: boolean;
  onReturn: (waiveReason?: string) => Promise<void>;
  onRenew: () => Promise<void>;
  onLost: (waiveReason?: string) => Promise<void>;
}) {
  const loan = found.loan!;
  const fine = loan.fineSoFar ?? 0;
  const isStudent = loan.borrower.kind === "STUDENT";
  const price = isStudent ? (found.book.replacementPrice ?? 0) : 0;
  const [mode, setMode] = useState<"return" | "lost">("return");
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const owed = mode === "return" ? fine : price;

  function go(fn: (waiveReason?: string) => Promise<void>) {
    if (waive && owed > 0 && reason.trim().length < 3) return setError("Say why it is waived.");
    setError(null);
    void fn(waive && owed > 0 ? reason.trim() : undefined);
  }

  return (
    <div className={`space-y-3 rounded-md p-3 text-sm ${loan.overdue ? "bg-amber-500/10" : "bg-muted/40"}`}>
      <p>
        Lent to <span className="font-medium">{loan.borrower.name}</span> ({loan.borrower.detail}). {dueText(loan)}.
      </p>
      <p className="text-muted-foreground">
        {loan.renewalsLeft > 0 ? `${loan.renewalsLeft} renewal${loan.renewalsLeft === 1 ? "" : "s"} left.` : "No renewals left."}
      </p>

      {mode === "return" && fine > 0 && (
        <p className="font-medium text-amber-900 dark:text-amber-200">Fine if returned today: {formatKobo(fine)}.</p>
      )}
      {mode === "lost" && (
        <p className="font-medium">
          {!isStudent
            ? "Staff are not charged for a lost book."
            : price > 0
              ? `Marking it lost charges the family the replacement price, ${formatKobo(price)}, instead of any fine.`
              : "This book has no replacement price, so nothing is charged."}
        </p>
      )}
      {owed > 0 && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
            {mode === "return" ? "Waive the fine" : "Waive the charge"}
          </label>
          {waive && (
            <div className="space-y-1">
              <Label htmlFor="desk-waive-reason">Reason</Label>
              <Input id="desk-waive-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </div>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}

      {mode === "return" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => go(onReturn)}>
            Return book
          </Button>
          {!loan.overdue && loan.renewalsLeft > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => void onRenew()}>
              Renew
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => { setMode("lost"); setWaive(false); }}>
            Book lost
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => go(onLost)}>
            Mark lost
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => { setMode("return"); setWaive(false); }}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
