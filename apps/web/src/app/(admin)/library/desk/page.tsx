"use client";

import { useEffect, useRef, useState } from "react";

import {
  addDaysIso,
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
import { findBorrowers, getLibraryContext, issueLoan, lookupCopy, renewLoan, returnLoan } from "@/lib/library/library-api";

// Phase 9 / CP6.1 — the lending desk (docs/modules/phase-9.md §14 CP6-D2).
// Type or scan a copy's accession number. A copy on the shelf is lent to a
// student or a member of staff; a copy out on loan is returned or renewed.
// Limits, due dates and renewals are the API's to decide.

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
            <div className={`space-y-3 rounded-md p-3 text-sm ${found.loan.overdue ? "bg-amber-500/10" : "bg-muted/40"}`}>
              <p>
                Lent to <span className="font-medium">{found.loan.borrower.name}</span> ({found.loan.borrower.detail}). {dueText(found.loan)}.
              </p>
              <p className="text-muted-foreground">
                {found.loan.renewalsLeft > 0 ? `${found.loan.renewalsLeft} renewal${found.loan.renewalsLeft === 1 ? "" : "s"} left.` : "No renewals left."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void act(async () => {
                    const loan = await returnLoan(found.copy.accessionNumber);
                    return `"${loan.title}" is back from ${loan.borrower.name}.`;
                  })}
                >
                  Return book
                </Button>
                {!found.loan.overdue && found.loan.renewalsLeft > 0 && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act(async () => {
                      const loan = await renewLoan(found.loan!.id);
                      return `Renewed. "${loan.title}" is now ${dueText(loan).toLowerCase()}.`;
                    })}
                  >
                    Renew
                  </Button>
                )}
              </div>
            </div>
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
